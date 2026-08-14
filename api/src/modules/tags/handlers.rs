use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{
        manga_series, media_item, media_library, photo_asset, photo_folder, tag, tag_resource,
    },
    modules::tags::dto::{
        CreateTagRequest, ReplaceResourceTagsRequest, TagResourceResponse, TagResponse,
        UpdateTagRequest,
    },
};

#[derive(Debug, Deserialize)]
pub struct ListTagsQuery {
    pub query: Option<String>,
}

fn normalized_name(name: &str) -> Result<(String, String), ApiError> {
    let display_name = name.trim();
    if display_name.is_empty() || display_name.chars().count() > 64 {
        return Err(ApiError::BadRequest(
            "tag name must contain 1 to 64 characters".to_owned(),
        ));
    }
    Ok((display_name.to_owned(), display_name.to_lowercase()))
}

fn is_supported_resource_type(resource_type: &str) -> bool {
    matches!(
        resource_type,
        "media_item" | "photo_asset" | "photo_folder" | "manga_series" | "media_library"
    )
}

async fn resource_exists(
    db: &sea_orm::DatabaseConnection,
    resource_type: &str,
    resource_id: &str,
) -> Result<bool, ApiError> {
    let exists = match resource_type {
        "media_item" => media_item::Entity::find_by_id(resource_id)
            .one(db)
            .await?
            .is_some(),
        "photo_asset" => photo_asset::Entity::find_by_id(resource_id)
            .one(db)
            .await?
            .is_some(),
        "photo_folder" => photo_folder::Entity::find_by_id(resource_id)
            .one(db)
            .await?
            .is_some(),
        "manga_series" => manga_series::Entity::find_by_id(resource_id)
            .one(db)
            .await?
            .is_some(),
        "media_library" => media_library::Entity::find_by_id(resource_id)
            .one(db)
            .await?
            .is_some(),
        _ => false,
    };
    Ok(exists)
}

async fn responses_for_tags(
    db: &sea_orm::DatabaseConnection,
    tags: Vec<tag::Model>,
) -> Result<Vec<TagResponse>, ApiError> {
    let tag_ids = tags
        .iter()
        .map(|value| value.id.clone())
        .collect::<Vec<_>>();
    let mut usage = HashMap::<String, i64>::new();
    if !tag_ids.is_empty() {
        for resource in tag_resource::Entity::find()
            .filter(tag_resource::Column::TagId.is_in(tag_ids))
            .all(db)
            .await?
        {
            *usage.entry(resource.tag_id).or_default() += 1;
        }
    }
    Ok(tags
        .into_iter()
        .map(|value| {
            let id = value.id.clone();
            TagResponse {
                resource_count: usage.remove(&id).unwrap_or_default(),
                id: id.clone(),
                name: value.name,
                normalized_name: value.normalized_name,
                avatar_url: value.avatar_url.as_ref().map(|_| {
                    format!(
                        "/api/tags/{}/avatar?v={}",
                        id,
                        value.updated_at.timestamp_millis()
                    )
                }),
                background_url: value.background_url,
                created_at: value.created_at,
                updated_at: value.updated_at,
            }
        })
        .collect())
}

fn avatar_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("avatars")
        .join("tags")
}

pub async fn get_avatar(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let value = tag::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("tag"))?;
    let file_name = value.avatar_url.ok_or(ApiError::NotFound("tag avatar"))?;
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
) -> Result<Json<TagResponse>, ApiError> {
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
    let value = tag::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("tag"))?;
    tokio::fs::create_dir_all(avatar_dir()).await?;
    let file_name = format!("{}-{}.{}", value.id, Uuid::new_v4(), extension);
    tokio::fs::write(avatar_dir().join(&file_name), body).await?;
    let previous_file_name = value.avatar_url.clone();
    let mut active: tag::ActiveModel = value.into();
    active.avatar_url = Set(Some(file_name));
    active.updated_at = Set(Utc::now());
    let updated = active.update(&state.db).await?;
    if let Some(previous_file_name) = previous_file_name {
        let _ = tokio::fs::remove_file(avatar_dir().join(previous_file_name)).await;
    }
    Ok(Json(
        responses_for_tags(&state.db, vec![updated])
            .await?
            .remove(0),
    ))
}

#[utoipa::path(get, path = "/api/tags/{id}/resources", params(("id" = String, Path)), responses((status = 200, body = [TagResourceResponse])), tag = "tags")]
pub async fn list_tag_resources(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<TagResourceResponse>>, ApiError> {
    let links = tag_resource::Entity::find()
        .filter(tag_resource::Column::TagId.eq(id))
        .all(&state.db)
        .await?;
    let mut result = Vec::new();
    for link in links {
        match link.resource_type.as_str() {
            "manga_series" => {
                if let Some(value) = manga_series::Entity::find_by_id(link.resource_id)
                    .one(&state.db)
                    .await?
                {
                    result.push(TagResourceResponse {
                        id: value.id,
                        resource_type: link.resource_type,
                        title: value.title,
                        image_src: value
                            .cover_file_id
                            .map(|id| format!("/api/media/files/{id}/content")),
                    });
                }
            }
            "photo_asset" => {
                if let Some(value) = photo_asset::Entity::find_by_id(link.resource_id)
                    .one(&state.db)
                    .await?
                {
                    result.push(TagResourceResponse {
                        id: value.id,
                        resource_type: link.resource_type,
                        title: value.title,
                        image_src: Some(format!("/api/media/files/{}/content", value.file_id)),
                    });
                }
            }
            "media_item" => {
                if let Some(value) = media_item::Entity::find_by_id(link.resource_id)
                    .one(&state.db)
                    .await?
                {
                    result.push(TagResourceResponse {
                        id: value.id,
                        resource_type: link.resource_type,
                        title: value.title,
                        image_src: None,
                    });
                }
            }
            _ => {}
        }
    }
    Ok(Json(result))
}

#[utoipa::path(
    get,
    path = "/api/tags",
    params(("query" = Option<String>, Query, description = "Filter tags by name")),
    responses((status = 200, description = "Global tag library", body = [TagResponse])),
    tag = "tags"
)]
pub async fn list_tags(
    State(state): State<AppState>,
    Query(query): Query<ListTagsQuery>,
) -> Result<Json<Vec<TagResponse>>, ApiError> {
    let mut select = tag::Entity::find().order_by_asc(tag::Column::Name);
    if let Some(query) = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        select = select.filter(tag::Column::NormalizedName.contains(&query.to_lowercase()));
    }
    Ok(Json(
        responses_for_tags(&state.db, select.all(&state.db).await?).await?,
    ))
}

#[utoipa::path(post, path = "/api/tags", request_body = CreateTagRequest, responses((status = 200, body = TagResponse)), tag = "tags")]
pub async fn create_tag(
    State(state): State<AppState>,
    Json(payload): Json<CreateTagRequest>,
) -> Result<Json<TagResponse>, ApiError> {
    let (name, normalized_name) = normalized_name(&payload.name)?;
    if tag::Entity::find()
        .filter(tag::Column::NormalizedName.eq(normalized_name.clone()))
        .one(&state.db)
        .await?
        .is_some()
    {
        return Err(ApiError::BadRequest(
            "a tag with this name already exists".to_owned(),
        ));
    }
    let now = Utc::now();
    let created = tag::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        name: Set(name),
        normalized_name: Set(normalized_name),
        avatar_url: Set(payload.avatar_url),
        background_url: Set(payload.background_url),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(
        responses_for_tags(&state.db, vec![created])
            .await?
            .remove(0),
    ))
}

#[utoipa::path(put, path = "/api/tags/{id}", params(("id" = String, Path, description = "Tag id")), request_body = UpdateTagRequest, responses((status = 200, body = TagResponse), (status = 404)), tag = "tags")]
pub async fn update_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateTagRequest>,
) -> Result<Json<TagResponse>, ApiError> {
    let (name, normalized_name) = normalized_name(&payload.name)?;
    let current = tag::Entity::find_by_id(id.clone())
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("tag"))?;
    if let Some(existing) = tag::Entity::find()
        .filter(tag::Column::NormalizedName.eq(normalized_name.clone()))
        .one(&state.db)
        .await?
    {
        if existing.id != id {
            return Err(ApiError::BadRequest(
                "a tag with this name already exists".to_owned(),
            ));
        }
    }
    let mut active: tag::ActiveModel = current.into();
    active.name = Set(name);
    active.normalized_name = Set(normalized_name);
    if payload.avatar_url.is_some() {
        active.avatar_url = Set(payload.avatar_url);
    }
    if payload.background_url.is_some() {
        active.background_url = Set(payload.background_url);
    }
    active.updated_at = Set(Utc::now());
    let updated = active.update(&state.db).await?;
    Ok(Json(
        responses_for_tags(&state.db, vec![updated])
            .await?
            .remove(0),
    ))
}

#[utoipa::path(delete, path = "/api/tags/{id}", params(("id" = String, Path, description = "Tag id")), responses((status = 204), (status = 404)), tag = "tags")]
pub async fn delete_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let txn = state.db.begin().await?;
    let value = tag::Entity::find_by_id(id.clone())
        .one(&txn)
        .await?
        .ok_or(ApiError::NotFound("tag"))?;
    tag_resource::Entity::delete_many()
        .filter(tag_resource::Column::TagId.eq(id.clone()))
        .exec(&txn)
        .await?;
    tag::Entity::delete_by_id(id).exec(&txn).await?;
    txn.commit().await?;
    if let Some(file_name) = value.avatar_url {
        let _ = tokio::fs::remove_file(avatar_dir().join(file_name)).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/tags", responses((status = 204)), tag = "tags")]
pub async fn clear_tags(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    let txn = state.db.begin().await?;
    tag_resource::Entity::delete_many().exec(&txn).await?;
    tag::Entity::delete_many().exec(&txn).await?;
    txn.commit().await?;
    let _ = tokio::fs::remove_dir_all(avatar_dir()).await;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/tags/resources/{resource_type}/{resource_id}", params(("resource_type" = String, Path), ("resource_id" = String, Path)), responses((status = 200, body = [TagResponse]), (status = 404)), tag = "tags")]
pub async fn list_resource_tags(
    State(state): State<AppState>,
    Path((resource_type, resource_id)): Path<(String, String)>,
) -> Result<Json<Vec<TagResponse>>, ApiError> {
    if !is_supported_resource_type(&resource_type)
        || !resource_exists(&state.db, &resource_type, &resource_id).await?
    {
        return Err(ApiError::NotFound("taggable resource"));
    }
    let ids = tag_resource::Entity::find()
        .filter(tag_resource::Column::ResourceType.eq(resource_type))
        .filter(tag_resource::Column::ResourceId.eq(resource_id))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|value| value.tag_id)
        .collect::<Vec<_>>();
    let tags = tag::Entity::find()
        .filter(tag::Column::Id.is_in(ids))
        .order_by_asc(tag::Column::Name)
        .all(&state.db)
        .await?;
    Ok(Json(responses_for_tags(&state.db, tags).await?))
}

#[utoipa::path(put, path = "/api/tags/resources/{resource_type}/{resource_id}", params(("resource_type" = String, Path), ("resource_id" = String, Path)), request_body = ReplaceResourceTagsRequest, responses((status = 200, body = [TagResponse]), (status = 404)), tag = "tags")]
pub async fn replace_resource_tags(
    State(state): State<AppState>,
    Path((resource_type, resource_id)): Path<(String, String)>,
    Json(payload): Json<ReplaceResourceTagsRequest>,
) -> Result<Json<Vec<TagResponse>>, ApiError> {
    if !is_supported_resource_type(&resource_type)
        || !resource_exists(&state.db, &resource_type, &resource_id).await?
    {
        return Err(ApiError::NotFound("taggable resource"));
    }
    let tag_ids = payload
        .tag_ids
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let tags = tag::Entity::find()
        .filter(tag::Column::Id.is_in(tag_ids.clone()))
        .all(&state.db)
        .await?;
    if tags.len() != tag_ids.len() {
        return Err(ApiError::BadRequest(
            "one or more tags do not exist".to_owned(),
        ));
    }
    let txn = state.db.begin().await?;
    tag_resource::Entity::delete_many()
        .filter(tag_resource::Column::ResourceType.eq(resource_type.clone()))
        .filter(tag_resource::Column::ResourceId.eq(resource_id.clone()))
        .exec(&txn)
        .await?;
    let now = Utc::now();
    for tag_id in &tag_ids {
        tag_resource::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            tag_id: Set(tag_id.clone()),
            resource_type: Set(resource_type.clone()),
            resource_id: Set(resource_id.clone()),
            created_at: Set(now),
        }
        .insert(&txn)
        .await?;
    }
    txn.commit().await?;
    Ok(Json(responses_for_tags(&state.db, tags).await?))
}
