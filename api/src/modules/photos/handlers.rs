use axum::{
    Json,
    extract::{Path, Query, State},
};
use sea_orm::{EntityTrait, QueryOrder, QuerySelect};
use serde::Deserialize;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::photo_asset,
    modules::photos::{
        dto::{DeletePhotoResponse, PhotoAssetResponse},
        service::delete_photo_asset,
    },
};

#[derive(Debug, Deserialize)]
pub struct ListPhotosQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/api/photos",
    responses((status = 200, description = "List scanned photos", body = [PhotoAssetResponse])),
    tag = "photos"
)]
pub async fn list_photos(
    State(state): State<AppState>,
    Query(query): Query<ListPhotosQuery>,
) -> Result<Json<Vec<PhotoAssetResponse>>, ApiError> {
    let mut select = photo_asset::Entity::find().order_by_desc(photo_asset::Column::BatchTime);

    if let Some(limit) = query.limit {
        select = select.limit(limit);
    }

    if let Some(offset) = query.offset {
        select = select.offset(offset);
    }

    let photos = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(PhotoAssetResponse::from)
        .collect();

    Ok(Json(photos))
}

#[utoipa::path(
    delete,
    path = "/api/photos/{photo_id}",
    params(
        ("photo_id" = String, Path, description = "Photo asset ID")
    ),
    responses((status = 200, description = "Delete photo asset and source file", body = DeletePhotoResponse)),
    tag = "photos"
)]
pub async fn delete_photo(
    State(state): State<AppState>,
    Path(photo_id): Path<String>,
) -> Result<Json<DeletePhotoResponse>, ApiError> {
    let asset = delete_photo_asset(&state.db, &photo_id).await?;

    Ok(Json(DeletePhotoResponse {
        id: asset.id,
        file_id: asset.file_id,
        item_id: asset.item_id,
        source_path: asset.source_path,
    }))
}
