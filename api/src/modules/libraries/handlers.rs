use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_file, media_item, media_library, photo_asset, scan_task},
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

    {
        let tasks = state
            .thumbnail_generation_tasks
            .lock()
            .map_err(|_| ApiError::BadRequest("thumbnail task state lock poisoned".to_owned()))?;

        if tasks.values().any(|task| {
            task.library_id == library.id && matches!(task.status.as_str(), "queued" | "running")
        }) {
            return Err(ApiError::BadRequest(
                "当前媒体库存在进行中的缩略图任务，无法删除".to_owned(),
            ));
        }
    }

    delete_library_thumbnails(&state.db, &library).await?;

    photo_asset::Entity::delete_many()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .exec(&state.db)
        .await?;
    media_file::Entity::delete_many()
        .filter(media_file::Column::LibraryId.eq(library.id.clone()))
        .exec(&state.db)
        .await?;
    media_item::Entity::delete_many()
        .filter(media_item::Column::LibraryId.eq(library.id.clone()))
        .exec(&state.db)
        .await?;
    scan_task::Entity::delete_many()
        .filter(scan_task::Column::LibraryId.eq(library.id.clone()))
        .exec(&state.db)
        .await?;
    media_library::Entity::delete_by_id(library.id.clone())
        .exec(&state.db)
        .await?;

    if let Ok(mut tasks) = state.thumbnail_generation_tasks.lock() {
        tasks.retain(|_, task| task.library_id != library.id);
    }

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
    {
        let tasks = state
            .thumbnail_generation_tasks
            .lock()
            .map_err(|_| ApiError::BadRequest("thumbnail task state lock poisoned".to_owned()))?;

        if tasks.values().any(|task| {
            task.library_id == library.id
                && matches!(
                    task.status.as_str(),
                    "queued" | "running"
                )
        }) {
            return Err(ApiError::BadRequest("当前媒体库已有缩略图生成任务正在运行".to_owned()));
        }
    }

    let now = Utc::now();
    let task_id = Uuid::new_v4().to_string();
    let task = ThumbnailGenerationTaskResponse::new(
        task_id.clone(),
        library.id.clone(),
        now,
    );

    {
        let mut tasks = state
            .thumbnail_generation_tasks
            .lock()
            .map_err(|_| ApiError::BadRequest("thumbnail task state lock poisoned".to_owned()))?;
        tasks.insert(task_id.clone(), task.clone());
    }

    let state_for_task = state.clone();
    tokio::spawn(async move {
        set_task_status(
            &state_for_task,
            &task_id,
            ThumbnailGenerationTaskStatus::Running,
            None,
        );

        let result = generate_library_thumbnails_with_progress(
            &state_for_task.db,
            &library,
            false,
            |progress| update_task_progress(&state_for_task, &task_id, progress),
        )
        .await;

        match result {
            Ok(summary) => complete_task_success(&state_for_task, &task_id, summary),
            Err(err) => complete_task_failure(&state_for_task, &task_id, format!("{err:?}")),
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
    let tasks = state
        .thumbnail_generation_tasks
        .lock()
        .map_err(|_| ApiError::BadRequest("thumbnail task state lock poisoned".to_owned()))?;
    let task = tasks
        .get(&task_id)
        .filter(|task| task.library_id == library_id)
        .cloned()
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

fn update_task_progress(
    state: &AppState,
    task_id: &str,
    progress: &ThumbnailGenerationProgress,
) {
    let now = Utc::now();

    if let Ok(mut tasks) = state.thumbnail_generation_tasks.lock() {
        if let Some(task) = tasks.get_mut(task_id) {
            task.total_assets = progress.total_assets;
            task.processed_assets = progress.processed_assets;
            task.generated_thumbnails = progress.generated_thumbnails;
            task.generated_previews = progress.generated_previews;
            task.skipped_assets = progress.skipped_assets;
            task.progress_percent = calculate_progress_percent(
                progress.processed_assets,
                progress.total_assets,
            );
            task.updated_at = now;
        }
    }
}

fn set_task_status(
    state: &AppState,
    task_id: &str,
    status: ThumbnailGenerationTaskStatus,
    error_message: Option<String>,
) {
    let now = Utc::now();

    if let Ok(mut tasks) = state.thumbnail_generation_tasks.lock() {
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = status.to_string();
            task.error_message = error_message;
            task.updated_at = now;
        }
    }
}

fn complete_task_success(
    state: &AppState,
    task_id: &str,
    summary: ThumbnailOperationSummary,
) {
    let now = Utc::now();

    if let Ok(mut tasks) = state.thumbnail_generation_tasks.lock() {
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = ThumbnailGenerationTaskStatus::Completed.to_string();
            task.processed_assets = summary.processed_assets;
            task.generated_thumbnails = summary.generated_thumbnails;
            task.generated_previews = summary.generated_previews;
            task.skipped_assets = summary.skipped_assets;
            task.progress_percent = 100;
            task.updated_at = now;
            task.finished_at = Some(now);
            task.error_message = None;
        }
    }
}

fn complete_task_failure(
    state: &AppState,
    task_id: &str,
    error_message: String,
) {
    let now = Utc::now();

    if let Ok(mut tasks) = state.thumbnail_generation_tasks.lock() {
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = ThumbnailGenerationTaskStatus::Failed.to_string();
            task.updated_at = now;
            task.finished_at = Some(now);
            task.error_message = Some(error_message);
        }
    }
}

fn calculate_progress_percent(processed_assets: i64, total_assets: i64) -> i32 {
    if total_assets <= 0 {
        return 100;
    }

    ((processed_assets as f64 / total_assets as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as i32
}
