use std::{
    collections::HashMap,
    fs,
    future::Future,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use image::{GenericImageView, imageops::FilterType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, QueryFilter,
    QuerySelect, QueryTrait, Set, sea_query::Expr,
};
use tokio::task::{self, JoinSet};
use webp::Encoder as WebpEncoder;

use crate::{
    core::error::ApiError,
    infra::entities::{
        app_setting, media_file, media_item, media_library, photo_asset, video_asset,
    },
    modules::{sources, tasks::service::wait_for_task_permit},
};

// Decoding source images can consume substantially more memory than their file
// sizes. Keep the bounded pipeline deliberately small for large libraries.
const PREVIEW_RENDER_CONCURRENCY: usize = 4;
const SETTINGS_ID: &str = "global";

#[derive(Debug, Clone, Default)]
pub struct PreviewStatus {
    pub total_assets: i64,
    pub preview_ready_assets: i64,
    pub pending_assets: i64,
    pub preview_total_bytes: i64,
    pub last_generated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default)]
pub struct PreviewOperationSummary {
    pub processed_assets: i64,
    pub generated_previews: i64,
    pub skipped_assets: i64,
    pub failed_assets: i64,
    pub last_error: Option<String>,
    pub deleted_previews: i64,
    pub reclaimed_bytes: i64,
    pub errors: Vec<String>,
    pub total_operations: i64,
}

#[derive(Debug, Clone, Default)]
pub struct PreviewGenerationProgress {
    pub total_assets: i64,
    pub processed_assets: i64,
    pub generated_previews: i64,
    pub skipped_assets: i64,
    pub failed_assets: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, FromQueryResult)]
struct LibraryStatusRow {
    library_id: String,
    total_assets: i64,
    preview_ready_assets: i64,
    complete_ready_assets: i64,
    preview_total_bytes: i64,
    last_generated_at: Option<DateTime<Utc>>,
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
    preview: Option<DerivativeFile>,
}

#[derive(Debug)]
struct PreviewRenderCandidate {
    asset: photo_asset::Model,
    source: sources::MaterializedMediaFile,
    settings: ScanRenderSettings,
}

#[derive(Debug)]
struct PreviewRenderResult {
    asset: photo_asset::Model,
    rendered: RenderedDerivatives,
}

#[derive(Debug, Clone)]
struct ScanRenderSettings {
    preview_max_dimension: u32,
    preview_quality: f32,
}

pub async fn compute_library_status_map(
    db: &DatabaseConnection,
    library_ids: &[String],
) -> Result<HashMap<String, PreviewStatus>, ApiError> {
    let mut status_map = HashMap::new();

    if library_ids.is_empty() {
        return Ok(status_map);
    }

    let rows = photo_asset::Entity::find()
        .select_only()
        .column(photo_asset::Column::LibraryId)
        .column_as(Expr::cust("COUNT(*)"), "total_assets")
        .column_as(
            Expr::cust(
                "COALESCE(SUM(CASE WHEN preview_rel_path LIKE '%.webp' THEN 1 ELSE 0 END), 0)",
            ),
            "preview_ready_assets",
        )
        .column_as(
            Expr::cust(
                "COALESCE(SUM(CASE WHEN preview_rel_path LIKE '%.webp' THEN 1 ELSE 0 END), 0)",
            ),
            "complete_ready_assets",
        )
        .column_as(
            Expr::cust(
                "COALESCE(SUM(CASE WHEN preview_rel_path LIKE '%.webp' THEN COALESCE(preview_file_size, 0) ELSE 0 END), 0)",
            ),
            "preview_total_bytes",
        )
        .column_as(
            Expr::cust(
                "MAX(preview_generated_at)",
            ),
            "last_generated_at",
        )
        .filter(photo_asset::Column::LibraryId.is_in(library_ids.iter().cloned()))
        .group_by(photo_asset::Column::LibraryId)
        .into_model::<LibraryStatusRow>()
        .all(db)
        .await?;

    for row in rows {
        status_map.insert(
            row.library_id,
            PreviewStatus {
                total_assets: row.total_assets,
                preview_ready_assets: row.preview_ready_assets,
                pending_assets: row.total_assets - row.complete_ready_assets,
                preview_total_bytes: row.preview_total_bytes,
                last_generated_at: row.last_generated_at,
            },
        );
    }

    let video_rows = video_asset::Entity::find()
        .select_only()
        .column(video_asset::Column::LibraryId)
        .column_as(Expr::cust("COUNT(*)"), "total_assets")
        .column_as(
            Expr::cust(
                "COALESCE(SUM(CASE WHEN poster_rel_path IS NOT NULL THEN 1 ELSE 0 END), 0)",
            ),
            "preview_ready_assets",
        )
        .column_as(
            Expr::cust(
                "COALESCE(SUM(CASE WHEN poster_rel_path IS NOT NULL THEN 1 ELSE 0 END), 0)",
            ),
            "complete_ready_assets",
        )
        .column_as(
            Expr::cust(
                "COALESCE(SUM(CASE WHEN poster_rel_path IS NOT NULL THEN COALESCE(poster_file_size, 0) ELSE 0 END), 0)",
            ),
            "preview_total_bytes",
        )
        .column_as(Expr::cust("MAX(poster_generated_at)"), "last_generated_at")
        .filter(video_asset::Column::LibraryId.is_in(library_ids.iter().cloned()))
        .group_by(video_asset::Column::LibraryId)
        .into_model::<LibraryStatusRow>()
        .all(db)
        .await?;

    for row in video_rows {
        status_map.insert(
            row.library_id,
            PreviewStatus {
                total_assets: row.total_assets,
                preview_ready_assets: row.preview_ready_assets,
                pending_assets: row.total_assets - row.complete_ready_assets,
                preview_total_bytes: row.preview_total_bytes,
                last_generated_at: row.last_generated_at,
            },
        );
    }

    Ok(status_map)
}

pub async fn generate_library_previews_with_progress<F>(
    db: &DatabaseConnection,
    library: &media_library::Model,
    force: bool,
    control_task_id: Option<&str>,
    on_progress: F,
) -> Result<PreviewOperationSummary, ApiError>
where
    F: FnMut(
        &PreviewGenerationProgress,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), ApiError>> + Send + '_>>,
{
    generate_previews_with_progress(db, library, None, force, control_task_id, on_progress).await
}

#[expect(dead_code, reason = "reserved for targeted preview regeneration jobs")]
pub async fn generate_file_previews_with_progress<F>(
    db: &DatabaseConnection,
    library: &media_library::Model,
    file_ids: &[String],
    force: bool,
    control_task_id: Option<&str>,
    on_progress: F,
) -> Result<PreviewOperationSummary, ApiError>
where
    F: FnMut(
        &PreviewGenerationProgress,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), ApiError>> + Send + '_>>,
{
    if file_ids.is_empty() {
        return Ok(PreviewOperationSummary::default());
    }

    generate_previews_with_progress(
        db,
        library,
        Some(file_ids),
        force,
        control_task_id,
        on_progress,
    )
    .await
}

async fn generate_previews_with_progress<F>(
    db: &DatabaseConnection,
    library: &media_library::Model,
    file_ids: Option<&[String]>,
    force: bool,
    control_task_id: Option<&str>,
    mut on_progress: F,
) -> Result<PreviewOperationSummary, ApiError>
where
    F: FnMut(
        &PreviewGenerationProgress,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), ApiError>> + Send + '_>>,
{
    let settings = load_scan_render_settings(db).await?;
    let deleted_items = media_item::Entity::find()
        .select_only()
        .column(media_item::Column::Id)
        .filter(media_item::Column::DeletedAt.is_not_null())
        .into_query();
    let mut asset_query = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .filter(Expr::col(photo_asset::Column::ItemId).not_in_subquery(deleted_items));
    if let Some(file_ids) = file_ids {
        asset_query =
            asset_query.filter(photo_asset::Column::FileId.is_in(file_ids.iter().cloned()));
    }
    let assets = asset_query.all(db).await?;

    let mut summary = PreviewOperationSummary::default();
    let total_assets = assets.len() as i64;
    let mut render_jobs = JoinSet::new();
    if let Some(task_id) = control_task_id {
        wait_for_task_permit(db, task_id).await?;
    }
    on_progress(&build_progress(total_assets, &summary)).await?;

    for asset in assets {
        if let Some(task_id) = control_task_id {
            wait_for_task_permit(db, task_id).await?;
        }
        let source_exists = Path::new(&asset.source_path).exists();
        let file = media_file::Entity::find_by_id(asset.file_id.clone())
            .one(db)
            .await?
            .ok_or(ApiError::NotFound("media file"))?;
        let source_available = source_exists
            || (library.source_type == sources::WEBDAV && file.source_locator.is_some());

        if !source_available || !is_supported_image(asset.mime_type.as_deref(), &asset.file_name) {
            summary.skipped_assets += 1;
            summary.processed_assets += 1;
            on_progress(&build_progress(total_assets, &summary)).await?;
            continue;
        }

        let source_modified_at = file.modified_at.or_else(|| {
            fs::metadata(&asset.source_path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(DateTime::<Utc>::from)
        });
        let preview_stale = source_modified_at
            .zip(asset.preview_generated_at)
            .map(|(source, generated)| source > generated)
            .unwrap_or(false);
        let preview_missing = asset
            .preview_rel_path
            .as_deref()
            .filter(|path| is_webp_derivative_path(path) && data_dir().join(path).is_file())
            .is_none()
            || preview_stale;

        if !force && !preview_missing {
            summary.skipped_assets += 1;
            summary.processed_assets += 1;
            on_progress(&build_progress(total_assets, &summary)).await?;
            continue;
        }

        let materialized =
            match sources::materialize_media_file_for_derivative(db, library, &file).await {
                Ok(materialized) => materialized,
                Err(error) => {
                    summary.failed_assets += 1;
                    summary.processed_assets += 1;
                    summary.last_error = Some(format!(
                        "failed to download source {}: {error:?}",
                        asset.source_path
                    ));
                    on_progress(&build_progress(total_assets, &summary)).await?;
                    continue;
                }
            };
        render_jobs.spawn(render_preview_candidate(PreviewRenderCandidate {
            asset,
            source: materialized,
            settings: settings.clone(),
        }));

        if render_jobs.len() < PREVIEW_RENDER_CONCURRENCY {
            continue;
        }

        complete_preview_job(db, &mut render_jobs, &mut summary).await?;
        on_progress(&build_progress(total_assets, &summary)).await?;
    }

    while !render_jobs.is_empty() {
        if let Some(task_id) = control_task_id {
            wait_for_task_permit(db, task_id).await?;
        }
        complete_preview_job(db, &mut render_jobs, &mut summary).await?;
        on_progress(&build_progress(total_assets, &summary)).await?;
    }

    Ok(summary)
}

async fn render_preview_candidate(
    candidate: PreviewRenderCandidate,
) -> Result<PreviewRenderResult, ApiError> {
    let source_path = candidate.source.path.to_string_lossy().into_owned();
    let source_label = candidate.asset.source_path.clone();
    let render_result = render_derivatives(
        source_path,
        candidate.asset.file_id.clone(),
        candidate.asset.library_id.clone(),
        candidate.settings,
    )
    .await
    .map_err(|error| {
        ApiError::BadRequest(format!(
            "failed to generate derivatives for {source_label}: {error:?}"
        ))
    });

    let rendered = render_result?;
    Ok(PreviewRenderResult {
        asset: candidate.asset,
        rendered,
    })
}

async fn complete_preview_job(
    db: &DatabaseConnection,
    render_jobs: &mut JoinSet<Result<PreviewRenderResult, ApiError>>,
    summary: &mut PreviewOperationSummary,
) -> Result<(), ApiError> {
    let job_result = render_jobs
        .join_next()
        .await
        .ok_or_else(|| ApiError::BadRequest("preview worker queue was empty".to_owned()))?;
    let render_result = match job_result {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            summary.processed_assets += 1;
            summary.failed_assets += 1;
            summary.last_error = Some(format!("{error:?}"));
            return Ok(());
        }
        Err(error) => {
            return Err(ApiError::BadRequest(format!(
                "preview worker task failed: {error}"
            )));
        }
    };

    let now = Utc::now();
    let mut active_asset: photo_asset::ActiveModel = render_result.asset.into();
    active_asset.width = Set(Some(render_result.rendered.width));
    active_asset.height = Set(Some(render_result.rendered.height));
    active_asset.updated_at = Set(now);

    if let Some(preview) = render_result.rendered.preview {
        active_asset.preview_rel_path = Set(Some(preview.relative_path));
        active_asset.preview_file_size = Set(Some(preview.file_size));
        active_asset.preview_generated_at = Set(Some(preview.generated_at));
        summary.generated_previews += 1;
    }

    active_asset.update(db).await?;
    summary.processed_assets += 1;
    Ok(())
}

pub async fn delete_library_previews(
    db: &DatabaseConnection,
    library: &media_library::Model,
) -> Result<PreviewOperationSummary, ApiError> {
    let assets = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .all(db)
        .await?;

    let mut summary = PreviewOperationSummary::default();

    for asset in assets {
        summary.processed_assets += 1;
        let mut active_asset: photo_asset::ActiveModel = asset.clone().into();
        let mut changed = false;

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
        "preview" => asset.preview_rel_path.as_deref(),
        _ => None,
    }?;

    Some(data_dir().join(relative_path))
}

pub async fn delete_photo_asset(
    db: &DatabaseConnection,
    photo_id: &str,
) -> Result<photo_asset::Model, ApiError> {
    let asset = photo_asset::Entity::find_by_id(photo_id.to_owned())
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("photo"))?;

    let mut item: media_item::ActiveModel = media_item::Entity::find_by_id(asset.item_id.clone())
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("media item"))?
        .into();
    item.deleted_at = Set(Some(Utc::now()));
    item.updated_at = Set(Utc::now());
    item.update(db).await?;

    Ok(asset)
}

pub fn delete_asset_derivatives(asset: &photo_asset::Model) -> Result<(), ApiError> {
    if let Some(relative_path) = asset.preview_rel_path.as_deref() {
        delete_derivative_file(relative_path)?;
    }

    Ok(())
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
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "gif"
            )
        })
        .unwrap_or(false)
}

async fn render_derivatives(
    source_path: String,
    file_id: String,
    library_id: String,
    settings: ScanRenderSettings,
) -> Result<RenderedDerivatives, ApiError> {
    task::spawn_blocking(move || {
        let image = image::open(&source_path).map_err(|err| {
            ApiError::BadRequest(format!("failed to decode image {source_path}: {err}"))
        })?;
        let (width, height) = image.dimensions();
        let generated_at = Utc::now();

        let resized = image.resize(
            settings.preview_max_dimension,
            settings.preview_max_dimension,
            FilterType::Lanczos3,
        );
        let relative_path = format!(
            "preview/{library_id}/{file_id}_preview_{}.webp",
            settings.preview_max_dimension,
        );
        let target_path = data_dir().join(&relative_path);
        encode_as_webp(&resized, &target_path, settings.preview_quality)?;
        let file_size = fs::metadata(&target_path)?.len() as i64;
        let preview = Some(DerivativeFile {
            relative_path,
            file_size,
            generated_at,
        });

        Ok(RenderedDerivatives {
            width: width as i32,
            height: height as i32,
            preview,
        })
    })
    .await
    .map_err(|err| ApiError::BadRequest(format!("preview generation task failed: {err}")))?
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
    let parent = target_path
        .parent()
        .ok_or_else(|| ApiError::BadRequest("invalid derivative path".to_owned()))?;
    fs::create_dir_all(parent)?;
    let rgb = image.to_rgb8();
    let encoded = WebpEncoder::from_rgb(&rgb, rgb.width(), rgb.height()).encode(quality);
    fs::write(target_path, encoded.as_ref())?;

    Ok(())
}

fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data")
}

fn build_progress(
    total_assets: i64,
    summary: &PreviewOperationSummary,
) -> PreviewGenerationProgress {
    PreviewGenerationProgress {
        total_assets,
        processed_assets: summary.processed_assets,
        generated_previews: summary.generated_previews,
        skipped_assets: summary.skipped_assets,
        failed_assets: summary.failed_assets,
        last_error: summary.last_error.clone(),
    }
}

fn is_webp_derivative_path(relative_path: &str) -> bool {
    Path::new(relative_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("webp"))
        .unwrap_or(false)
}

async fn load_scan_render_settings(
    db: &DatabaseConnection,
) -> Result<ScanRenderSettings, ApiError> {
    let settings = app_setting::Entity::find_by_id(SETTINGS_ID)
        .one(db)
        .await?
        .ok_or_else(|| ApiError::NotFound("application settings"))?;

    Ok(ScanRenderSettings {
        preview_max_dimension: settings.preview_max_dimension.max(128) as u32,
        preview_quality: settings.preview_quality.clamp(1, 100) as f32,
    })
}
