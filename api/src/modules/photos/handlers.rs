use axum::{Json, extract::State};
use sea_orm::{EntityTrait, QueryOrder};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::photo_asset,
    modules::photos::dto::PhotoAssetResponse,
};

#[utoipa::path(
    get,
    path = "/api/photos",
    responses((status = 200, description = "List scanned photos", body = [PhotoAssetResponse])),
    tag = "photos"
)]
pub async fn list_photos(
    State(state): State<AppState>,
) -> Result<Json<Vec<PhotoAssetResponse>>, ApiError> {
    let photos = photo_asset::Entity::find()
        .order_by_desc(photo_asset::Column::BatchTime)
        .all(&state.db)
        .await?
        .into_iter()
        .map(PhotoAssetResponse::from)
        .collect();

    Ok(Json(photos))
}
