use std::{
    collections::HashMap,
    collections::VecDeque,
    env, fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use image::{GenericImageView, imageops::FilterType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
};
use tokio::task::{self, JoinSet};
use webp::Encoder as WebpEncoder;

use crate::{
    core::error::ApiError,
    infra::entities::{media_library, photo_asset},
};

const THUMB_MAX_DIMENSION: u32 = 384;
const PREVIEW_MAX_DIMENSION: u32 = 1920;
const THUMB_QUALITY: f32 = 80.0;
const PREVIEW_QUALITY: f32 = 85.0;
const THUMB_RENDER_CONCURRENCY: usize = 4;

#[derive(Debug, Clone, Default)]
pub struct ThumbnailStatus {
    pub total_assets: i64,
    pub thumb_ready_assets: i64,
    pub preview_ready_assets: i64,
    pub pending_assets: i64,
    pub thumb_total_bytes: i64,
    pub preview_total_bytes: i64,
    pub last_generated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default)]
pub struct ThumbnailOperationSummary {
    pub processed_assets: i64,
    pub generated_thumbnails: i64,
    pub generated_previews: i64,
    pub skipped_assets: i64,
    pub deleted_thumbnails: i64,
    pub deleted_previews: i64,
    pub reclaimed_bytes: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ThumbnailGenerationProgress {
    pub total_assets: i64,
    pub processed_assets: i64,
    pub generated_thumbnails: i64,
    pub generated_previews: i64,
    pub skipped_assets: i64,
}

#[derive(Debug)]
struct DerivativeFile {
    relative_path: String,
    file_size: i64,
    generated_at: DateTime<Utc>,
}

#[derive(Debug)]
struct RenderedDerivatives {
    width: i32,
    height: i32,
    thumb: Option<DerivativeFile>,
    preview: Option<DerivativeFile>,
}

#[derive(Debug)]
struct ThumbnailRenderCandidate {
    asset: photo_asset::Model,
    generate_thumb: bool,
    generate_preview: bool,
}

#[derive(Debug)]
struct ThumbnailRenderResult {
    asset: photo_asset::Model,
    rendered: RenderedDerivatives,
}

pub async fn compute_library_status_map(
    db: &DatabaseConnection,
    library_ids: &[String],
) -> Result<HashMap<String, ThumbnailStatus>, ApiError> {
    let mut status_map = HashMap::new();

    if library_ids.is_empty() {
        return Ok(status_map);
    }

    let assets = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.is_in(library_ids.iter().cloned()))
        .all(db)
        .await?;

    for asset in assets {
        let status = status_map.entry(asset.library_id.clone()).or_default();
        status.total_assets += 1;

        if asset
            .thumb_rel_path
            .as_deref()
            .map(is_webp_derivative_path)
            .unwrap_or(false)
        {
            status.thumb_ready_assets += 1;
            status.thumb_total_bytes += asset.thumb_file_size.unwrap_or_default();
        }

        if asset
            .preview_rel_path
            .as_deref()
            .map(is_webp_derivative_path)
            .unwrap_or(false)
        {
            status.preview_ready_assets += 1;
            status.preview_total_bytes += asset.preview_file_size.unwrap_or_default();
        }

        if !asset
            .thumb_rel_path
            .as_deref()
            .map(is_webp_derivative_path)
            .unwrap_or(false)
            || !asset
                .preview_rel_path
                .as_deref()
                .map(is_webp_derivative_path)
                .unwrap_or(false)
        {
            status.pending_assets += 1;
        }

        for generated_at in [asset.thumb_generated_at, asset.preview_generated_at]
            .into_iter()
            .flatten()
        {
            if status
                .last_generated_at
                .map(|current| generated_at > current)
                .unwrap_or(true)
            {
                status.last_generated_at = Some(generated_at);
            }
        }
    }

    Ok(status_map)
}

pub async fn generate_library_thumbnails(
    db: &DatabaseConnection,
    library: &media_library::Model,
    force: bool,
) -> Result<ThumbnailOperationSummary, ApiError> {
    generate_library_thumbnails_with_progress(db, library, force, |_| {}).await
}

pub async fn generate_library_thumbnails_with_progress<F>(
    db: &DatabaseConnection,
    library: &media_library::Model,
    force: bool,
    mut on_progress: F,
) -> Result<ThumbnailOperationSummary, ApiError>
where
    F: FnMut(&ThumbnailGenerationProgress),
{
    let assets = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .all(db)
        .await?;

    let mut summary = ThumbnailOperationSummary::default();
    let total_assets = assets.len() as i64;
    let mut pending_candidates = VecDeque::new();
    on_progress(&build_progress(total_assets, &summary));

    for asset in assets {
        let source_exists = Path::new(&asset.source_path).exists();

        if !source_exists || !is_supported_image(asset.mime_type.as_deref(), &asset.file_name) {
            summary.skipped_assets += 1;
            summary.processed_assets += 1;
            on_progress(&build_progress(total_assets, &summary));
            continue;
        }

        let source_modified_at = fs::metadata(&asset.source_path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(DateTime::<Utc>::from);
        let thumb_stale = source_modified_at
            .zip(asset.thumb_generated_at)
            .map(|(source, generated)| source > generated)
            .unwrap_or(false);
        let preview_stale = source_modified_at
            .zip(asset.preview_generated_at)
            .map(|(source, generated)| source > generated)
            .unwrap_or(false);
        let thumb_missing = !asset
            .thumb_rel_path
            .as_deref()
            .map(is_webp_derivative_path)
            .unwrap_or(false)
            || thumb_stale;
        let preview_missing = !asset
            .preview_rel_path
            .as_deref()
            .map(is_webp_derivative_path)
            .unwrap_or(false)
            || preview_stale;

        if !force && !thumb_missing && !preview_missing {
            summary.skipped_assets += 1;
            summary.processed_assets += 1;
            on_progress(&build_progress(total_assets, &summary));
            continue;
        }
        
        pending_candidates.push_back(ThumbnailRenderCandidate {
            asset,
            generate_thumb: force || thumb_missing,
            generate_preview: force || preview_missing,
        });
    }

    let mut render_jobs = JoinSet::new();

    while !pending_candidates.is_empty() || !render_jobs.is_empty() {
        while render_jobs.len() < THUMB_RENDER_CONCURRENCY {
            let Some(candidate) = pending_candidates.pop_front() else {
                break;
            };

            render_jobs.spawn(async move {
                let rendered = render_derivatives(
                    candidate.asset.source_path.clone(),
                    candidate.asset.file_id.clone(),
                    candidate.generate_thumb,
                    candidate.generate_preview,
                )
                .await?;

                Ok::<ThumbnailRenderResult, ApiError>(ThumbnailRenderResult {
                    asset: candidate.asset,
                    rendered,
                })
            });
        }

        let Some(job_result) = render_jobs.join_next().await else {
            break;
        };
        let render_result = job_result
            .map_err(|err| ApiError::BadRequest(format!("thumbnail worker task failed: {err}")))??;

        let now = Utc::now();
        let mut active_asset: photo_asset::ActiveModel = render_result.asset.into();
        active_asset.width = Set(Some(render_result.rendered.width));
        active_asset.height = Set(Some(render_result.rendered.height));
        active_asset.updated_at = Set(now);

        if let Some(thumb) = render_result.rendered.thumb {
            active_asset.thumb_rel_path = Set(Some(thumb.relative_path));
            active_asset.thumb_file_size = Set(Some(thumb.file_size));
            active_asset.thumb_generated_at = Set(Some(thumb.generated_at));
            summary.generated_thumbnails += 1;
        }

        if let Some(preview) = render_result.rendered.preview {
            active_asset.preview_rel_path = Set(Some(preview.relative_path));
            active_asset.preview_file_size = Set(Some(preview.file_size));
            active_asset.preview_generated_at = Set(Some(preview.generated_at));
            summary.generated_previews += 1;
        }

        active_asset.update(db).await?;
        summary.processed_assets += 1;
        on_progress(&build_progress(total_assets, &summary));
    }

    Ok(summary)
}

pub async fn delete_library_thumbnails(
    db: &DatabaseConnection,
    library: &media_library::Model,
) -> Result<ThumbnailOperationSummary, ApiError> {
    let assets = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .all(db)
        .await?;

    let mut summary = ThumbnailOperationSummary::default();

    for asset in assets {
        summary.processed_assets += 1;
        let mut active_asset: photo_asset::ActiveModel = asset.clone().into();
        let mut changed = false;

        if let Some(relative_path) = asset.thumb_rel_path.clone() {
            let deleted = delete_derivative_file(&relative_path)?;
            if deleted {
                summary.deleted_thumbnails += 1;
            }
            summary.reclaimed_bytes += asset.thumb_file_size.unwrap_or_default();
            active_asset.thumb_rel_path = Set(None);
            active_asset.thumb_file_size = Set(None);
            active_asset.thumb_generated_at = Set(None);
            changed = true;
        }

        if let Some(relative_path) = asset.preview_rel_path.clone() {
            let deleted = delete_derivative_file(&relative_path)?;
            if deleted {
                summary.deleted_previews += 1;
            }
            summary.reclaimed_bytes += asset.preview_file_size.unwrap_or_default();
            active_asset.preview_rel_path = Set(None);
            active_asset.preview_file_size = Set(None);
            active_asset.preview_generated_at = Set(None);
            changed = true;
        }

        if changed {
            active_asset.updated_at = Set(Utc::now());
            active_asset.update(db).await?;
        } else {
            summary.skipped_assets += 1;
        }
    }

    Ok(summary)
}

pub fn resolve_derivative_path(asset: &photo_asset::Model, variant: &str) -> Option<PathBuf> {
    let relative_path = match variant {
        "thumbnail" => asset.thumb_rel_path.as_deref(),
        "preview" => asset.preview_rel_path.as_deref(),
        _ => None,
    }?;

    Some(data_dir().join(relative_path))
}

fn is_supported_image(mime_type: Option<&str>, file_name: &str) -> bool {
    if mime_type
        .map(|value| value.starts_with("image/"))
        .unwrap_or(false)
    {
        return true;
    }

    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif"))
        .unwrap_or(false)
}

async fn render_derivatives(
    source_path: String,
    file_id: String,
    generate_thumb: bool,
    generate_preview: bool,
) -> Result<RenderedDerivatives, ApiError> {
    task::spawn_blocking(move || {
        ensure_derivative_directories()?;

        let image = image::open(&source_path)
            .map_err(|err| ApiError::BadRequest(format!("failed to decode image {source_path}: {err}")))?;
        let (width, height) = image.dimensions();
        let generated_at = Utc::now();

        let thumb = if generate_thumb {
            let relative_path = format!("thumb/{file_id}.webp");
            let target_path = data_dir().join(&relative_path);
            let resized = image.resize(
                THUMB_MAX_DIMENSION,
                THUMB_MAX_DIMENSION,
                FilterType::Triangle,
            );
            encode_as_webp(&resized, &target_path, THUMB_QUALITY)?;
            let file_size = fs::metadata(&target_path)?.len() as i64;

            Some(DerivativeFile {
                relative_path,
                file_size,
                generated_at,
            })
        } else {
            None
        };

        let preview = if generate_preview {
            let relative_path = format!("preview/{file_id}.webp");
            let target_path = data_dir().join(&relative_path);
            let resized = image.resize(
                PREVIEW_MAX_DIMENSION,
                PREVIEW_MAX_DIMENSION,
                FilterType::Lanczos3,
            );
            encode_as_webp(&resized, &target_path, PREVIEW_QUALITY)?;
            let file_size = fs::metadata(&target_path)?.len() as i64;

            Some(DerivativeFile {
                relative_path,
                file_size,
                generated_at,
            })
        } else {
            None
        };

        Ok(RenderedDerivatives {
            width: width as i32,
            height: height as i32,
            thumb,
            preview,
        })
    })
    .await
    .map_err(|err| ApiError::BadRequest(format!("thumbnail generation task failed: {err}")))?
}

fn ensure_derivative_directories() -> Result<(), ApiError> {
    fs::create_dir_all(data_dir().join("thumb"))?;
    fs::create_dir_all(data_dir().join("preview"))?;
    Ok(())
}

fn delete_derivative_file(relative_path: &str) -> Result<bool, ApiError> {
    let target_path = data_dir().join(relative_path);

    if !target_path.exists() {
        return Ok(false);
    }

    fs::remove_file(target_path)?;
    Ok(true)
}

fn encode_as_webp(
    image: &image::DynamicImage,
    target_path: &Path,
    quality: f32,
) -> Result<(), ApiError> {
    let rgb = image.to_rgb8();
    let encoded = WebpEncoder::from_rgb(&rgb, rgb.width(), rgb.height()).encode(quality);
    fs::write(target_path, encoded.as_ref())?;

    Ok(())
}

fn data_dir() -> PathBuf {
    let data_dir = env::var("MENGNEX_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data"));

    PathBuf::from(data_dir)
}

fn build_progress(
    total_assets: i64,
    summary: &ThumbnailOperationSummary,
) -> ThumbnailGenerationProgress {
    ThumbnailGenerationProgress {
        total_assets,
        processed_assets: summary.processed_assets,
        generated_thumbnails: summary.generated_thumbnails,
        generated_previews: summary.generated_previews,
        skipped_assets: summary.skipped_assets,
    }
}

fn is_webp_derivative_path(relative_path: &str) -> bool {
    Path::new(relative_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("webp"))
        .unwrap_or(false)
}
