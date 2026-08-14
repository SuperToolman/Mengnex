use axum::{
    Json,
    extract::{Extension, Path, State},
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_item, media_library, photo_asset},
    modules::{
        auth::service::CurrentUser,
        photos::folders::refresh_photo_folder_index,
        recycle_bin::{
            dto::{
                PurgeRecycleBinItemResponse, RecycleBinItemResponse, RestoreRecycleBinItemResponse,
            },
            service::{purge_media_item, restore_media_item},
        },
    },
};

#[utoipa::path(get, path = "/api/recycle-bin", responses((status = 200, body = [RecycleBinItemResponse])), tag = "recycle-bin")]
pub async fn list_recycle_bin(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<RecycleBinItemResponse>>, ApiError> {
    let mut select = media_item::Entity::find();
    if let Some(library_ids) = current.library_ids {
        select = select.filter(media_item::Column::LibraryId.is_in(library_ids));
    }
    let items = select
        .filter(media_item::Column::DeletedAt.is_not_null())
        .order_by_desc(media_item::Column::DeletedAt)
        .all(&state.db)
        .await?;
    let mut response = Vec::with_capacity(items.len());

    for item in items {
        let asset = photo_asset::Entity::find()
            .filter(photo_asset::Column::ItemId.eq(item.id.clone()))
            .one(&state.db)
            .await?;
        let file_id = asset.as_ref().map(|value| value.file_id.clone());
        let image_src = asset.as_ref().and_then(|value| {
            value
                .preview_rel_path
                .as_ref()
                .map(|_| format!("/api/media/files/{}/content?variant=preview", value.file_id))
        });
        response.push(RecycleBinItemResponse {
            id: item.id,
            media_type: item.media_type,
            title: item.title,
            original_path: item.original_path,
            file_id,
            image_src,
            deleted_at: item
                .deleted_at
                .expect("filtered deleted media item must have deleted_at"),
        });
    }

    Ok(Json(response))
}

#[utoipa::path(post, path = "/api/recycle-bin/{item_id}/restore", params(("item_id" = String, Path)), responses((status = 200, body = RestoreRecycleBinItemResponse)), tag = "recycle-bin")]
pub async fn restore_item(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(item_id): Path<String>,
) -> Result<Json<RestoreRecycleBinItemResponse>, ApiError> {
    let item = media_item::Entity::find_by_id(item_id.clone())
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("recycle bin item"))?;
    if !current.can_access_library(&item.library_id) {
        return Err(ApiError::NotFound("recycle bin item"));
    }
    restore_media_item(&state.db, &item_id).await?;
    if item.media_type == "photo"
        && let Some(library) = media_library::Entity::find_by_id(item.library_id)
            .one(&state.db)
            .await?
    {
        refresh_photo_folder_index(&state.db, &library).await?;
    }
    Ok(Json(RestoreRecycleBinItemResponse { id: item_id }))
}

#[utoipa::path(delete, path = "/api/recycle-bin/{item_id}", params(("item_id" = String, Path)), responses((status = 200, body = PurgeRecycleBinItemResponse)), tag = "recycle-bin")]
pub async fn purge_item(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(item_id): Path<String>,
) -> Result<Json<PurgeRecycleBinItemResponse>, ApiError> {
    let item = media_item::Entity::find_by_id(&item_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("recycle bin item"))?;
    if !current.can_access_library(&item.library_id) {
        return Err(ApiError::NotFound("recycle bin item"));
    }
    purge_media_item(&state.db, &item_id).await?;
    Ok(Json(PurgeRecycleBinItemResponse { id: item_id }))
}
