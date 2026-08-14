use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{
        app_task, manga_series, media_file, media_item, media_library, photo_asset, scan_task,
        video_asset, video_collection, video_collection_member, video_playback_state,
        webdav_connection,
    },
    modules::{
        libraries::dto::{
            CreateLibraryRequest, DeleteLibraryResponse, LibraryPreviewJobResponse,
            LibraryPreviewStatusResponse, LibraryResponse, PreviewGenerationTaskResponse,
            PreviewGenerationTaskStatus, UpdateLibraryPreviewConfigRequest, UpdateLibraryRequest,
            normalize_scan_extensions, serialize_scan_extensions,
        },
        photos::service::{
            PreviewGenerationProgress, PreviewOperationSummary, compute_library_status_map,
            delete_library_previews, generate_library_previews_with_progress,
        },
        tasks::{
            dto::TaskKind,
            service::{
                CreateAppTaskParams, PreviewTaskMetadata, UpdateAppTaskParams, create_app_task,
                find_running_library_task, preview_task_response_from_model,
                serialize_preview_metadata, update_app_task,
            },
        },
        videos::service::delete_library_covers,
    },
};

#[utoipa::path(
    get,
    path = "/api/libraries",
    responses((status = 200, description = "List media libraries", body = [LibraryResponse])),
    tag = "libraries"
)]
pub async fn list_libraries(
    State(state): State<AppState>,
) -> Result<Json<Vec<LibraryResponse>>, ApiError> {
    let libraries = media_library::Entity::find()
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
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LibraryResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;

    let status_map = compute_library_status_map(&state.db, &[library.id.clone()]).await?;
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
    if active_library.source_type.as_ref() == "webdav" {
        if let sea_orm::ActiveValue::Set(path) = &active_library.root_path {
            if path.contains("://") || path.contains('\\') {
                return Err(ApiError::BadRequest(
                    "WebDAV path must be relative to the selected connection".to_owned(),
                ));
            }
        }
    }

    active_library.updated_at = Set(now);
    let library = active_library.update(&state.db).await?;

    let status_map = compute_library_status_map(&state.db, &[library.id.clone()]).await?;
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

    let status_map = compute_library_status_map(&state.db, &[library.id.clone()]).await?;
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

    if find_running_library_task(&state.db, &library.id, TaskKind::GenerateCache)
        .await?
        .is_some()
        || find_running_library_task(&state.db, &library.id, TaskKind::ScanLibrary)
            .await?
            .is_some()
        || find_running_library_task(&state.db, &library.id, TaskKind::VideoCoverGenerate)
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

    if find_running_library_task(&state.db, &library.id, TaskKind::GenerateCache)
        .await?
        .is_some()
        || find_running_library_task(&state.db, &library.id, TaskKind::ScanLibrary)
            .await?
            .is_some()
    {
        return Err(ApiError::BadRequest(
            "library already has a running background task".to_owned(),
        ));
    }

    let now = Utc::now();
    let task_id = Uuid::new_v4().to_string();
    let task_model = create_app_task(
        &state.db,
        CreateAppTaskParams {
            id: task_id.clone(),
            kind: TaskKind::GenerateCache.to_string(),
            title: "Generate previews".to_owned(),
            library_id: Some(library.id.clone()),
            status: PreviewGenerationTaskStatus::Queued.to_string(),
            progress_percent: 0,
            processed_items: 0,
            total_items: 0,
            detail: Some("generated 0 previews, skipped 0".to_owned()),
            error_message: None,
            metadata_json: Some(serialize_preview_metadata(&PreviewTaskMetadata::default())?),
            created_at: now,
            finished_at: None,
        },
    )
    .await?;
    let task = preview_task_response_from_model(task_model);

    let state_for_task = state.clone();
    tokio::spawn(async move {
        let _ = set_task_status(
            &state_for_task.db,
            &task_id,
            PreviewGenerationTaskStatus::Running,
            None,
        )
        .await;

        let result = generate_library_previews_with_progress(
            &state_for_task.db,
            &library,
            false,
            Some(&task_id),
            |progress| {
                let db = state_for_task.db.clone();
                let task_id = task_id.clone();
                let progress = progress.clone();

                Box::pin(async move { update_task_progress(&db, &task_id, &progress).await })
            },
        )
        .await;

        match result {
            Ok(summary) => {
                let _ = complete_task_success(&state_for_task.db, &task_id, summary).await;
            }
            Err(ApiError::TaskCanceled) => {
                let _ = complete_task_canceled(&state_for_task.db, &task_id).await;
            }
            Err(err) => {
                let _ =
                    complete_task_failure(&state_for_task.db, &task_id, format!("{err:?}")).await;
            }
        }
    });

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
    State(state): State<AppState>,
    Path((library_id, task_id)): Path<(String, String)>,
) -> Result<Json<PreviewGenerationTaskResponse>, ApiError> {
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

async fn update_task_progress(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
    progress: &PreviewGenerationProgress,
) -> Result<(), ApiError> {
    let detail = format!(
        "已生成预览图 {}，已跳过 {}",
        progress.generated_previews, progress.skipped_assets
    );
    let metadata_json = serialize_preview_metadata(&PreviewTaskMetadata {
        generated_previews: progress.generated_previews,
        skipped_assets: progress.skipped_assets,
    })?;

    let _ = update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            progress_percent: Some(calculate_progress_percent(
                progress.processed_assets,
                progress.total_assets,
            )),
            processed_items: Some(progress.processed_assets),
            total_items: Some(progress.total_assets),
            detail: Some(Some(detail)),
            metadata_json: Some(Some(metadata_json)),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?;

    Ok(())
}

async fn set_task_status(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
    status: PreviewGenerationTaskStatus,
    error_message: Option<String>,
) -> Result<(), ApiError> {
    let _ = update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(status.to_string()),
            error_message: Some(error_message),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?;

    Ok(())
}

async fn complete_task_success(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
    summary: PreviewOperationSummary,
) -> Result<(), ApiError> {
    let now = Utc::now();
    let detail = format!(
        "已生成预览图 {}，已跳过 {}",
        summary.generated_previews, summary.skipped_assets
    );
    let metadata_json = serialize_preview_metadata(&PreviewTaskMetadata {
        generated_previews: summary.generated_previews,
        skipped_assets: summary.skipped_assets,
    })?;

    let _ = update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(PreviewGenerationTaskStatus::Completed.to_string()),
            progress_percent: Some(100),
            processed_items: Some(summary.processed_assets),
            detail: Some(Some(detail)),
            error_message: Some(None),
            metadata_json: Some(Some(metadata_json)),
            finished_at: Some(Some(now)),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?;

    Ok(())
}

async fn complete_task_canceled(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
) -> Result<(), ApiError> {
    let now = Utc::now();
    let _ = update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(PreviewGenerationTaskStatus::Canceled.to_string()),
            error_message: Some(None),
            finished_at: Some(Some(now)),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?;

    Ok(())
}

async fn complete_task_failure(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
    error_message: String,
) -> Result<(), ApiError> {
    let now = Utc::now();

    let _ = update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(PreviewGenerationTaskStatus::Failed.to_string()),
            error_message: Some(Some(error_message)),
            finished_at: Some(Some(now)),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?;

    Ok(())
}

fn calculate_progress_percent(processed_assets: i64, total_assets: i64) -> i32 {
    if total_assets <= 0 {
        return 100;
    }

    ((processed_assets as f64 / total_assets as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as i32
}
