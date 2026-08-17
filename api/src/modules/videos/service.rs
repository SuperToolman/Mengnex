use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    QueryFilter, Set,
};
use serde::Deserialize;
use tokio::time::timeout;
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{app_setting, author_resource, media_file, video_asset},
    modules::{
        authors::service::link_author_for_resource,
        sources,
        tasks::service::{UpdateAppTaskParams, update_app_task, wait_for_task_permit},
    },
};

/// Scanner-owned creation of the reusable technical video asset. Analysis is
/// deliberately decoupled: movie and episode recognition can evolve without
/// re-scanning or duplicating physical stream metadata.
pub async fn upsert_video_asset(
    db: &DatabaseTransaction,
    file: &media_file::Model,
    title: &str,
) -> Result<(), ApiError> {
    let now = Utc::now();
    if let Some(existing) = video_asset::Entity::find()
        .filter(video_asset::Column::FileId.eq(file.id.clone()))
        .one(db)
        .await?
    {
        let mut active: video_asset::ActiveModel = existing.into();
        active.item_id = Set(file.item_id.clone());
        active.library_id = Set(file.library_id.clone());
        active.title = Set(title.to_owned());
        active.container = Set(file.extension.clone());
        // The scanner calls this branch only after the source file metadata
        // changed or a missing item returned. Existing derivatives no longer
        // describe the current bytes and must be regenerated.
        active.duration_seconds = Set(None);
        active.width = Set(None);
        active.height = Set(None);
        active.video_codec = Set(None);
        active.audio_codec = Set(None);
        active.analysis_status = Set("pending".to_owned());
        active.analysis_error = Set(None);
        active.analyzed_at = Set(None);
        active.poster_rel_path = Set(None);
        active.poster_file_size = Set(None);
        active.poster_generated_at = Set(None);
        active.poster_error = Set(None);
        active.updated_at = Set(now);
        let updated = active.update(db).await?;
        author_resource::Entity::delete_many()
            .filter(author_resource::Column::ResourceType.eq("video_asset"))
            .filter(author_resource::Column::ResourceId.eq(updated.id.clone()))
            .exec(db)
            .await?;
        link_author_for_resource(db, title, "video_asset", &updated.id).await?;
        return Ok(());
    }

    let asset = video_asset::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        item_id: Set(file.item_id.clone()),
        file_id: Set(file.id.clone()),
        library_id: Set(file.library_id.clone()),
        title: Set(title.to_owned()),
        duration_seconds: Set(None),
        width: Set(None),
        height: Set(None),
        video_codec: Set(None),
        audio_codec: Set(None),
        container: Set(file.extension.clone()),
        analysis_status: Set("pending".to_owned()),
        analysis_error: Set(None),
        analyzed_at: Set(None),
        poster_rel_path: Set(None),
        poster_file_size: Set(None),
        poster_generated_at: Set(None),
        poster_error: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;
    link_author_for_resource(db, title, "video_asset", &asset.id).await?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct VideoCoverSummary {
    pub processed_assets: i64,
    pub generated_covers: i64,
    pub skipped_assets: i64,
    pub failed_assets: i64,
    pub last_error: Option<String>,
    pub errors: Vec<String>,
    pub deleted_covers: i64,
    pub reclaimed_bytes: i64,
}

#[derive(Debug, Default)]
pub struct VideoAnalysisSummary {
    pub total_assets: i64,
    pub processed_assets: i64,
    pub analyzed_assets: i64,
    pub skipped_assets: i64,
    pub failed_assets: i64,
    pub last_error: Option<String>,
    pub errors: Vec<String>,
}

pub async fn video_progress_baseline(
    db: &DatabaseConnection,
    library_id: &str,
) -> Result<(i64, i64), ApiError> {
    let assets = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(library_id.to_owned()))
        .all(db)
        .await?;
    let total = assets.len() as i64;
    let mut completed = 0;
    for asset in &assets {
        completed += i64::from(asset.analysis_status == "ready");
        if asset
            .poster_rel_path
            .as_ref()
            .and_then(|_| resolve_cover_path(asset))
            .is_some_and(|path| path.is_file())
        {
            completed += 1;
        }
    }
    Ok((total, completed))
}

pub fn preview_root(library_id: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("preview")
        .join(library_id)
}

pub fn resolve_cover_path(asset: &video_asset::Model) -> Option<PathBuf> {
    asset.poster_rel_path.as_ref().map(|relative| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("data")
            .join(relative)
    })
}

pub async fn generate_library_covers(
    db: &DatabaseConnection,
    library: &crate::infra::entities::media_library::Model,
    task_id: &str,
    force: bool,
    progress_base: Option<(i64, i64)>,
) -> Result<VideoCoverSummary, ApiError> {
    let settings = app_setting::Entity::find_by_id("global")
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("Preferences not found"))?;
    let assets = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(library.id.clone()))
        .all(db)
        .await?;
    let total = assets.len() as i64;
    let root = preview_root(&library.id);
    tokio::fs::create_dir_all(&root).await?;
    let mut summary = VideoCoverSummary::default();
    let (base_processed, base_total) = progress_base.unwrap_or_default();
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            total_items: Some(if base_total > 0 { base_total } else { total }),
            ..Default::default()
        },
    )
    .await?;

    for asset in assets {
        wait_for_task_permit(db, task_id).await?;
        let target = root.join(format!("{}.jpg", asset.id));
        if !force && asset.poster_rel_path.is_some() && target.is_file() {
            summary.skipped_assets += 1;
            update_cover_progress(db, task_id, &summary, total, base_processed, base_total).await?;
            continue;
        }
        let Some(file) = media_file::Entity::find_by_id(asset.file_id.clone())
            .one(db)
            .await?
        else {
            let error = "未找到源媒体文件记录".to_owned();
            let mut active: video_asset::ActiveModel = asset.into();
            active.poster_error = Set(Some(error.clone()));
            active.updated_at = Set(Utc::now());
            active.update(db).await?;
            summary.failed_assets += 1;
            summary.last_error = Some(error);
            summary.errors.push(summary.last_error.clone().unwrap());
            update_cover_progress(db, task_id, &summary, total, base_processed, base_total).await?;
            continue;
        };
        let materialized = sources::materialize_media_file_for_derivative(db, library, &file).await;
        let result = match materialized {
            Ok(materialized) => {
                render_cover(
                    &settings,
                    &materialized.path,
                    &target,
                    asset.duration_seconds,
                )
                .await
            }
            Err(error) => Err(format!("{error:?}")),
        };
        let asset_id = asset.id.clone();
        let mut active: video_asset::ActiveModel = asset.into();
        let succeeded = result.is_ok();
        match result {
            Ok(size) => {
                active.poster_rel_path =
                    Set(Some(format!("preview/{}/{asset_id}.jpg", library.id)));
                active.poster_file_size = Set(Some(size));
                active.poster_generated_at = Set(Some(Utc::now()));
                active.poster_error = Set(None);
                summary.generated_covers += 1;
            }
            Err(error) => {
                let _ = tokio::fs::remove_file(&target).await;
                let error = error.chars().take(500).collect::<String>();
                active.poster_error = Set(Some(error.clone()));
                summary.failed_assets += 1;
                summary.last_error = Some(error);
                summary.errors.push(summary.last_error.clone().unwrap());
            }
        }
        active.updated_at = Set(Utc::now());
        active.update(db).await?;
        if succeeded {
            summary.processed_assets += 1;
        }
        update_cover_progress(db, task_id, &summary, total, base_processed, base_total).await?;
    }
    Ok(summary)
}

async fn render_cover(
    settings: &app_setting::Model,
    input: &Path,
    target: &Path,
    duration: Option<f64>,
) -> Result<i64, String> {
    let seek = duration
        .map(|value| {
            (value * settings.video_cover_time_percent as f64 / 100.0)
                .max(0.5)
                .min((value - 0.1).max(0.5))
        })
        .unwrap_or(1.0);
    let command = resolve_media_tool_command(&settings.video_ffmpeg_command, "ffmpeg");
    let input = input.to_owned();
    let target = target.to_owned();
    let output_target = target.clone();
    let run = tokio::task::spawn_blocking(move || {
        Command::new(command)
            .arg("-y")
            .arg("-ss")
            .arg(format!("{seek:.3}"))
            .arg("-i")
            .arg(input)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale='min(1280,iw)':-2",
                "-q:v",
                "3",
            ])
            .arg(&output_target)
            .output()
    });
    let output = match timeout(
        Duration::from_secs(settings.video_probe_timeout_seconds as u64),
        run,
    )
    .await
    {
        Ok(Ok(Ok(output))) if output.status.success() => output,
        Ok(Ok(Ok(output))) => {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        Ok(Ok(Err(error))) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!(
                "找不到 FFmpeg 可执行文件“{}”，请在扫描设置中配置正确路径",
                settings.video_ffmpeg_command
            ));
        }
        Ok(Ok(Err(error))) => return Err(error.to_string()),
        Ok(Err(error)) => return Err(error.to_string()),
        Err(_) => return Err("ffmpeg cover generation timed out".to_owned()),
    };
    let _ = output;
    tokio::fs::metadata(target)
        .await
        .map(|metadata| metadata.len() as i64)
        .map_err(|error| error.to_string())
}

async fn update_cover_progress(
    db: &DatabaseConnection,
    task_id: &str,
    summary: &VideoCoverSummary,
    total: i64,
    base_processed: i64,
    base_total: i64,
) -> Result<(), ApiError> {
    let combined_total = if base_total > 0 { base_total } else { total };
    let combined_processed = base_processed.saturating_add(summary.processed_assets);
    let percent = if combined_total == 0 {
        99
    } else {
        ((combined_processed * 100) / combined_total).min(99) as i32
    };
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            progress_percent: Some(percent),
            processed_items: Some(combined_processed),
            total_items: Some(combined_total),
            detail: Some(Some(format!(
                "已生成 {}，已跳过 {}，失败 {}",
                summary.generated_covers, summary.skipped_assets, summary.failed_assets
            ))),
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}

pub async fn delete_library_covers(
    db: &DatabaseConnection,
    library_id: &str,
) -> Result<VideoCoverSummary, ApiError> {
    let assets = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(library_id.to_owned()))
        .filter(video_asset::Column::AnalysisStatus.ne("ready"))
        .all(db)
        .await?;
    let mut summary = VideoCoverSummary::default();
    for asset in assets {
        summary.processed_assets += 1;
        if let Some(path) = resolve_cover_path(&asset) {
            if let Ok(metadata) = tokio::fs::metadata(&path).await {
                summary.reclaimed_bytes += metadata.len() as i64;
            }
            if tokio::fs::remove_file(&path).await.is_ok() {
                summary.deleted_covers += 1;
            }
        }
        let mut active: video_asset::ActiveModel = asset.into();
        active.poster_rel_path = Set(None);
        active.poster_file_size = Set(None);
        active.poster_generated_at = Set(None);
        active.poster_error = Set(None);
        active.updated_at = Set(Utc::now());
        active.update(db).await?;
    }
    Ok(summary)
}

pub async fn analyze_library_assets(
    db: &DatabaseConnection,
    task_id: &str,
    library_id: &str,
    source_type: &str,
    total_assets: i64,
    base_completed: i64,
) -> Result<VideoAnalysisSummary, ApiError> {
    let settings = app_setting::Entity::find_by_id("global")
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("Preferences not found"))?;
    let assets = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(library_id.to_owned()))
        .filter(video_asset::Column::AnalysisStatus.ne("ready"))
        .all(db)
        .await?;
    let mut summary = VideoAnalysisSummary {
        total_assets,
        ..Default::default()
    };
    update_analysis_progress(db, task_id, &summary, base_completed).await?;
    for asset in assets {
        wait_for_task_permit(db, task_id).await?;
        let Some(file) = media_file::Entity::find_by_id(asset.file_id.clone())
            .one(db)
            .await?
        else {
            summary.failed_assets += 1;
            summary.last_error = Some("未找到源媒体文件记录".to_owned());
            summary.errors.push(summary.last_error.clone().unwrap());
            update_analysis_progress(db, task_id, &summary, base_completed).await?;
            continue;
        };
        let probe = if source_type == crate::modules::sources::WEBDAV {
            ProbeResult {
                status: "pending_remote".to_owned(),
                ..Default::default()
            }
        } else {
            probe_local_file(&settings, &file).await
        };
        match probe.status.as_str() {
            "ready" => summary.analyzed_assets += 1,
            "failed" => {
                summary.failed_assets += 1;
                summary.last_error = probe.error.clone();
                if let Some(error) = probe.error.as_ref() {
                    summary.errors.push(error.clone());
                }
            }
            _ => summary.skipped_assets += 1,
        }
        let mut active: video_asset::ActiveModel = asset.into();
        let succeeded = probe.status == "ready";
        active.duration_seconds = Set(probe.duration_seconds);
        active.width = Set(probe.width);
        active.height = Set(probe.height);
        active.video_codec = Set(probe.video_codec);
        active.audio_codec = Set(probe.audio_codec);
        active.analysis_status = Set(probe.status);
        active.analysis_error = Set(probe.error);
        active.analyzed_at = Set(probe.analyzed_at);
        active.updated_at = Set(Utc::now());
        active.update(db).await?;
        if succeeded {
            summary.processed_assets += 1;
        }
        update_analysis_progress(db, task_id, &summary, base_completed).await?;
    }
    Ok(summary)
}

async fn update_analysis_progress(
    db: &DatabaseConnection,
    task_id: &str,
    summary: &VideoAnalysisSummary,
    base_completed: i64,
) -> Result<(), ApiError> {
    let combined_total = summary.total_assets.saturating_mul(2);
    let combined_processed = base_completed.saturating_add(summary.processed_assets);
    let progress_percent = if combined_total <= 0 {
        99
    } else {
        ((combined_processed * 100) / combined_total).min(99) as i32
    };
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            progress_percent: Some(progress_percent),
            processed_items: Some(combined_processed),
            total_items: Some(combined_total),
            detail: Some(Some(format!(
                "已分析 {}，已跳过 {}，失败 {}",
                summary.analyzed_assets, summary.skipped_assets, summary.failed_assets
            ))),
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}

#[derive(Default)]
struct ProbeResult {
    duration_seconds: Option<f64>,
    width: Option<i32>,
    height: Option<i32>,
    video_codec: Option<String>,
    audio_codec: Option<String>,
    status: String,
    error: Option<String>,
    analyzed_at: Option<chrono::DateTime<Utc>>,
}

#[derive(Deserialize)]
struct ProbeDocument {
    format: Option<ProbeFormat>,
    streams: Option<Vec<ProbeStream>>,
}
#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}
#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
}

async fn probe_local_file(settings: &app_setting::Model, file: &media_file::Model) -> ProbeResult {
    if !settings.video_probe_enabled {
        return ProbeResult {
            status: "disabled".to_owned(),
            ..ProbeResult::default()
        };
    }
    if file.full_path.starts_with("http://") || file.full_path.starts_with("https://") {
        return ProbeResult {
            status: "pending_remote".to_owned(),
            ..ProbeResult::default()
        };
    }
    let command = resolve_media_tool_command(&settings.video_probe_command, "ffprobe");
    let path = file.full_path.clone();
    let run = tokio::task::spawn_blocking(move || {
        Command::new(command)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,codec_name,width,height",
                "-of",
                "json",
                &path,
            ])
            .output()
    });
    let output = match timeout(
        Duration::from_secs(settings.video_probe_timeout_seconds as u64),
        run,
    )
    .await
    {
        Ok(Ok(Ok(output))) if output.status.success() => output,
        Ok(Ok(Ok(output))) => return failed_probe(String::from_utf8_lossy(&output.stderr).trim()),
        Ok(Ok(Err(error))) if error.kind() == std::io::ErrorKind::NotFound => {
            return failed_probe(&format!(
                "找不到 FFprobe 可执行文件“{}”，请在扫描设置中配置正确路径",
                settings.video_probe_command
            ));
        }
        Ok(Ok(Err(error))) => return failed_probe(&error.to_string()),
        Ok(Err(error)) => return failed_probe(&error.to_string()),
        Err(_) => return failed_probe("ffprobe timed out"),
    };
    let document: ProbeDocument = match serde_json::from_slice(&output.stdout) {
        Ok(value) => value,
        Err(error) => return failed_probe(&error.to_string()),
    };
    let streams = document.streams.unwrap_or_default();
    let video = streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"));
    let audio = streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("audio"));
    ProbeResult {
        duration_seconds: document
            .format
            .and_then(|format| format.duration)
            .and_then(|value| value.parse().ok()),
        width: video.and_then(|stream| stream.width),
        height: video.and_then(|stream| stream.height),
        video_codec: video.and_then(|stream| stream.codec_name.clone()),
        audio_codec: audio.and_then(|stream| stream.codec_name.clone()),
        status: "ready".to_owned(),
        error: None,
        analyzed_at: Some(Utc::now()),
    }
}

fn failed_probe(error: &str) -> ProbeResult {
    ProbeResult {
        status: "failed".to_owned(),
        error: Some(error.chars().take(500).collect()),
        ..ProbeResult::default()
    }
}

/// Resolve bundled tools when the setting still contains the default command.
/// Explicit paths and custom command names remain untouched.
fn resolve_media_tool_command(configured: &str, tool_name: &str) -> String {
    let configured = configured.trim();
    if configured != tool_name {
        return configured.to_owned();
    }

    let executable_name = if cfg!(windows) {
        format!("{tool_name}.exe")
    } else {
        tool_name.to_owned()
    };
    let mut candidates = Vec::new();
    if let Some(directory) = env::var_os("MENGNEX_FFMPEG_DIR") {
        candidates.push(PathBuf::from(directory).join(&executable_name));
    }

    let mut roots = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))];
    if let Ok(executable) = env::current_exe() {
        roots.extend(executable.ancestors().map(Path::to_path_buf));
    }
    for root in roots {
        candidates.extend([
            root.join("tools")
                .join("ffmpeg-full_build")
                .join("bin")
                .join(&executable_name),
            root.join("tools")
                .join("ffmpeg")
                .join("bin")
                .join(&executable_name),
            root.join("resources").join("ffmpeg").join(&executable_name),
            root.join("resources")
                .join("ffmpeg")
                .join("bin")
                .join(&executable_name),
        ]);
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
        .unwrap_or_else(|| configured.to_owned())
}
