use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde::Deserialize;
use tokio::fs;
use tokio_util::io::ReaderStream;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_file, media_item, photo_asset},
    modules::photos::service::resolve_derivative_path,
    modules::media::dto::{MediaFileResponse, MediaItemResponse},
};

#[derive(Debug, Deserialize)]
pub struct MediaContentQuery {
    pub variant: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListMediaQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/api/media/items",
    responses((status = 200, description = "List scanned media items", body = [MediaItemResponse])),
    tag = "media"
)]
pub async fn list_media_items(
    State(state): State<AppState>,
    Query(query): Query<ListMediaQuery>,
) -> Result<Json<Vec<MediaItemResponse>>, ApiError> {
    let mut select = media_item::Entity::find().order_by_desc(media_item::Column::CreatedAt);

    if let Some(limit) = query.limit {
        select = select.limit(limit);
    }

    if let Some(offset) = query.offset {
        select = select.offset(offset);
    }

    let items = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(MediaItemResponse::from)
        .collect();

    Ok(Json(items))
}

#[utoipa::path(
    get,
    path = "/api/media/files",
    responses((status = 200, description = "List scanned media files", body = [MediaFileResponse])),
    tag = "media"
)]
pub async fn list_media_files(
    State(state): State<AppState>,
    Query(query): Query<ListMediaQuery>,
) -> Result<Json<Vec<MediaFileResponse>>, ApiError> {
    let mut select = media_file::Entity::find().order_by_desc(media_file::Column::CreatedAt);

    if let Some(limit) = query.limit {
        select = select.limit(limit);
    }

    if let Some(offset) = query.offset {
        select = select.offset(offset);
    }

    let files = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(MediaFileResponse::from)
        .collect();

    Ok(Json(files))
}

#[utoipa::path(
    get,
    path = "/api/media/files/{id}/content",
    params(("id" = String, Path, description = "Media file id")),
    responses(
        (status = 200, description = "Media file content"),
        (status = 404, description = "Media file not found")
    ),
    tag = "media"
)]
pub async fn get_media_file_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<MediaContentQuery>,
) -> Result<Response, ApiError> {
    let file = media_file::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media file"))?;
    let requested_variant = query.variant.unwrap_or_else(|| "original".to_owned());

    if requested_variant == "thumbnail" || requested_variant == "preview" {
        let asset = photo_asset::Entity::find()
            .filter(photo_asset::Column::FileId.eq(file.id.clone()))
            .one(&state.db)
            .await?
            .ok_or(ApiError::NotFound("photo asset"))?;
        let derivative_path = resolve_derivative_path(&asset, &requested_variant)
            .ok_or(ApiError::NotFound("generated media variant"))?;
        let bytes = fs::read(derivative_path).await?;
        let content_type = asset
            .thumb_rel_path
            .as_deref()
            .filter(|_| requested_variant == "thumbnail")
            .or_else(|| {
                asset.preview_rel_path
                    .as_deref()
                    .filter(|_| requested_variant == "preview")
            })
            .map(derivative_content_type)
            .unwrap_or("application/octet-stream");

        return Ok((
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type.to_owned()),
                (header::CACHE_CONTROL, "public, max-age=3600".to_owned()),
            ],
            Body::from(bytes),
        )
            .into_response());
    }

    let source_file = fs::File::open(&file.full_path).await?;
    let content_type = file
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    let stream = ReaderStream::new(source_file);

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=3600".to_owned()),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}

fn derivative_content_type(relative_path: &str) -> &'static str {
    if relative_path.ends_with(".webp") {
        return "image/webp";
    }

    if relative_path.ends_with(".jpg") || relative_path.ends_with(".jpeg") {
        return "image/jpeg";
    }

    "application/octet-stream"
}
