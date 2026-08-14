use axum::{
    Json,
    extract::{Path, Query, State},
};
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
    sea_query::Expr,
};
use serde::Deserialize;
use std::collections::HashMap;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_item, media_library, photo_asset, photo_folder},
    modules::photos::{
        dto::{
            DeletePhotoResponse, PhotoAssetResponse, PhotoFolderContentsResponse,
            PhotoFolderResponse,
        },
        folders::{ensure_photo_folder_index, refresh_photo_folder_index},
        service::delete_photo_asset,
    },
};

#[derive(Debug, Deserialize)]
pub struct ListPhotosQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub library_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListFolderContentsQuery {
    pub path: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/api/photos",
    params(
        ("limit" = Option<u64>, Query, description = "Maximum number of photos"),
        ("offset" = Option<u64>, Query, description = "Number of photos to skip"),
        ("library_id" = Option<String>, Query, description = "Limit results to one media library")
    ),
    responses((status = 200, description = "List scanned photos", body = [PhotoAssetResponse])),
    tag = "photos"
)]
pub async fn list_photos(
    State(state): State<AppState>,
    Query(query): Query<ListPhotosQuery>,
) -> Result<Json<Vec<PhotoAssetResponse>>, ApiError> {
    let deleted_items = media_item::Entity::find()
        .select_only()
        .column(media_item::Column::Id)
        .filter(media_item::Column::DeletedAt.is_not_null())
        .into_query();
    let mut select = photo_asset::Entity::find()
        .filter(Expr::col(photo_asset::Column::ItemId).not_in_subquery(deleted_items))
        .order_by_desc(photo_asset::Column::BatchTime);

    if let Some(library_id) = query.library_id {
        select = select.filter(photo_asset::Column::LibraryId.eq(library_id));
    }

    select = select.limit(bounded_limit(query.limit));

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
    get,
    path = "/api/photos/folders/{library_id}",
    params(
        ("library_id" = String, Path, description = "Media library ID"),
        ("path" = Option<String>, Query, description = "Relative folder path"),
        ("limit" = Option<u64>, Query, description = "Maximum direct photos"),
        ("offset" = Option<u64>, Query, description = "Number of direct photos to skip")
    ),
    responses((status = 200, description = "Folder contents", body = PhotoFolderContentsResponse)),
    tag = "photos"
)]
pub async fn list_folder_contents(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
    Query(query): Query<ListFolderContentsQuery>,
) -> Result<Json<PhotoFolderContentsResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(library_id.clone())
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    ensure_photo_folder_index(&state.db, &library).await?;
    let active_path = normalize_relative_path(query.path.as_deref().unwrap_or(""));
    let deleted_items = media_item::Entity::find()
        .select_only()
        .column(media_item::Column::Id)
        .filter(media_item::Column::DeletedAt.is_not_null())
        .into_query();
    let photos_query = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library_id.clone()))
        .filter(photo_asset::Column::FolderPath.eq(active_path.clone()))
        .filter(Expr::col(photo_asset::Column::ItemId).not_in_subquery(deleted_items))
        .order_by_desc(photo_asset::Column::BatchTime);
    let total_photos = photos_query.clone().count(&state.db).await? as i64;
    let offset = query.offset.unwrap_or_default() as usize;
    let limit = query.limit.unwrap_or(100).clamp(1, 500) as usize;
    let photos = photos_query
        .offset(offset as u64)
        .limit(limit as u64)
        .all(&state.db)
        .await?
        .into_iter()
        .map(PhotoAssetResponse::from)
        .collect::<Vec<_>>();
    let next_offset =
        (offset + photos.len() < total_photos as usize).then_some((offset + photos.len()) as u64);
    let folder_models = photo_folder::Entity::find()
        .filter(photo_folder::Column::LibraryId.eq(library_id.clone()))
        .filter(photo_folder::Column::ParentPath.eq(active_path.clone()))
        .filter(photo_folder::Column::Path.ne(active_path.clone()))
        .order_by_asc(photo_folder::Column::Name)
        .all(&state.db)
        .await?;
    let cover_ids = folder_models
        .iter()
        .filter_map(|folder| folder.cover_asset_id.clone())
        .collect::<Vec<_>>();
    let covers = photo_asset::Entity::find()
        .filter(photo_asset::Column::Id.is_in(cover_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|asset| (asset.id.clone(), PhotoAssetResponse::from(asset)))
        .collect::<HashMap<_, _>>();
    let folders = folder_models
        .into_iter()
        .map(|folder| PhotoFolderResponse {
            name: folder.name,
            path: folder.path,
            photo_count: folder.photo_count,
            cover: folder
                .cover_asset_id
                .as_ref()
                .and_then(|asset_id| covers.get(asset_id).cloned()),
        })
        .collect();

    Ok(Json(PhotoFolderContentsResponse {
        library_id,
        path: active_path,
        folders,
        photos,
        total_photos,
        next_offset,
    }))
}

fn normalize_relative_path(path: &str) -> String {
    path.trim_matches('/').to_owned()
}

fn bounded_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(100).clamp(1, 500)
}

#[cfg(test)]
mod tests {
    use super::bounded_limit;

    #[test]
    fn bounds_photo_list_limits() {
        assert_eq!(bounded_limit(None), 100);
        assert_eq!(bounded_limit(Some(0)), 1);
        assert_eq!(bounded_limit(Some(200)), 200);
        assert_eq!(bounded_limit(Some(999)), 500);
    }
}

#[utoipa::path(
    delete,
    path = "/api/photos/{photo_id}",
    params(
        ("photo_id" = String, Path, description = "Photo asset ID")
    ),
    responses((status = 200, description = "Move photo asset to recycle bin", body = DeletePhotoResponse)),
    tag = "photos"
)]
pub async fn delete_photo(
    State(state): State<AppState>,
    Path(photo_id): Path<String>,
) -> Result<Json<DeletePhotoResponse>, ApiError> {
    let asset = delete_photo_asset(&state.db, &photo_id).await?;
    let library = media_library::Entity::find_by_id(asset.library_id.clone())
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    refresh_photo_folder_index(&state.db, &library).await?;

    Ok(Json(DeletePhotoResponse {
        id: asset.id,
        file_id: asset.file_id,
        item_id: asset.item_id,
        source_path: asset.source_path,
    }))
}
