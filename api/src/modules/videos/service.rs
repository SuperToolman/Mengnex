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
    infra::entities::{app_setting, media_file, video_asset},
    modules::{
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
        active.updated_at = Set(now);
        active.update(db).await?;
        return Ok(());
    }

    video_asset::ActiveModel {
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
    Ok(())
}

#[derive(Debug, Default)]
pub struct VideoCoverSummary {
    pub processed_assets: i64,
    pub generated_covers: i64,
    pub skipped_assets: i64,
    pub failed_assets: i64,
    pub deleted_covers: i64,
    pub reclaimed_bytes: i64,
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
            total_items: Some(base_total.saturating_add(total)),
            ..Default::default()
        },
    )
    .await?;

    for asset in assets {
        wait_for_task_permit(db, task_id).await?;
        let target = root.join(format!("{}.jpg", asset.id));
        if !force && asset.poster_rel_path.is_some() && target.is_file() {
            summary.skipped_assets += 1;
            summary.processed_assets += 1;
            update_cover_progress(db, task_id, &summary, total, base_processed, base_total).await?;
            continue;
        }
        let Some(file) = media_file::Entity::find_by_id(asset.file_id.clone())
            .one(db)
            .await?
        else {
            let mut active: video_asset::ActiveModel = asset.into();
            active.poster_error = Set(Some("source media file record was not found".to_owned()));
            active.updated_at = Set(Utc::now());
            active.update(db).await?;
            summary.failed_assets += 1;
            summary.processed_assets += 1;
            update_cover_progress(db, task_id, &summary, total, base_processed, base_total).await?;
            continue;
        };
        let materialized = sources::materialize_media_file_for_derivative(db, library, &file).await;
        let result = match materialized {
            Ok(materialized) => {
                let result = render_cover(
                    &settings,
                    &materialized.path,
                    &target,
                    asset.duration_seconds,
                )
                .await;
                if materialized.temporary {
                    let _ = tokio::fs::remove_file(&materialized.path).await;
                }
                result
            }
            Err(error) => Err(format!("{error:?}")),
        };
        let asset_id = asset.id.clone();
        let mut active: video_asset::ActiveModel = asset.into();
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
                active.poster_error = Set(Some(error.chars().take(500).collect()));
                summary.failed_assets += 1;
            }
        }
        active.updated_at = Set(Utc::now());
        active.update(db).await?;
        summary.processed_assets += 1;
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
    let combined_total = base_total.saturating_add(total);
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
                "generated {}, skipped {}, failed {}",
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

pub async fn analyze_pending_assets(
    db: &DatabaseConnection,
    library_id: &str,
) -> Result<(i64, i64), ApiError> {
    let settings = app_setting::Entity::find_by_id("global")
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("Preferences not found"))?;
    let assets = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(library_id.to_owned()))
        .all(db)
        .await?;
    let total = assets.len() as i64;
    for asset in assets {
        let Some(file) = media_file::Entity::find_by_id(asset.file_id.clone())
            .one(db)
            .await?
        else {
            continue;
        };
        let probe = probe_local_file(&settings, &file).await;
        let mut active: video_asset::ActiveModel = asset.into();
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
    }
    Ok((total, total))
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
