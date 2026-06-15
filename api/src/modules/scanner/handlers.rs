use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_library, scan_task},
    modules::scanner::{
        dto::{CreateScanTaskRequest, ScanTaskResponse, ScanTaskStatus},
        service,
    },
};

#[utoipa::path(
    get,
    path = "/api/scans",
    responses((status = 200, description = "List scan tasks", body = [ScanTaskResponse])),
    tag = "scanner"
)]
pub async fn list_scan_tasks(
    State(state): State<AppState>,
) -> Result<Json<Vec<ScanTaskResponse>>, ApiError> {
    let tasks = scan_task::Entity::find()
        .order_by_desc(scan_task::Column::CreatedAt)
        .all(&state.db)
        .await?
        .into_iter()
        .map(ScanTaskResponse::from)
        .collect();

    Ok(Json(tasks))
}

#[utoipa::path(
    post,
    path = "/api/scans",
    request_body = CreateScanTaskRequest,
    responses(
        (status = 200, description = "Finished scan task", body = ScanTaskResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "scanner"
)]
pub async fn start_scan(
    State(state): State<AppState>,
    Json(payload): Json<CreateScanTaskRequest>,
) -> Result<Json<ScanTaskResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(payload.library_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;

    if !library.enabled {
        return Err(ApiError::BadRequest("media library is disabled".to_owned()));
    }

    let now = Utc::now();
    let task = scan_task::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        library_id: Set(library.id.clone()),
        status: Set(ScanTaskStatus::Running.to_string()),
        discovered_files: Set(0),
        inserted_items: Set(0),
        updated_files: Set(0),
        error_message: Set(None),
        started_at: Set(now),
        finished_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await?;

    let result = service::scan_library(&state.db, &library, task.id.clone()).await;

    let finished_at = Utc::now();
    let mut active_task: scan_task::ActiveModel = task.into();

    match result {
        Ok(summary) => {
            active_task.status = Set(ScanTaskStatus::Completed.to_string());
            active_task.discovered_files = Set(summary.discovered_files);
            active_task.inserted_items = Set(summary.inserted_items);
            active_task.updated_files = Set(summary.updated_files);
            active_task.error_message = Set(None);
        }
        Err(err) => {
            active_task.status = Set(ScanTaskStatus::Failed.to_string());
            active_task.error_message = Set(Some(format!("{err:?}")));
        }
    }

    active_task.finished_at = Set(Some(finished_at));
    active_task.updated_at = Set(finished_at);

    let task = active_task.update(&state.db).await?;

    Ok(Json(ScanTaskResponse::from(task)))
}
