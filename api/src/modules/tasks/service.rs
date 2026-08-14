use chrono::{DateTime, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;

use crate::{
    core::error::ApiError,
    infra::entities::{app_task, scan_task},
    modules::{
        libraries::dto::PreviewGenerationTaskResponse,
        tasks::dto::{TaskKind, TaskResponse},
    },
};

#[derive(Debug)]
pub struct CreateAppTaskParams {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub library_id: Option<String>,
    pub status: String,
    pub progress_percent: i32,
    pub processed_items: i64,
    pub total_items: i64,
    pub detail: Option<String>,
    pub error_message: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default)]
pub struct UpdateAppTaskParams {
    pub status: Option<String>,
    pub progress_percent: Option<i32>,
    pub processed_items: Option<i64>,
    pub total_items: Option<i64>,
    pub detail: Option<Option<String>>,
    pub error_message: Option<Option<String>>,
    pub metadata_json: Option<Option<String>>,
    pub finished_at: Option<Option<DateTime<Utc>>>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct PreviewTaskMetadata {
    pub generated_previews: i64,
    pub skipped_assets: i64,
}

pub async fn create_app_task(
    db: &DatabaseConnection,
    params: CreateAppTaskParams,
) -> Result<app_task::Model, ApiError> {
    Ok(app_task::ActiveModel {
        id: Set(params.id),
        kind: Set(params.kind),
        title: Set(params.title),
        library_id: Set(params.library_id),
        status: Set(params.status),
        progress_percent: Set(params.progress_percent),
        processed_items: Set(params.processed_items),
        total_items: Set(params.total_items),
        detail: Set(params.detail),
        error_message: Set(params.error_message),
        metadata_json: Set(params.metadata_json),
        created_at: Set(params.created_at),
        updated_at: Set(params.created_at),
        finished_at: Set(params.finished_at),
    }
    .insert(db)
    .await?)
}

pub async fn update_app_task(
    db: &DatabaseConnection,
    task_id: &str,
    params: UpdateAppTaskParams,
) -> Result<Option<app_task::Model>, ApiError> {
    let Some(task) = app_task::Entity::find_by_id(task_id.to_owned())
        .one(db)
        .await?
    else {
        return Ok(None);
    };

    let mut active_task: app_task::ActiveModel = task.into();

    if let Some(status) = params.status {
        active_task.status = Set(status);
    }

    if let Some(progress_percent) = params.progress_percent {
        active_task.progress_percent = Set(progress_percent);
    }

    if let Some(processed_items) = params.processed_items {
        active_task.processed_items = Set(processed_items);
    }

    if let Some(total_items) = params.total_items {
        active_task.total_items = Set(total_items);
    }

    if let Some(detail) = params.detail {
        active_task.detail = Set(detail);
    }

    if let Some(error_message) = params.error_message {
        active_task.error_message = Set(error_message);
    }

    if let Some(metadata_json) = params.metadata_json {
        active_task.metadata_json = Set(metadata_json);
    }

    if let Some(finished_at) = params.finished_at {
        active_task.finished_at = Set(finished_at);
    }

    active_task.updated_at = Set(Utc::now());

    Ok(Some(active_task.update(db).await?))
}

pub async fn find_running_library_task(
    db: &DatabaseConnection,
    library_id: &str,
    kind: TaskKind,
) -> Result<Option<app_task::Model>, ApiError> {
    Ok(app_task::Entity::find()
        .filter(app_task::Column::LibraryId.eq(library_id.to_owned()))
        .filter(app_task::Column::Kind.eq(kind.to_string()))
        .filter(app_task::Column::FinishedAt.is_null())
        .filter(app_task::Column::Status.is_in(["queued", "running", "paused"]))
        .one(db)
        .await?)
}

pub async fn find_running_library_background_task(
    db: &DatabaseConnection,
    library_id: &str,
) -> Result<Option<app_task::Model>, ApiError> {
    Ok(app_task::Entity::find()
        .filter(app_task::Column::LibraryId.eq(library_id.to_owned()))
        .filter(app_task::Column::FinishedAt.is_null())
        .filter(app_task::Column::Status.is_in(["queued", "running", "paused"]))
        .one(db)
        .await?)
}

pub async fn recover_interrupted_tasks(db: &DatabaseConnection) -> Result<u64, ApiError> {
    let now = Utc::now();
    let tasks = app_task::Entity::find()
        .filter(app_task::Column::Status.is_in(["queued", "running", "paused"]))
        .filter(app_task::Column::FinishedAt.is_null())
        .all(db)
        .await?;
    let mut recovered = 0;
    for task in tasks {
        let task_id = task.id.clone();
        update_app_task(
            db,
            &task_id,
            UpdateAppTaskParams {
                status: Some("failed".to_owned()),
                error_message: Some(Some(
                    "task was interrupted by an application restart; start it again".to_owned(),
                )),
                finished_at: Some(Some(now)),
                ..Default::default()
            },
        )
        .await?;
        if task.kind == "scan_library"
            && let Some(scan) = scan_task::Entity::find_by_id(task_id).one(db).await?
        {
            let mut active: scan_task::ActiveModel = scan.into();
            active.status = Set("failed".to_owned());
            active.error_message = Set(Some(
                "task was interrupted by an application restart; start it again".to_owned(),
            ));
            active.finished_at = Set(Some(now));
            active.updated_at = Set(now);
            active.update(db).await?;
        }
        recovered += 1;
    }
    if recovered > 0 {
        tracing::warn!(recovered, "marked interrupted background tasks as failed");
    }
    Ok(recovered)
}

pub async fn get_app_task(
    db: &DatabaseConnection,
    task_id: &str,
) -> Result<Option<app_task::Model>, ApiError> {
    Ok(app_task::Entity::find_by_id(task_id.to_owned())
        .one(db)
        .await?)
}

pub async fn wait_for_task_permit(db: &DatabaseConnection, task_id: &str) -> Result<(), ApiError> {
    loop {
        let Some(task) = get_app_task(db, task_id).await? else {
            return Err(ApiError::TaskCanceled);
        };

        match task.status.as_str() {
            "queued" | "running" => return Ok(()),
            "paused" => sleep(Duration::from_millis(300)).await,
            "canceled" => return Err(ApiError::TaskCanceled),
            "completed" | "failed" => {
                return Err(ApiError::BadRequest(format!(
                    "task is no longer executable: {}",
                    task.status
                )));
            }
            _ => {
                return Err(ApiError::BadRequest(format!(
                    "task has unsupported execution status: {}",
                    task.status
                )));
            }
        }
    }
}

pub fn is_terminal_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "canceled")
}

pub fn can_pause_status(status: &str) -> bool {
    matches!(status, "queued" | "running")
}

pub fn can_resume_status(status: &str) -> bool {
    status == "paused"
}

pub fn can_cancel_status(status: &str) -> bool {
    matches!(status, "queued" | "running" | "paused")
}

pub fn task_response_from_model(
    value: app_task::Model,
    library_name: Option<String>,
    scan: Option<&scan_task::Model>,
) -> TaskResponse {
    let (scan_processed_items, scan_total_items, preview_processed_items, preview_total_items) =
        if value.kind == TaskKind::ScanLibrary.to_string() {
            let scan_total = scan.map(|item| item.discovered_files).unwrap_or(0).max(0);
            let scan_processed = scan
                .map(|item| item.processed_files)
                .unwrap_or(0)
                .max(0)
                .min(scan_total);
            (Some(scan_processed), Some(scan_total), None, None)
        } else if value.kind == TaskKind::GenerateCache.to_string()
            || value.kind == TaskKind::VideoCoverGenerate.to_string()
        {
            (
                None,
                None,
                Some(value.processed_items.max(0)),
                Some(value.total_items.max(0)),
            )
        } else {
            (None, None, None, None)
        };

    TaskResponse {
        id: value.id,
        kind: value.kind,
        title: value.title,
        library_id: value.library_id,
        library_name,
        status: value.status,
        progress_percent: value.progress_percent,
        scan_processed_items,
        scan_total_items,
        preview_processed_items,
        preview_total_items,
        detail: value.detail,
        error_message: value.error_message,
        created_at: value.created_at,
        updated_at: value.updated_at,
        finished_at: value.finished_at,
    }
}

pub fn preview_task_response_from_model(value: app_task::Model) -> PreviewGenerationTaskResponse {
    let metadata = parse_preview_metadata(value.metadata_json.as_deref());

    PreviewGenerationTaskResponse {
        task_id: value.id,
        library_id: value.library_id.unwrap_or_default(),
        status: value.status,
        total_assets: value.total_items,
        processed_assets: value.processed_items,
        generated_previews: metadata.generated_previews,
        skipped_assets: metadata.skipped_assets,
        progress_percent: value.progress_percent,
        error_message: value.error_message,
        created_at: value.created_at,
        updated_at: value.updated_at,
        finished_at: value.finished_at,
    }
}

pub fn serialize_preview_metadata(metadata: &PreviewTaskMetadata) -> Result<String, ApiError> {
    serde_json::to_string(metadata).map_err(|err| {
        ApiError::BadRequest(format!("failed to serialize preview task metadata: {err}"))
    })
}

pub fn parse_preview_metadata(metadata_json: Option<&str>) -> PreviewTaskMetadata {
    metadata_json
        .and_then(|value| serde_json::from_str::<PreviewTaskMetadata>(value).ok())
        .unwrap_or_default()
}
