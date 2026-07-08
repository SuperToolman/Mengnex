use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_library, scan_task},
    modules::scanner::{
        dto::{CreateScanTaskRequest, ScanTaskResponse, ScanTaskStatus},
        service::{self, ScanProgress},
    },
    modules::tasks::{
        dto::TaskKind,
        service::{CreateAppTaskParams, UpdateAppTaskParams, create_app_task, find_running_library_task, update_app_task},
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
        (status = 200, description = "Started scan task", body = ScanTaskResponse),
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

    if find_running_library_task(&state.db, &library.id, TaskKind::ScanLibrary)
        .await?
        .is_some()
        || find_running_library_task(&state.db, &library.id, TaskKind::GenerateCache)
            .await?
            .is_some()
    {
        return Err(ApiError::BadRequest(
            "library already has a running background task".to_owned(),
        ));
    }

    let now = Utc::now();
    let task = scan_task::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        library_id: Set(library.id.clone()),
        status: Set(ScanTaskStatus::Running.to_string()),
        discovered_files: Set(0),
        processed_files: Set(0),
        inserted_items: Set(0),
        updated_files: Set(0),
        removed_files: Set(0),
        error_message: Set(None),
        started_at: Set(now),
        finished_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await?;

    create_app_task(
        &state.db,
        CreateAppTaskParams {
            id: task.id.clone(),
            kind: TaskKind::ScanLibrary.to_string(),
            title: "Scan library".to_owned(),
            library_id: Some(library.id.clone()),
            status: ScanTaskStatus::Running.to_string(),
            progress_percent: 0,
            processed_items: 0,
            total_items: 0,
            detail: Some("discovered 0, inserted 0, updated 0, removed 0".to_owned()),
            error_message: None,
            metadata_json: None,
            created_at: now,
            finished_at: None,
        },
    )
    .await?;

    let task_id = task.id.clone();
    let state_for_task = state.clone();

    tokio::spawn(async move {
        let result = service::scan_library(
            &state_for_task.db,
            &library,
            task_id.clone(),
            |progress| {
                let db = state_for_task.db.clone();
                let task_id = task_id.clone();
                let progress = progress.clone();

                Box::pin(async move { update_scan_task_progress(&db, &task_id, &progress).await })
            },
        )
        .await;

        let _ = complete_scan_task(&state_for_task.db, &task_id, result).await;
    });

    Ok(Json(ScanTaskResponse::from(task)))
}

async fn update_scan_task_progress(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
    progress: &ScanProgress,
) -> Result<(), ApiError> {
    let Some(task) = scan_task::Entity::find_by_id(task_id.to_owned()).one(db).await? else {
        return Ok(());
    };

    let mut active_task: scan_task::ActiveModel = task.into();
    active_task.discovered_files = Set(progress.discovered_files);
    active_task.processed_files = Set(progress.processed_files);
    active_task.inserted_items = Set(progress.inserted_items);
    active_task.updated_files = Set(progress.updated_files);
    active_task.removed_files = Set(progress.removed_files);
    active_task.updated_at = Set(Utc::now());
    active_task.update(db).await?;
    let progress_percent = calculate_progress_percent(progress.processed_files, progress.discovered_files);
    let detail = format!(
        "discovered {}, inserted {}, updated {}, removed {}",
        progress.discovered_files, progress.inserted_items, progress.updated_files, progress.removed_files
    );
    let _ = update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            progress_percent: Some(progress_percent),
            processed_items: Some(progress.processed_files),
            total_items: Some(progress.discovered_files),
            detail: Some(Some(detail)),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?;

    Ok(())
}

async fn complete_scan_task(
    db: &sea_orm::DatabaseConnection,
    task_id: &str,
    result: Result<service::ScanSummary, ApiError>,
) -> Result<(), ApiError> {
    let Some(task) = scan_task::Entity::find_by_id(task_id.to_owned()).one(db).await? else {
        return Ok(());
    };

    let finished_at = Utc::now();
    let mut active_task: scan_task::ActiveModel = task.into();

    match result {
        Ok(summary) => {
            active_task.status = Set(ScanTaskStatus::Completed.to_string());
            active_task.discovered_files = Set(summary.discovered_files);
            active_task.processed_files = Set(summary.processed_files);
            active_task.inserted_items = Set(summary.inserted_items);
            active_task.updated_files = Set(summary.updated_files);
            active_task.removed_files = Set(summary.removed_files);
            active_task.error_message = Set(None);
            let progress_percent = calculate_progress_percent(summary.processed_files, summary.discovered_files);
            let detail = format!(
                "discovered {}, inserted {}, updated {}, removed {}",
                summary.discovered_files, summary.inserted_items, summary.updated_files, summary.removed_files
            );
            let _ = update_app_task(
                db,
                task_id,
                UpdateAppTaskParams {
                    status: Some(ScanTaskStatus::Completed.to_string()),
                    progress_percent: Some(progress_percent),
                    processed_items: Some(summary.processed_files),
                    total_items: Some(summary.discovered_files),
                    detail: Some(Some(detail)),
                    error_message: Some(None),
                    finished_at: Some(Some(finished_at)),
                    ..UpdateAppTaskParams::default()
                },
            )
            .await?;
        }
        Err(ApiError::TaskCanceled) => {
            active_task.status = Set(ScanTaskStatus::Canceled.to_string());
            active_task.error_message = Set(None);
            let _ = update_app_task(
                db,
                task_id,
                UpdateAppTaskParams {
                    status: Some(ScanTaskStatus::Canceled.to_string()),
                    error_message: Some(None),
                    finished_at: Some(Some(finished_at)),
                    ..UpdateAppTaskParams::default()
                },
            )
            .await?;
        }
        Err(err) => {
            active_task.status = Set(ScanTaskStatus::Failed.to_string());
            active_task.error_message = Set(Some(format!("{err:?}")));
            let _ = update_app_task(
                db,
                task_id,
                UpdateAppTaskParams {
                    status: Some(ScanTaskStatus::Failed.to_string()),
                    error_message: Some(Some(format!("{err:?}"))),
                    finished_at: Some(Some(finished_at)),
                    ..UpdateAppTaskParams::default()
                },
            )
            .await?;
        }
    }

    active_task.finished_at = Set(Some(finished_at));
    active_task.updated_at = Set(finished_at);
    active_task.update(db).await?;

    Ok(())
}

fn calculate_progress_percent(processed_items: i64, total_items: i64) -> i32 {
    if total_items <= 0 {
        return 100;
    }

    ((processed_items as f64 / total_items as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as i32
}
