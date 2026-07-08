use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{app_task, media_file, media_item, media_library, photo_asset, scan_task},
    modules::{
        libraries::dto::{
            CreateLibraryRequest, DeleteLibraryResponse, LibraryResponse, LibraryThumbnailJobResponse,
            LibraryThumbnailStatusResponse, ThumbnailGenerationTaskResponse,
            ThumbnailGenerationTaskStatus, UpdateLibraryRequest,
            UpdateLibraryThumbnailConfigRequest,
        },
        photos::service::{
            ThumbnailGenerationProgress, ThumbnailOperationSummary, compute_library_status_map,
            delete_library_thumbnails, generate_library_thumbnails_with_progress,
        },
        tasks::{
            dto::TaskKind,
            service::{
                CreateAppTaskParams, ThumbnailTaskMetadata, UpdateAppTaskParams, create_app_task,
                find_running_library_task, serialize_thumbnail_metadata,
                thumbnail_task_response_from_model, update_app_task,
            },
        },
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
    let library_ids = libraries.iter().map(|library| library.id.clone()).collect::<Vec<_>>();
    let status_map = compute_library_status_map(&state.db, &library_ids).await?;
    let libraries = libraries
        .into_iter()
        .map(|library| {
            let thumbnail_status = status_map
                .get(&library.id)
                .cloned()
                .map(LibraryThumbnailStatusResponse::from)
                .unwrap_or_default();

            LibraryResponse::from_model(library, thumbnail_status)
        })
        .collect();

    Ok(Json(libraries))
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
    Json(payload): Json<CreateLibraryRequest>,
) -> Result<Json<LibraryResponse>, ApiError> {
    let library = payload.into_active_model().insert(&state.db).await?;

    Ok(Json(LibraryResponse::from_model(
        library,
        LibraryThumbnailStatusResponse::default(),
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
    let thumbnail_status = status_map
        .get(&library.id)
        .cloned()
        .map(LibraryThumbnailStatusResponse::from)
        .unwrap_or_default();

    Ok(Json(LibraryResponse::from_model(library, thumbnail_status)))
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

    if let Some(thumbnails_enabled) = payload.thumbnails_enabled {
        active_library.thumbnails_enabled = Set(thumbnails_enabled);
    }

    active_library.updated_at = Set(now);
    let library = active_library.update(&state.db).await?;

    let status_map = compute_library_status_map(&state.db, &[library.id.clone()]).await?;
    let thumbnail_status = status_map
        .get(&library.id)
        .cloned()
        .map(LibraryThumbnailStatusResponse::from)
        .unwrap_or_default();

    Ok(Json(LibraryResponse::from_model(library, thumbnail_status)))
}

#[utoipa::path(
    put,
    path = "/api/libraries/{id}/thumbnails/settings",
    params(("id" = String, Path, description = "Library id")),
    request_body = UpdateLibraryThumbnailConfigRequest,
    responses(
        (status = 200, description = "Updated media library thumbnail config", body = LibraryResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn update_library_thumbnail_config(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateLibraryThumbnailConfigRequest>,
) -> Result<Json<LibraryResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    let now = Utc::now();
    let mut active_library: media_library::ActiveModel = library.into();
    active_library.thumbnails_enabled = Set(payload.thumbnails_enabled);
    active_library.updated_at = Set(now);
    let library = active_library.update(&state.db).await?;

    let status_map = compute_library_status_map(&state.db, &[library.id.clone()]).await?;
    let thumbnail_status = status_map
        .get(&library.id)
        .cloned()
        .map(LibraryThumbnailStatusResponse::from)
        .unwrap_or_default();

    Ok(Json(LibraryResponse::from_model(library, thumbnail_status)))
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
    {
        return Err(ApiError::BadRequest(
            "library still has a running background task".to_owned(),
        ));
    }

    delete_library_thumbnails(&state.db, &library).await?;

    let txn = state.db.begin().await?;
    photo_asset::Entity::delete_many()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
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
    path = "/api/libraries/{id}/thumbnails/generate",
    params(("id" = String, Path, description = "Library id")),
    responses(
        (status = 200, description = "Started thumbnail generation task for library", body = ThumbnailGenerationTaskResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn generate_library_thumbnail_assets(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ThumbnailGenerationTaskResponse>, ApiError> {
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
            title: "Generate thumbnails".to_owned(),
            library_id: Some(library.id.clone()),
            status: ThumbnailGenerationTaskStatus::Queued.to_string(),
            progress_percent: 0,
            processed_items: 0,
            total_items: 0,
            detail: Some("generated 0 thumbnails, 0 previews, skipped 0".to_owned()),
            error_message: None,
            metadata_json: Some(serialize_thumbnail_metadata(&ThumbnailTaskMetadata::default())?),
            created_at: now,
            finished_at: None,
        },
    )
    .await?;
    let task = thumbnail_task_response_from_model(task_model);

    let state_for_task = state.clone();
    tokio::spawn(async move {
        let _ = set_task_status(
            &state_for_task.db,
            &task_id,
            ThumbnailGenerationTaskStatus::Running,
            None,
        )
        .await;

        let result = generate_library_thumbnails_with_progress(
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
                let _ = complete_task_failure(&state_for_task.db, &task_id, format!("{err:?}")).await;
            }
        }
    });

    Ok(Json(task))
}

#[utoipa::path(
    get,
    path = "/api/libraries/{id}/thumbnails/tasks/{task_id}",
    params(
        ("id" = String, Path, description = "Library id"),
        ("task_id" = String, Path, description = "Thumbnail generation task id")
    ),
    responses(
        (status = 200, description = "Thumbnail generation task status", body = ThumbnailGenerationTaskResponse),
        (status = 404, description = "Thumbnail generation task not found")
    ),
    tag = "libraries"
)]
pub async fn get_library_thumbnail_generation_task(
    State(state): State<AppState>,
    Path((library_id, task_id)): Path<(String, String)>,
) -> Result<Json<ThumbnailGenerationTaskResponse>, ApiError> {
    let task = app_task::Entity::find_by_id(task_id)
        .filter(app_task::Column::LibraryId.eq(library_id))
        .filter(app_task::Column::Kind.eq(TaskKind::GenerateCache.to_string()))
        .one(&state.db)
        .await?
        .map(thumbnail_task_response_from_model)
        .ok_or(ApiError::NotFound("thumbnail generation task"))?;

    Ok(Json(task))
}

#[utoipa::path(
    delete,
    path = "/api/libraries/{id}/thumbnails",
    params(("id" = String, Path, description = "Library id")),
    responses(
        (status = 200, description = "Deleted thumbnails for library", body = LibraryThumbnailJobResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn delete_library_thumbnail_assets(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LibraryThumbnailJobResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    let summary = delete_library_thumbnails(&state.db, &library).await?;

    Ok(Json(LibraryThumbnailJobResponse::from_summary(
        library.id,
        summary,
    )))
}

impl From<crate::modules::photos::service::ThumbnailStatus> for LibraryThumbnailStatusResponse {
    fn from(value: crate::modules::photos::service::ThumbnailStatus) -> Self {
        Self {
            total_assets: value.total_assets,
            thumb_ready_assets: value.thumb_ready_assets,
            preview_ready_assets: value.preview_ready_assets,
            pending_assets: value.pending_assets,
            thumb_total_bytes: value.thumb_total_bytes,
            preview_total_bytes: value.preview_total_bytes,
            last_generated_at: value.last_generated_at,
        }
    }
}

impl LibraryThumbnailJobResponse {
    fn from_summary(library_id: String, value: ThumbnailOperationSummary) -> Self {
        Self {
            library_id,
            processed_assets: value.processed_assets,
            generated_thumbnails: value.generated_thumbnails,
            generated_previews: value.generated_previews,
            skipped_assets: value.skipped_assets,
            deleted_thumbnails: value.deleted_thumbnails,
            deleted_previews: value.deleted_previews,
            reclaimed_bytes: value.reclaimed_bytes,
        }
    }
}

async fn update_task_progress(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
    progress: &ThumbnailGenerationProgress,
) -> Result<(), ApiError> {
    let detail = format!(
        "generated {} thumbnails, {} previews, skipped {}",
        progress.generated_thumbnails, progress.generated_previews, progress.skipped_assets
    );
    let metadata_json = serialize_thumbnail_metadata(&ThumbnailTaskMetadata {
        generated_thumbnails: progress.generated_thumbnails,
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
    status: ThumbnailGenerationTaskStatus,
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
    summary: ThumbnailOperationSummary,
) -> Result<(), ApiError> {
    let now = Utc::now();
    let detail = format!(
        "generated {} thumbnails, {} previews, skipped {}",
        summary.generated_thumbnails, summary.generated_previews, summary.skipped_assets
    );
    let metadata_json = serialize_thumbnail_metadata(&ThumbnailTaskMetadata {
        generated_thumbnails: summary.generated_thumbnails,
        generated_previews: summary.generated_previews,
        skipped_assets: summary.skipped_assets,
    })?;

    let _ = update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(ThumbnailGenerationTaskStatus::Completed.to_string()),
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
            status: Some(ThumbnailGenerationTaskStatus::Canceled.to_string()),
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
            status: Some(ThumbnailGenerationTaskStatus::Failed.to_string()),
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
