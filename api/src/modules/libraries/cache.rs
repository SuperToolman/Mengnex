use chrono::Utc;
use sea_orm::DatabaseConnection;
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{app_task, media_library},
    modules::{
        media_types::processor_for,
        music::service::generate_library_music_metadata,
        novels::service::generate_library_novel_metadata,
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
        videos::service::{
            VideoAnalysisSummary, VideoCoverSummary, analyze_library_assets,
            generate_library_covers, video_progress_baseline,
        },
    },
};

pub async fn start_cache_generation(
    db: &DatabaseConnection,
    library: media_library::Model,
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
            title: "生成媒体信息".to_owned(),
            library_id: Some(library.id.clone()),
            status: TaskStatus::Queued.to_string(),
            progress_percent: 0,
            processed_items: 0,
            total_items: 0,
            detail: Some("等待生成媒体信息".to_owned()),
            error_message: None,
            metadata_json: Some(serialize_preview_metadata(&PreviewTaskMetadata::default())?),
            created_at: now,
            finished_at: None,
        },
    )
    .await?;

    let task_db = db.clone();
    tokio::spawn(async move {
        let _permit = crate::modules::tasks::service::acquire_global_background_permit().await;
        if let Err(error) = run_cache_generation(&task_db, &library, &task_id).await {
            tracing::error!(task_id, ?error, "browse cache task failed to finalize");
        }
    });

    Ok(task)
}

pub async fn retry_cache_generation(
    db: &DatabaseConnection,
    library: media_library::Model,
    task_id: String,
) -> Result<app_task::Model, ApiError> {
    if find_running_library_background_task(db, &library.id)
        .await?
        .is_some()
    {
        return Err(ApiError::BadRequest(
            "library already has a running background task".to_owned(),
        ));
    }
    let task = update_app_task(
        db,
        &task_id,
        UpdateAppTaskParams {
            status: Some(TaskStatus::Queued.to_string()),
            detail: Some(Some("继续重试失败的媒体信息项".to_owned())),
            error_message: Some(None),
            finished_at: Some(None),
            ..Default::default()
        },
    )
    .await?
    .ok_or(ApiError::NotFound("task"))?;
    let task_db = db.clone();
    tokio::spawn(async move {
        let _permit = crate::modules::tasks::service::acquire_global_background_permit().await;
        if let Err(error) = run_cache_generation(&task_db, &library, &task_id).await {
            tracing::error!(
                task_id,
                ?error,
                "media information retry failed to finalize"
            );
        }
    });
    Ok(task)
}

async fn run_cache_generation(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
) -> Result<(), ApiError> {
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            status: Some(TaskStatus::Running.to_string()),
            detail: Some(Some("正在生成媒体信息".to_owned())),
            ..Default::default()
        },
    )
    .await?;

    let result = match processor_for(&library.media_type).map(|processor| processor.media_type()) {
        Some("photo") => generate_photo_cache(db, library, task_id).await,
        Some("video") => generate_video_cache(db, library, task_id).await,
        Some("novel") => generate_novel_cache(db, library, task_id).await,
        Some("music") => generate_music_cache(db, library, task_id).await,
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

async fn generate_novel_cache(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
) -> Result<PreviewOperationSummary, ApiError> {
    generate_library_novel_metadata(db, library, task_id).await
}

async fn generate_music_cache(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
) -> Result<PreviewOperationSummary, ApiError> {
    generate_library_music_metadata(db, library, task_id).await
}

async fn generate_photo_cache(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
) -> Result<PreviewOperationSummary, ApiError> {
    let progress_db = db.clone();
    let progress_task_id = task_id.to_owned();
    generate_library_previews_with_progress(db, library, false, Some(task_id), move |progress| {
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
) -> Result<PreviewOperationSummary, ApiError> {
    let (total_assets, base_completed) = video_progress_baseline(db, &library.id).await?;
    let analysis = analyze_library_assets(
        db,
        task_id,
        &library.id,
        &library.source_type,
        total_assets,
        base_completed,
    )
    .await?;
    let summary = generate_library_covers(
        db,
        library,
        task_id,
        false,
        Some((
            base_completed.saturating_add(analysis.processed_assets),
            total_assets.saturating_mul(2),
        )),
    )
    .await?;
    Ok(video_summaries_to_preview_summary(analysis, summary))
}

fn video_summaries_to_preview_summary(
    analysis: VideoAnalysisSummary,
    summary: VideoCoverSummary,
) -> PreviewOperationSummary {
    PreviewOperationSummary {
        processed_assets: analysis
            .processed_assets
            .saturating_add(summary.processed_assets),
        generated_previews: summary.generated_covers,
        skipped_assets: summary.skipped_assets,
        failed_assets: analysis.failed_assets.saturating_add(summary.failed_assets),
        last_error: summary.last_error.or(analysis.last_error),
        errors: analysis.errors.into_iter().chain(summary.errors).collect(),
        deleted_previews: summary.deleted_covers,
        reclaimed_bytes: summary.reclaimed_bytes,
        total_operations: analysis.total_assets.saturating_mul(2),
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
        errors: Vec::new(),
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
    let total_operations = if summary.total_operations > 0 {
        summary.total_operations
    } else {
        summary.processed_assets
    };
    let progress_percent = if failed {
        ((summary.processed_assets * 100) / total_operations.max(1)).min(99) as i32
    } else {
        100
    };
    let metadata_json = serialize_preview_metadata(&PreviewTaskMetadata {
        generated_previews: summary.generated_previews,
        skipped_assets: summary.skipped_assets,
        errors: summary.errors,
    })?;
    let error_message = failed.then(|| {
        summary
            .last_error
            .clone()
            .unwrap_or_else(|| format!("{} 个媒体资源生成信息失败", summary.failed_assets))
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
            progress_percent: Some(progress_percent),
            processed_items: Some(summary.processed_assets),
            total_items: Some(total_operations),
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
            progress_percent: Some(99),
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
