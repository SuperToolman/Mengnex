use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use sea_orm::{EntityTrait, QueryOrder};
use tokio::fs;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_file, media_item},
    modules::media::dto::{MediaFileResponse, MediaItemResponse},
};

#[utoipa::path(
    get,
    path = "/api/media/items",
    responses((status = 200, description = "List scanned media items", body = [MediaItemResponse])),
    tag = "media"
)]
pub async fn list_media_items(
    State(state): State<AppState>,
) -> Result<Json<Vec<MediaItemResponse>>, ApiError> {
    let items = media_item::Entity::find()
        .order_by_desc(media_item::Column::CreatedAt)
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
) -> Result<Json<Vec<MediaFileResponse>>, ApiError> {
    let files = media_file::Entity::find()
        .order_by_desc(media_file::Column::CreatedAt)
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
) -> Result<Response, ApiError> {
    let file = media_file::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media file"))?;
    let bytes = fs::read(&file.full_path).await?;
    let content_type = file
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_owned());

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=3600".to_owned()),
        ],
        Body::from(bytes),
    )
        .into_response())
}
