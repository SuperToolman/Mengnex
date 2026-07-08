use axum::{
    Json,
    extract::{Query, State},
};
use sea_orm::{EntityTrait, QueryOrder, QuerySelect};
use serde::Deserialize;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::photo_asset,
    modules::photos::dto::PhotoAssetResponse,
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
