use chrono::Utc;
use sea_orm::DatabaseConnection;
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{app_task, media_library},
    modules::{
        media_types::processor_for,
        photos::service::{
            PreviewGenerationProgress, PreviewOperationSummary,
            generate_library_previews_with_progress,
        },
        tasks::{
            dto::{TaskKind, TaskStatus},
            service::{
                CreateAppTaskParams, PreviewTaskMetadata, UpdateAppTaskParams, create_app_task,
                find_running_library_background_task, serialize_preview_metadata, update_app_task,
            },
        },
        videos::service::{VideoCoverSummary, generate_library_covers},
    },
};

pub async fn start_cache_generation(
    db: &DatabaseConnection,
    library: media_library::Model,
    force: bool,
) -> Result<app_task::Model, ApiError> {
    if find_running_library_background_task(db, &library.id)
        .await?
        .is_some()
    {
        return Err(ApiError::BadRequest(
            "library already has a running background task".to_owned(),
        ));
    }

    let task_id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let task = create_app_task(
        db,
        CreateAppTaskParams {
            id: task_id.clone(),
            kind: TaskKind::GenerateCache.to_string(),
            title: "生成浏览缓存".to_owned(),
            library_id: Some(library.id.clone()),
            status: TaskStatus::Queued.to_string(),
            progress_percent: 0,
            processed_items: 0,
            total_items: 0,
            detail: Some("等待处理媒体资源".to_owned()),
            error_message: None,
            metadata_json: Some(serialize_preview_metadata(&PreviewTaskMetadata::default())?),
            created_at: now,
            finished_at: None,
        },
    )
    .await?;

    let task_db = db.clone();
    tokio::spawn(async move {
        if let Err(error) = run_cache_generation(&task_db, &library, &task_id, force).await {
            tracing::error!(task_id, ?error, "browse cache task failed to finalize");
        }
    });

    Ok(task)
}

async fn run_cache_generation(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
    force: bool,
) -> Result<(), ApiError> {
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(TaskStatus::Running.to_string()),
            detail: Some(Some("正在生成浏览缓存".to_owned())),
            ..Default::default()
        },
    )
    .await?;

    let result = match processor_for(&library.media_type).map(|processor| processor.media_type()) {
        Some("photo") => generate_photo_cache(db, library, task_id, force).await,
        Some("video") => generate_video_cache(db, library, task_id, force).await,
        _ => Err(ApiError::BadRequest(format!(
            "media type {} does not support browse cache generation",
            library.media_type
        ))),
    };

    match result {
        Ok(summary) => complete_cache_task(db, task_id, summary).await,
        Err(ApiError::TaskCanceled) => cancel_cache_task(db, task_id).await,
        Err(error) => fail_cache_task(db, task_id, format!("{error:?}")).await,
    }
}

async fn generate_photo_cache(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
    force: bool,
) -> Result<PreviewOperationSummary, ApiError> {
    let progress_db = db.clone();
    let progress_task_id = task_id.to_owned();
    generate_library_previews_with_progress(db, library, force, Some(task_id), move |progress| {
        let db = progress_db.clone();
        let task_id = progress_task_id.clone();
        let progress = progress.clone();
        Box::pin(async move { update_cache_progress(&db, &task_id, &progress).await })
    })
    .await
}

async fn generate_video_cache(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
    force: bool,
) -> Result<PreviewOperationSummary, ApiError> {
    let summary = generate_library_covers(db, library, task_id, force, None).await?;
    Ok(video_summary_to_preview_summary(summary))
}

fn video_summary_to_preview_summary(summary: VideoCoverSummary) -> PreviewOperationSummary {
    PreviewOperationSummary {
        processed_assets: summary.processed_assets,
        generated_previews: summary.generated_covers,
        skipped_assets: summary.skipped_assets,
        failed_assets: summary.failed_assets,
        last_error: summary.last_error,
        deleted_previews: summary.deleted_covers,
        reclaimed_bytes: summary.reclaimed_bytes,
    }
}

async fn update_cache_progress(
    db: &DatabaseConnection,
    task_id: &str,
    progress: &PreviewGenerationProgress,
) -> Result<(), ApiError> {
    let metadata_json = serialize_preview_metadata(&PreviewTaskMetadata {
        generated_previews: progress.generated_previews,
        skipped_assets: progress.skipped_assets,
    })?;
    let mut detail = cache_detail(
        progress.generated_previews,
        progress.skipped_assets,
        progress.failed_assets,
    );
    if let Some(error) = progress.last_error.as_deref() {
        detail.push_str(&format!(
            "；最近错误：{}",
            error.chars().take(300).collect::<String>()
        ));
    }
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            progress_percent: Some(active_progress_percent(
                progress.processed_assets,
                progress.total_assets,
            )),
            processed_items: Some(progress.processed_assets),
            total_items: Some(progress.total_assets),
            detail: Some(Some(detail)),
            metadata_json: Some(Some(metadata_json)),
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}

async fn complete_cache_task(
    db: &DatabaseConnection,
    task_id: &str,
    summary: PreviewOperationSummary,
) -> Result<(), ApiError> {
    let failed = summary.failed_assets > 0;
    let metadata_json = serialize_preview_metadata(&PreviewTaskMetadata {
        generated_previews: summary.generated_previews,
        skipped_assets: summary.skipped_assets,
    })?;
    let error_message = failed.then(|| {
        summary
            .last_error
            .clone()
            .unwrap_or_else(|| format!("{} 个媒体资源生成浏览缓存失败", summary.failed_assets))
    });
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(if failed {
                TaskStatus::Failed.to_string()
            } else {
                TaskStatus::Completed.to_string()
            }),
            progress_percent: Some(100),
            processed_items: Some(summary.processed_assets),
            total_items: Some(summary.processed_assets),
            detail: Some(Some(cache_detail(
                summary.generated_previews,
                summary.skipped_assets,
                summary.failed_assets,
            ))),
            error_message: Some(error_message),
            metadata_json: Some(Some(metadata_json)),
            finished_at: Some(Some(Utc::now())),
        },
    )
    .await?;
    Ok(())
}

async fn cancel_cache_task(db: &DatabaseConnection, task_id: &str) -> Result<(), ApiError> {
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(TaskStatus::Canceled.to_string()),
            error_message: Some(None),
            finished_at: Some(Some(Utc::now())),
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}

async fn fail_cache_task(
    db: &DatabaseConnection,
    task_id: &str,
    error_message: String,
) -> Result<(), ApiError> {
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(TaskStatus::Failed.to_string()),
            error_message: Some(Some(error_message)),
            finished_at: Some(Some(Utc::now())),
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}

fn cache_detail(generated: i64, skipped: i64, failed: i64) -> String {
    format!("已生成 {generated}，已跳过 {skipped}，失败 {failed}")
}

fn active_progress_percent(processed: i64, total: i64) -> i32 {
    if total <= 0 {
        return 0;
    }
    (((processed as f64 / total as f64) * 100.0).round() as i32).clamp(0, 99)
}

#[cfg(test)]
mod tests {
    use super::active_progress_percent;

    #[test]
    fn active_cache_progress_never_claims_completion() {
        assert_eq!(active_progress_percent(0, 0), 0);
        assert_eq!(active_progress_percent(1, 2), 50);
        assert_eq!(active_progress_percent(2, 2), 99);
    }
}
