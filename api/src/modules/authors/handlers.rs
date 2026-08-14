use chrono::Utc;
use std::{
    collections::{BTreeSet, HashMap},
    path::PathBuf,
};

use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{
        author, author_avatar, author_resource, manga_series, photo_asset, tag, tag_resource,
    },
    modules::{
        authors::dto::{AuthorAvatarResponse, AuthorDetailResponse, AuthorResponse},
        manga::dto::MangaSeriesResponse,
        photos::dto::PhotoAssetResponse,
    },
};

fn avatar_src(author: &author::Model) -> Option<String> {
    author.avatar_file_name.as_ref().map(|_| {
        format!(
            "/api/authors/{}/avatar?v={}",
            author.id,
            author.updated_at.timestamp_millis()
        )
    })
}

fn avatar_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("avatars")
        .join("authors")
}

#[derive(Deserialize)]
pub struct AvatarQuery {
    pub avatar_id: Option<String>,
}

fn history_src(author_id: &str, avatar_id: &str) -> String {
    format!("/api/authors/{author_id}/avatar?avatar_id={avatar_id}")
}

async fn response_for_author(
    db: &sea_orm::DatabaseConnection,
    value: author::Model,
) -> Result<AuthorResponse, ApiError> {
    let resources = author_resource::Entity::find()
        .filter(author_resource::Column::AuthorId.eq(value.id.clone()))
        .all(db)
        .await?;
    let resource_types = resources
        .iter()
        .map(|resource| resource.resource_type.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let avatar_src = avatar_src(&value);
    Ok(AuthorResponse {
        id: value.id,
        name: value.name,
        avatar_src,
        resource_count: resources.len() as i64,
        resource_types,
        created_at: value.created_at,
    })
}

#[utoipa::path(get, path="/api/authors", responses((status=200, body=[AuthorResponse])), tag="authors")]
pub async fn list_authors(
    State(state): State<AppState>,
) -> Result<Json<Vec<AuthorResponse>>, ApiError> {
    let authors = author::Entity::find()
        .order_by_asc(author::Column::Name)
        .all(&state.db)
        .await?;
    let mut result = Vec::with_capacity(authors.len());
    for value in authors {
        result.push(response_for_author(&state.db, value).await?);
    }
    Ok(Json(result))
}

#[utoipa::path(get, path="/api/authors/{id}", responses((status=200, body=AuthorDetailResponse)), tag="authors")]
pub async fn get_author(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AuthorDetailResponse>, ApiError> {
    let value = author::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author"))?;
    let summary = response_for_author(&state.db, value.clone()).await?;
    let resources = author_resource::Entity::find()
        .filter(author_resource::Column::AuthorId.eq(value.id.clone()))
        .all(&state.db)
        .await?;
    let manga_ids = resources
        .iter()
        .filter(|item| item.resource_type == "manga_series")
        .map(|item| item.resource_id.clone())
        .collect::<Vec<_>>();
    let photo_ids = resources
        .iter()
        .filter(|item| item.resource_type == "photo_asset")
        .map(|item| item.resource_id.clone())
        .collect::<Vec<_>>();
    let mut tags_by_series: HashMap<String, Vec<String>> = HashMap::new();
    for resource in tag_resource::Entity::find()
        .filter(tag_resource::Column::ResourceType.eq("manga_series"))
        .filter(tag_resource::Column::ResourceId.is_in(manga_ids.clone()))
        .all(&state.db)
        .await?
    {
        if let Some(value) = tag::Entity::find_by_id(resource.tag_id)
            .one(&state.db)
            .await?
        {
            tags_by_series
                .entry(resource.resource_id)
                .or_default()
                .push(value.name);
        }
    }
    let manga = manga_series::Entity::find()
        .filter(manga_series::Column::Id.is_in(manga_ids))
        .order_by_desc(manga_series::Column::CreatedAt)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|item| MangaSeriesResponse {
            id: item.id.clone(),
            library_id: item.library_id,
            title: item.title,
            layout: item.layout,
            cover_src: item
                .cover_file_id
                .as_ref()
                .map(|id| format!("/api/media/files/{id}/content")),
            author_name: Some(value.name.clone()),
            tags: tags_by_series.remove(&item.id).unwrap_or_default(),
            chapter_count: item.chapter_count,
            page_count: item.page_count,
        })
        .collect();
    let photos = photo_asset::Entity::find()
        .filter(photo_asset::Column::Id.is_in(photo_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(PhotoAssetResponse::from)
        .collect();
    let avatar_history = author_avatar::Entity::find()
        .filter(author_avatar::Column::AuthorId.eq(value.id.clone()))
        .order_by_desc(author_avatar::Column::CreatedAt)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|avatar| AuthorAvatarResponse {
            src: history_src(&value.id, &avatar.id),
            is_current: value.avatar_file_name.as_deref() == Some(avatar.file_name.as_str()),
            id: avatar.id,
        })
        .collect();
    Ok(Json(AuthorDetailResponse {
        id: summary.id,
        name: summary.name,
        avatar_src: summary.avatar_src,
        avatar_history,
        resource_count: summary.resource_count,
        resource_types: summary.resource_types,
        manga,
        photos,
    }))
}

pub async fn get_avatar(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<AvatarQuery>,
) -> Result<Response, ApiError> {
    let value = author::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author"))?;
    let file_name = match query.avatar_id {
        Some(avatar_id) => {
            author_avatar::Entity::find_by_id(avatar_id)
                .filter(author_avatar::Column::AuthorId.eq(value.id.clone()))
                .one(&state.db)
                .await?
                .ok_or(ApiError::NotFound("author avatar"))?
                .file_name
        }
        None => value
            .avatar_file_name
            .ok_or(ApiError::NotFound("author avatar"))?,
    };
    let bytes = tokio::fs::read(avatar_dir().join(file_name)).await?;
    Ok((
        [(header::CONTENT_TYPE, HeaderValue::from_static("image/*"))],
        bytes,
    )
        .into_response())
}

pub async fn upload_avatar(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<AuthorResponse>, ApiError> {
    if body.is_empty() || body.len() > 5 * 1024 * 1024 {
        return Err(ApiError::BadRequest("头像文件需小于 5MB".to_owned()));
    }
    let extension = if body.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if body.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else if body.starts_with(b"RIFF") && body.get(8..12) == Some(b"WEBP") {
        "webp"
    } else {
        return Err(ApiError::BadRequest(
            "仅支持 PNG、JPEG 或 WebP 图片".to_owned(),
        ));
    };
    let value = author::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author"))?;
    tokio::fs::create_dir_all(avatar_dir()).await?;
    let avatar_id = Uuid::new_v4().to_string();
    let file_name = format!("{}-{}.{}", value.id, avatar_id, extension);
    tokio::fs::write(avatar_dir().join(&file_name), body).await?;
    author_avatar::ActiveModel {
        id: Set(avatar_id),
        author_id: Set(value.id.clone()),
        file_name: Set(file_name.clone()),
        created_at: Set(Utc::now()),
    }
    .insert(&state.db)
    .await?;
    author::ActiveModel {
        id: Set(value.id.clone()),
        avatar_file_name: Set(Some(file_name)),
        updated_at: Set(Utc::now()),
        ..Default::default()
    }
    .update(&state.db)
    .await?;
    let updated = author::Entity::find_by_id(value.id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author"))?;
    Ok(Json(response_for_author(&state.db, updated).await?))
}

pub async fn select_avatar(
    State(state): State<AppState>,
    Path((id, avatar_id)): Path<(String, String)>,
) -> Result<Json<AuthorResponse>, ApiError> {
    let value = author::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author"))?;
    let avatar = author_avatar::Entity::find_by_id(avatar_id)
        .filter(author_avatar::Column::AuthorId.eq(value.id.clone()))
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author avatar"))?;
    author::ActiveModel {
        id: Set(value.id),
        avatar_file_name: Set(Some(avatar.file_name)),
        updated_at: Set(Utc::now()),
        ..Default::default()
    }
    .update(&state.db)
    .await?;
    let updated = author::Entity::find_by_id(avatar.author_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author"))?;
    Ok(Json(response_for_author(&state.db, updated).await?))
}

pub async fn delete_avatar(
    State(state): State<AppState>,
    Path((id, avatar_id)): Path<(String, String)>,
) -> Result<Json<AuthorResponse>, ApiError> {
    let value = author::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author"))?;
    let avatar = author_avatar::Entity::find_by_id(avatar_id)
        .filter(author_avatar::Column::AuthorId.eq(value.id.clone()))
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("author avatar"))?;
    if value.avatar_file_name.as_deref() == Some(avatar.file_name.as_str()) {
        return Err(ApiError::BadRequest("不能删除当前头像".to_owned()));
    }
    let _ = tokio::fs::remove_file(avatar_dir().join(&avatar.file_name)).await;
    author_avatar::Entity::delete_by_id(avatar.id)
        .exec(&state.db)
        .await?;
    Ok(Json(response_for_author(&state.db, value).await?))
}
