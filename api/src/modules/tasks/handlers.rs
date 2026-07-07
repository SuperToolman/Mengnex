use axum::{Json, extract::State};
use sea_orm::{EntityTrait, QueryOrder};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_library, scan_task},
    modules::tasks::dto::{TaskKind, TaskResponse},
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

    let scan_tasks = scan_task::Entity::find()
        .order_by_desc(scan_task::Column::UpdatedAt)
        .all(&state.db)
        .await?;

    let mut tasks = scan_tasks
        .into_iter()
        .map(|task| TaskResponse {
            id: task.id,
            kind: TaskKind::ScanLibrary.to_string(),
            title: "扫描媒体库".to_owned(),
            library_id: Some(task.library_id.clone()),
            library_name: library_name_map.get(&task.library_id).cloned(),
            status: task.status,
            progress_percent: if task.finished_at.is_some() { 100 } else { 0 },
            processed_items: task.discovered_files,
            total_items: task.discovered_files,
            detail: Some(format!(
                "发现 {} 个文件，新增 {} 个条目，更新 {} 个文件",
                task.discovered_files, task.inserted_items, task.updated_files
            )),
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
            finished_at: task.finished_at,
        })
        .collect::<Vec<_>>();

    if let Ok(thumbnail_tasks) = state.thumbnail_generation_tasks.lock() {
        tasks.extend(thumbnail_tasks.values().map(|task| TaskResponse {
            id: task.task_id.clone(),
            kind: TaskKind::GenerateCache.to_string(),
            title: "生成缩略图和预览图".to_owned(),
            library_id: Some(task.library_id.clone()),
            library_name: library_name_map.get(&task.library_id).cloned(),
            status: task.status.clone(),
            progress_percent: task.progress_percent,
            processed_items: task.processed_assets,
            total_items: task.total_assets,
            detail: Some(format!(
                "已生成 {} 个 Thumb、{} 个 Preview，跳过 {} 个资源",
                task.generated_thumbnails, task.generated_previews, task.skipped_assets
            )),
            error_message: task.error_message.clone(),
            created_at: task.created_at,
            updated_at: task.updated_at,
            finished_at: task.finished_at,
        }));
    }

    tasks.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    Ok(Json(tasks))
}
