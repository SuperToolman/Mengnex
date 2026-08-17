use axum::{
    Json,
    extract::{Extension, Path, State},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, Set, TransactionTrait,
};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{
        app_task, author_resource, manga_chapter, manga_page, manga_series, media_file, media_item,
        media_library, photo_asset, scan_task, tag_resource, video_asset, video_collection,
        video_collection_member, video_playback_state, webdav_connection,
    },
    modules::{
        auth::service::CurrentUser,
        libraries::cache::start_cache_generation,
        libraries::dto::{
            CreateLibraryRequest, DeleteLibraryResponse, LibraryCoversResponse,
            LibraryPreviewJobResponse, LibraryPreviewStatusResponse, LibraryResponse,
            PreviewGenerationTaskResponse, UpdateLibraryPreviewConfigRequest, UpdateLibraryRequest,
            normalize_scan_extensions, serialize_scan_extensions,
        },
        photos::dto::PhotoAssetResponse,
        photos::service::{
            PreviewOperationSummary, compute_library_status_map, delete_library_previews,
        },
        tasks::{
            dto::TaskKind,
            service::{find_running_library_background_task, preview_task_response_from_model},
        },
        videos::{dto::VideoAssetResponse, service::delete_library_covers},
    },
};

#[utoipa::path(get, path = "/api/libraries/covers", responses((status = 200, body = LibraryCoversResponse)), tag = "libraries")]
pub async fn list_library_covers(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<LibraryCoversResponse>, ApiError> {
    let mut library_select = media_library::Entity::find();
    if let Some(library_ids) = current.library_ids {
        library_select = library_select.filter(media_library::Column::Id.is_in(library_ids));
    }
    let libraries = library_select.all(&state.db).await?;
    let active_items = media_item::Entity::find()
        .select_only()
        .column(media_item::Column::Id)
        .filter(media_item::Column::DeletedAt.is_null())
        .filter(media_item::Column::SourceMissingAt.is_null())
        .into_query();
    let mut photos = Vec::new();
    let mut videos = Vec::new();
    for library in libraries {
        match library.media_type.as_str() {
            "photo" => {
                photos.extend(
                    photo_asset::Entity::find()
                        .filter(photo_asset::Column::LibraryId.eq(&library.id))
                        .filter(
                            sea_orm::sea_query::Expr::col(photo_asset::Column::ItemId)
                                .in_subquery(active_items.clone()),
                        )
                        .order_by_desc(photo_asset::Column::BatchTime)
                        .limit(5)
                        .all(&state.db)
                        .await?
                        .into_iter()
                        .map(PhotoAssetResponse::from),
                );
            }
            "video" | "mixed_video" => {
                videos.extend(
                    video_asset::Entity::find()
                        .filter(video_asset::Column::LibraryId.eq(&library.id))
                        .filter(
                            sea_orm::sea_query::Expr::col(video_asset::Column::ItemId)
                                .in_subquery(active_items.clone()),
                        )
                        .order_by_desc(video_asset::Column::CreatedAt)
                        .limit(3)
                        .all(&state.db)
                        .await?
                        .into_iter()
                        .map(VideoAssetResponse::from),
                );
            }
            _ => {}
        }
    }
    Ok(Json(LibraryCoversResponse { photos, videos }))
}

#[utoipa::path(
    get,
    path = "/api/libraries",
    responses((status = 200, description = "List media libraries", body = [LibraryResponse])),
    tag = "libraries"
)]
pub async fn list_libraries(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<LibraryResponse>>, ApiError> {
    let mut select = media_library::Entity::find();
    if let Some(library_ids) = current.library_ids {
        select = select.filter(media_library::Column::Id.is_in(library_ids));
    }
    let libraries = select
        .order_by_desc(media_library::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let library_ids = libraries
        .iter()
        .map(|library| library.id.clone())
        .collect::<Vec<_>>();
    let status_map = compute_library_status_map(&state.db, &library_ids).await?;
    let resource_counts = compute_resource_counts(&state.db, &libraries).await?;
    let libraries = libraries
        .into_iter()
        .map(|library| {
            let preview_status = status_map
                .get(&library.id)
                .cloned()
                .map(LibraryPreviewStatusResponse::from)
                .unwrap_or_default();

            let resource_count = resource_counts
                .get(&library.id)
                .copied()
                .unwrap_or_default();
            LibraryResponse::from_model(library, resource_count, preview_status)
        })
        .collect();

    Ok(Json(libraries))
}

async fn compute_resource_counts(
    db: &sea_orm::DatabaseConnection,
    libraries: &[media_library::Model],
) -> Result<std::collections::HashMap<String, i64>, ApiError> {
    let mut counts = std::collections::HashMap::new();
    for library in libraries {
        let count = if library.media_type == "manga" {
            manga_series::Entity::find()
                .filter(manga_series::Column::LibraryId.eq(&library.id))
                .count(db)
                .await? as i64
        } else {
            media_item::Entity::find()
                .filter(media_item::Column::LibraryId.eq(&library.id))
                .filter(media_item::Column::DeletedAt.is_null())
                .filter(media_item::Column::SourceMissingAt.is_null())
                .count(db)
                .await? as i64
        };
        counts.insert(library.id.clone(), count);
    }
    Ok(counts)
}

#[utoipa::path(
    post,
    path = "/api/libraries",
    request_body = CreateLibraryRequest,
    responses((status = 200, description = "Created media library", body = LibraryResponse)),
    tag = "libraries"
)]
pub async fn create_library(
    State(state): State<AppState>,
    Json(mut payload): Json<CreateLibraryRequest>,
) -> Result<Json<LibraryResponse>, ApiError> {
    if payload.media_type.to_string() == "video" {
        payload.scan_extensions = Some(
            normalize_scan_extensions(payload.scan_extensions.unwrap_or_else(|| {
                vec!["mp4", "mkv", "webm", "mov", "avi"]
                    .into_iter()
                    .map(str::to_owned)
                    .collect()
            }))
            .map_err(ApiError::BadRequest)?,
        );
        if payload.collections_enabled {
            let collection_type = payload.collection_type.as_deref().unwrap_or("normal");
            if !matches!(collection_type, "normal" | "difference") {
                return Err(ApiError::BadRequest(
                    "unsupported video collection type".to_owned(),
                ));
            }
            payload.collection_type = Some(collection_type.to_owned());
        } else {
            payload.collection_type = None;
        }
    } else {
        payload.scan_extensions = None;
        payload.collections_enabled = false;
        payload.collection_type = None;
    }
    if payload.source_type == "webdav" {
        let connection_id = payload
            .webdav_connection_id
            .as_deref()
            .ok_or_else(|| ApiError::BadRequest("WebDAV connection is required".to_owned()))?;
        if webdav_connection::Entity::find_by_id(connection_id)
            .one(&state.db)
            .await?
            .is_none()
        {
            return Err(ApiError::BadRequest(
                "WebDAV connection was not found".to_owned(),
            ));
        }
        if payload.root_path.contains("://") || payload.root_path.contains('\\') {
            return Err(ApiError::BadRequest(
                "WebDAV path must be relative to the selected connection".to_owned(),
            ));
        }
    } else if payload.source_type != "local" {
        return Err(ApiError::BadRequest(
            "unsupported library source type".to_owned(),
        ));
    }
    let library = payload.into_active_model().insert(&state.db).await?;

    Ok(Json(LibraryResponse::from_model(
        library,
        0,
        LibraryPreviewStatusResponse::default(),
    )))
}

#[utoipa::path(
    get,
    path = "/api/libraries/{id}",
    params(("id" = String, Path, description = "Library id")),
    responses(
        (status = 200, description = "Media library detail", body = LibraryResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn get_library(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LibraryResponse>, ApiError> {
    if !current.can_access_library(&id) {
        return Err(ApiError::NotFound("media library"));
    }
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;

    let status_map =
        compute_library_status_map(&state.db, std::slice::from_ref(&library.id)).await?;
    let preview_status = status_map
        .get(&library.id)
        .cloned()
        .map(LibraryPreviewStatusResponse::from)
        .unwrap_or_default();
    let resource_count = compute_resource_counts(&state.db, std::slice::from_ref(&library))
        .await?
        .get(&library.id)
        .copied()
        .unwrap_or_default();
    Ok(Json(LibraryResponse::from_model(
        library,
        resource_count,
        preview_status,
    )))
}

#[utoipa::path(
    put,
    path = "/api/libraries/{id}",
    params(("id" = String, Path, description = "Library id")),
    request_body = UpdateLibraryRequest,
    responses(
        (status = 200, description = "Updated media library", body = LibraryResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn update_library(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateLibraryRequest>,
) -> Result<Json<LibraryResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    let now = Utc::now();
    let mut active_library: media_library::ActiveModel = library.into();

    if let Some(name) = payload.name {
        active_library.name = Set(name);
    }

    if let Some(root_path) = payload.root_path {
        active_library.root_path = Set(root_path);
    }

    if let Some(enabled) = payload.enabled {
        active_library.enabled = Set(enabled);
    }

    if let Some(previews_enabled) = payload.previews_enabled {
        active_library.previews_enabled = Set(previews_enabled);
    }
    if let Some(source_type) = payload.source_type {
        active_library.source_type = Set(source_type);
    }
    if let Some(connection_id) = payload.webdav_connection_id {
        active_library.webdav_connection_id = Set(Some(connection_id));
    }
    if let Some(scan_extensions) = payload.scan_extensions {
        if active_library.media_type.as_ref() != "video" {
            return Err(ApiError::BadRequest(
                "scan extensions are only configurable for video libraries".to_owned(),
            ));
        }
        active_library.scan_extensions = Set(serialize_scan_extensions(Some(
            normalize_scan_extensions(scan_extensions).map_err(ApiError::BadRequest)?,
        )));
    }
    if let Some(collections_enabled) = payload.collections_enabled {
        if active_library.media_type.as_ref() != "video" {
            return Err(ApiError::BadRequest(
                "collections are only configurable for video libraries".to_owned(),
            ));
        }
        active_library.collections_enabled = Set(collections_enabled);
        if !collections_enabled {
            active_library.collection_type = Set(None);
        }
    }
    if let Some(collection_type) = payload.collection_type {
        if active_library.media_type.as_ref() != "video"
            || !matches!(collection_type.as_str(), "normal" | "difference")
        {
            return Err(ApiError::BadRequest(
                "unsupported video collection type".to_owned(),
            ));
        }
        active_library.collection_type = Set(Some(collection_type));
    }
    if active_library.source_type.as_ref() == "webdav"
        && let sea_orm::ActiveValue::Set(path) = &active_library.root_path
        && (path.contains("://") || path.contains('\\'))
    {
        return Err(ApiError::BadRequest(
            "WebDAV path must be relative to the selected connection".to_owned(),
        ));
    }

    active_library.updated_at = Set(now);
    let library = active_library.update(&state.db).await?;

    let status_map =
        compute_library_status_map(&state.db, std::slice::from_ref(&library.id)).await?;
    let preview_status = status_map
        .get(&library.id)
        .cloned()
        .map(LibraryPreviewStatusResponse::from)
        .unwrap_or_default();

    let resource_count = compute_resource_counts(&state.db, std::slice::from_ref(&library))
        .await?
        .get(&library.id)
        .copied()
        .unwrap_or_default();
    Ok(Json(LibraryResponse::from_model(
        library,
        resource_count,
        preview_status,
    )))
}

#[utoipa::path(
    put,
    path = "/api/libraries/{id}/previews/settings",
    params(("id" = String, Path, description = "Library id")),
    request_body = UpdateLibraryPreviewConfigRequest,
    responses(
        (status = 200, description = "Updated media library preview config", body = LibraryResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn update_library_preview_config(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateLibraryPreviewConfigRequest>,
) -> Result<Json<LibraryResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    let now = Utc::now();
    let mut active_library: media_library::ActiveModel = library.into();
    active_library.previews_enabled = Set(payload.previews_enabled);
    active_library.updated_at = Set(now);
    let library = active_library.update(&state.db).await?;

    let status_map =
        compute_library_status_map(&state.db, std::slice::from_ref(&library.id)).await?;
    let preview_status = status_map
        .get(&library.id)
        .cloned()
        .map(LibraryPreviewStatusResponse::from)
        .unwrap_or_default();

    let resource_count = compute_resource_counts(&state.db, std::slice::from_ref(&library))
        .await?
        .get(&library.id)
        .copied()
        .unwrap_or_default();
    Ok(Json(LibraryResponse::from_model(
        library,
        resource_count,
        preview_status,
    )))
}

#[utoipa::path(
    delete,
    path = "/api/libraries/{id}",
    params(("id" = String, Path, description = "Library id")),
    responses(
        (status = 200, description = "Deleted media library", body = DeleteLibraryResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn delete_library(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DeleteLibraryResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;

    if find_running_library_background_task(&state.db, &library.id)
        .await?
        .is_some()
    {
        return Err(ApiError::BadRequest(
            "library still has a running background task".to_owned(),
        ));
    }

    delete_library_previews(&state.db, &library).await?;
    delete_library_covers(&state.db, &library.id).await?;

    let library_video_ids = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(library.id.clone()))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|asset| asset.id)
        .collect::<Vec<_>>();
    let library_photo_ids = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|asset| asset.id)
        .collect::<Vec<_>>();
    let library_manga_ids = manga_series::Entity::find()
        .filter(manga_series::Column::LibraryId.eq(library.id.clone()))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|series| series.id)
        .collect::<Vec<_>>();
    let txn = state.db.begin().await?;
    let collection_ids = video_collection::Entity::find()
        .filter(video_collection::Column::LibraryId.eq(library.id.clone()))
        .all(&txn)
        .await?
        .into_iter()
        .map(|collection| collection.id)
        .collect::<Vec<_>>();
    if !collection_ids.is_empty() {
        video_collection_member::Entity::delete_many()
            .filter(video_collection_member::Column::CollectionId.is_in(collection_ids))
            .exec(&txn)
            .await?;
    }
    video_collection::Entity::delete_many()
        .filter(video_collection::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    photo_asset::Entity::delete_many()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    if !library_manga_ids.is_empty() {
        author_resource::Entity::delete_many()
            .filter(author_resource::Column::ResourceType.eq("manga_series"))
            .filter(author_resource::Column::ResourceId.is_in(library_manga_ids.clone()))
            .exec(&txn)
            .await?;
        tag_resource::Entity::delete_many()
            .filter(tag_resource::Column::ResourceType.eq("manga_series"))
            .filter(tag_resource::Column::ResourceId.is_in(library_manga_ids.clone()))
            .exec(&txn)
            .await?;
        let chapter_ids = manga_chapter::Entity::find()
            .filter(manga_chapter::Column::SeriesId.is_in(library_manga_ids.clone()))
            .all(&txn)
            .await?
            .into_iter()
            .map(|chapter| chapter.id)
            .collect::<Vec<_>>();
        if !chapter_ids.is_empty() {
            manga_page::Entity::delete_many()
                .filter(manga_page::Column::ChapterId.is_in(chapter_ids.clone()))
                .exec(&txn)
                .await?;
            manga_chapter::Entity::delete_many()
                .filter(manga_chapter::Column::Id.is_in(chapter_ids))
                .exec(&txn)
                .await?;
        }
        manga_series::Entity::delete_many()
            .filter(manga_series::Column::Id.is_in(library_manga_ids))
            .exec(&txn)
            .await?;
    }
    if !library_photo_ids.is_empty() {
        author_resource::Entity::delete_many()
            .filter(author_resource::Column::ResourceType.eq("photo_asset"))
            .filter(author_resource::Column::ResourceId.is_in(library_photo_ids))
            .exec(&txn)
            .await?;
    }
    if !library_video_ids.is_empty() {
        author_resource::Entity::delete_many()
            .filter(author_resource::Column::ResourceType.eq("video_asset"))
            .filter(author_resource::Column::ResourceId.is_in(library_video_ids.clone()))
            .exec(&txn)
            .await?;
    }
    if !library_video_ids.is_empty() {
        video_playback_state::Entity::delete_many()
            .filter(video_playback_state::Column::VideoAssetId.is_in(library_video_ids))
            .exec(&txn)
            .await?;
    }
    video_asset::Entity::delete_many()
        .filter(video_asset::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    media_file::Entity::delete_many()
        .filter(media_file::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    media_item::Entity::delete_many()
        .filter(media_item::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    scan_task::Entity::delete_many()
        .filter(scan_task::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    app_task::Entity::delete_many()
        .filter(app_task::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    media_library::Entity::delete_by_id(library.id.clone())
        .exec(&txn)
        .await?;
    txn.commit().await?;
    let preview_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("preview")
        .join(&library.id);
    match tokio::fs::remove_dir_all(&preview_dir).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(ApiError::Io(error)),
    }

    Ok(Json(DeleteLibraryResponse { id: library.id }))
}

#[utoipa::path(
    post,
    path = "/api/libraries/{id}/previews/generate",
    params(("id" = String, Path, description = "Library id")),
    responses(
        (status = 200, description = "Started preview generation task for library", body = PreviewGenerationTaskResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn generate_library_preview_assets(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PreviewGenerationTaskResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;

    let task_model = start_cache_generation(&state.db, library).await?;
    let task = preview_task_response_from_model(task_model);

    Ok(Json(task))
}

#[utoipa::path(
    get,
    path = "/api/libraries/{id}/previews/tasks/{task_id}",
    params(
        ("id" = String, Path, description = "Library id"),
        ("task_id" = String, Path, description = "Preview generation task id")
    ),
    responses(
        (status = 200, description = "Preview generation task status", body = PreviewGenerationTaskResponse),
        (status = 404, description = "Preview generation task not found")
    ),
    tag = "libraries"
)]
pub async fn get_library_preview_generation_task(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path((library_id, task_id)): Path<(String, String)>,
) -> Result<Json<PreviewGenerationTaskResponse>, ApiError> {
    if !current.can_access_library(&library_id) {
        return Err(ApiError::NotFound("preview generation task"));
    }
    let task = app_task::Entity::find_by_id(task_id)
        .filter(app_task::Column::LibraryId.eq(library_id))
        .filter(app_task::Column::Kind.eq(TaskKind::GenerateCache.to_string()))
        .one(&state.db)
        .await?
        .map(preview_task_response_from_model)
        .ok_or(ApiError::NotFound("preview generation task"))?;

    Ok(Json(task))
}

#[utoipa::path(
    delete,
    path = "/api/libraries/{id}/previews",
    params(("id" = String, Path, description = "Library id")),
    responses(
        (status = 200, description = "Deleted previews for library", body = LibraryPreviewJobResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn delete_library_preview_assets(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LibraryPreviewJobResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    let summary = delete_library_previews(&state.db, &library).await?;

    Ok(Json(LibraryPreviewJobResponse::from_summary(
        library.id, summary,
    )))
}

impl From<crate::modules::photos::service::PreviewStatus> for LibraryPreviewStatusResponse {
    fn from(value: crate::modules::photos::service::PreviewStatus) -> Self {
        Self {
            total_assets: value.total_assets,
            preview_ready_assets: value.preview_ready_assets,
            pending_assets: value.pending_assets,
            preview_total_bytes: value.preview_total_bytes,
            last_generated_at: value.last_generated_at,
        }
    }
}

impl LibraryPreviewJobResponse {
    fn from_summary(library_id: String, value: PreviewOperationSummary) -> Self {
        Self {
            library_id,
            processed_assets: value.processed_assets,
            generated_previews: value.generated_previews,
            skipped_assets: value.skipped_assets,
            deleted_previews: value.deleted_previews,
            reclaimed_bytes: value.reclaimed_bytes,
        }
    }
}
