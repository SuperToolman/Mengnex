use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, QueryOrder, Set};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{app_task, media_library, scan_task},
    modules::{
        libraries::dto::ThumbnailGenerationTaskStatus,
        scanner::dto::ScanTaskStatus,
        tasks::{
            dto::{TaskKind, TaskResponse, TaskStatus},
            service::{
                UpdateAppTaskParams, can_cancel_status, can_pause_status, can_resume_status,
                get_app_task, is_terminal_status, task_response_from_model, update_app_task,
            },
        },
    },
};

#[utoipa::path(
    get,
    path = "/api/tasks",
    responses((status = 200, description = "List application tasks", body = [TaskResponse])),
    tag = "tasks"
)]
pub async fn list_tasks(State(state): State<AppState>) -> Result<Json<Vec<TaskResponse>>, ApiError> {
    let libraries = media_library::Entity::find().all(&state.db).await?;
    let library_name_map = libraries
        .into_iter()
        .map(|library| (library.id, library.name))
        .collect::<std::collections::HashMap<_, _>>();

    let tasks = app_task::Entity::find()
        .order_by_desc(app_task::Column::UpdatedAt)
        .all(&state.db)
        .await?;

    let tasks = tasks
        .into_iter()
        .map(|task| {
            let library_name = task
                .library_id
                .as_ref()
                .and_then(|library_id| library_name_map.get(library_id).cloned());

            task_response_from_model(task, library_name)
        })
        .collect::<Vec<_>>();

    Ok(Json(tasks))
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/pause",
    params(("id" = String, Path, description = "Task id")),
    responses(
        (status = 200, description = "Paused task", body = TaskResponse),
        (status = 404, description = "Task not found")
    ),
    tag = "tasks"
)]
pub async fn pause_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaskResponse>, ApiError> {
    let task = get_task_or_not_found(&state, &id).await?;

    if !can_pause_status(&task.status) {
        return Err(ApiError::BadRequest(format!(
            "task cannot be paused from status {}",
            task.status
        )));
    }

    let updated = update_app_task(
        &state.db,
        &id,
        UpdateAppTaskParams {
            status: Some(status_for_pause(&task)),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?
    .ok_or(ApiError::NotFound("task"))?;

    sync_scan_task_status(&state, &updated, ScanTaskStatus::Paused, None, None).await?;

    Ok(Json(to_task_response(&state, updated).await?))
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/resume",
    params(("id" = String, Path, description = "Task id")),
    responses(
        (status = 200, description = "Resumed task", body = TaskResponse),
        (status = 404, description = "Task not found")
    ),
    tag = "tasks"
)]
pub async fn resume_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaskResponse>, ApiError> {
    let task = get_task_or_not_found(&state, &id).await?;

    if !can_resume_status(&task.status) {
        return Err(ApiError::BadRequest(format!(
            "task cannot be resumed from status {}",
            task.status
        )));
    }

    let updated = update_app_task(
        &state.db,
        &id,
        UpdateAppTaskParams {
            status: Some(status_for_resume(&task)),
            finished_at: Some(None),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?
    .ok_or(ApiError::NotFound("task"))?;

    sync_scan_task_status(&state, &updated, ScanTaskStatus::Running, None, None).await?;

    Ok(Json(to_task_response(&state, updated).await?))
}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/cancel",
    params(("id" = String, Path, description = "Task id")),
    responses(
        (status = 200, description = "Canceled task", body = TaskResponse),
        (status = 404, description = "Task not found")
    ),
    tag = "tasks"
)]
pub async fn cancel_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaskResponse>, ApiError> {
    let task = get_task_or_not_found(&state, &id).await?;

    if !can_cancel_status(&task.status) {
        if is_terminal_status(&task.status) {
            return Ok(Json(to_task_response(&state, task).await?));
        }

        return Err(ApiError::BadRequest(format!(
            "task cannot be canceled from status {}",
            task.status
        )));
    }

    let finished_at = Utc::now();
    let updated = update_app_task(
        &state.db,
        &id,
        UpdateAppTaskParams {
            status: Some(status_for_cancel(&task)),
            error_message: Some(None),
            finished_at: Some(Some(finished_at)),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?
    .ok_or(ApiError::NotFound("task"))?;

    sync_scan_task_status(&state, &updated, ScanTaskStatus::Canceled, None, Some(finished_at)).await?;

    Ok(Json(to_task_response(&state, updated).await?))
}

fn status_for_pause(task: &app_task::Model) -> String {
    match task.kind.as_str() {
        "generate_cache" => ThumbnailGenerationTaskStatus::Paused.to_string(),
        _ => TaskStatus::Paused.to_string(),
    }
}

fn status_for_resume(task: &app_task::Model) -> String {
    match task.kind.as_str() {
        "generate_cache" => ThumbnailGenerationTaskStatus::Running.to_string(),
        _ => TaskStatus::Running.to_string(),
    }
}

fn status_for_cancel(task: &app_task::Model) -> String {
    match task.kind.as_str() {
        "generate_cache" => ThumbnailGenerationTaskStatus::Canceled.to_string(),
        _ => TaskStatus::Canceled.to_string(),
    }
}

async fn get_task_or_not_found(
    state: &AppState,
    task_id: &str,
) -> Result<app_task::Model, ApiError> {
    get_app_task(&state.db, task_id)
        .await?
        .ok_or(ApiError::NotFound("task"))
}

async fn to_task_response(
    state: &AppState,
    task: app_task::Model,
) -> Result<TaskResponse, ApiError> {
    let library_name = match task.library_id.as_ref() {
        Some(library_id) => media_library::Entity::find_by_id(library_id.clone())
            .one(&state.db)
            .await?
            .map(|library| library.name),
        None => None,
    };

    Ok(task_response_from_model(task, library_name))
}

async fn sync_scan_task_status(
    state: &AppState,
    task: &app_task::Model,
    status: ScanTaskStatus,
    error_message: Option<String>,
    finished_at: Option<chrono::DateTime<Utc>>,
) -> Result<(), ApiError> {
    if task.kind != TaskKind::ScanLibrary.to_string() {
        return Ok(());
    }

    let Some(scan_task_model) = scan_task::Entity::find_by_id(task.id.clone()).one(&state.db).await? else {
        return Ok(());
    };

    let mut active_scan_task: scan_task::ActiveModel = scan_task_model.into();
    active_scan_task.status = Set(status.to_string());
    active_scan_task.error_message = Set(error_message);
    if let Some(finished_at) = finished_at {
        active_scan_task.finished_at = Set(Some(finished_at));
    }
    active_scan_task.updated_at = Set(Utc::now());
    active_scan_task.update(&state.db).await?;

    Ok(())
}
