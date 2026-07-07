use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::{DateTime, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{media_file, media_item, media_library, photo_asset},
    modules::photos::service::generate_library_thumbnails,
};

#[derive(Debug, Default)]
pub struct ScanSummary {
    pub discovered_files: i64,
    pub inserted_items: i64,
    pub updated_files: i64,
}

pub async fn scan_library(
    db: &DatabaseConnection,
    library: &media_library::Model,
    scan_task_id: String,
) -> Result<ScanSummary, ApiError> {
    let root = PathBuf::from(&library.root_path);

    if !root.exists() {
        return Err(ApiError::BadRequest(format!(
            "library root path does not exist: {}",
            library.root_path
        )));
    }

    if !root.is_dir() {
        return Err(ApiError::BadRequest(format!(
            "library root path is not a directory: {}",
            library.root_path
        )));
    }

    let files = collect_files(&root)?;
    let mut summary = ScanSummary {
        discovered_files: files.len() as i64,
        ..ScanSummary::default()
    };

    for path in files {
        let metadata = fs::metadata(&path)?;
        let full_path = normalize_path(&path);
        let existing_file = media_file::Entity::find()
            .filter(media_file::Column::FullPath.eq(full_path.clone()))
            .one(db)
            .await?;
        let now = Utc::now();

        if let Some(existing_file) = existing_file {
            let modified_at = modified_at(&metadata);
            let mut active_file: media_file::ActiveModel = existing_file.into();
            active_file.scan_task_id = Set(Some(scan_task_id.clone()));
            active_file.file_size = Set(metadata.len() as i64);
            active_file.modified_at = Set(modified_at);
            active_file.updated_at = Set(now);
            let file = active_file.update(db).await?;

            if library.media_type == "photo" && is_image_mime(file.mime_type.as_deref()) {
                upsert_photo_asset(db, library, &file, modified_at, now).await?;
            }

            summary.updated_files += 1;
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("unknown")
            .to_owned();
        let title = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(&file_name)
            .to_owned();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        let mime_type = extension.as_deref().and_then(infer_mime_type);

        let item_id = Uuid::new_v4().to_string();
        let item = media_item::ActiveModel {
            id: Set(item_id),
            library_id: Set(library.id.clone()),
            media_type: Set(library.media_type.clone()),
            title: Set(title.clone()),
            sort_title: Set(Some(title.to_ascii_lowercase())),
            original_path: Set(full_path.clone()),
            year: Set(None),
            metadata_json: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await?;

        let modified_at = modified_at(&metadata);
        let file = media_file::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            item_id: Set(item.id.clone()),
            library_id: Set(library.id.clone()),
            scan_task_id: Set(Some(scan_task_id.clone())),
            full_path: Set(full_path),
            file_name: Set(file_name),
            extension: Set(extension),
            mime_type: Set(mime_type.map(str::to_owned)),
            file_size: Set(metadata.len() as i64),
            modified_at: Set(modified_at),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await?;

        if library.media_type == "photo" && is_image_mime(file.mime_type.as_deref()) {
            upsert_photo_asset(db, library, &file, modified_at, now).await?;
        }

        summary.inserted_items += 1;
    }

    if library.media_type == "photo" && library.thumbnails_enabled {
        generate_library_thumbnails(db, library, false).await?;
    }

    Ok(summary)
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>, ApiError> {
    let mut files = Vec::new();
    collect_files_inner(root, &mut files)?;
    Ok(files)
}

fn collect_files_inner(path: &Path, files: &mut Vec<PathBuf>) -> Result<(), ApiError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            collect_files_inner(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }

    Ok(())
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn modified_at(metadata: &fs::Metadata) -> Option<DateTime<Utc>> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| DateTime::<Utc>::from(SystemTime::UNIX_EPOCH + duration))
}

fn infer_mime_type(extension: &str) -> Option<&'static str> {
    match extension {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "mp4" => Some("video/mp4"),
        "mkv" => Some("video/x-matroska"),
        "mp3" => Some("audio/mpeg"),
        "flac" => Some("audio/flac"),
        "epub" => Some("application/epub+zip"),
        "pdf" => Some("application/pdf"),
        "cbz" => Some("application/vnd.comicbook+zip"),
        "cbr" => Some("application/vnd.comicbook-rar"),
        _ => None,
    }
}

fn is_image_mime(mime_type: Option<&str>) -> bool {
    mime_type
        .map(|value| value.starts_with("image/"))
        .unwrap_or(false)
}

async fn upsert_photo_asset(
    db: &DatabaseConnection,
    library: &media_library::Model,
    file: &media_file::Model,
    taken_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    let batch_time = taken_at.unwrap_or(now);
    let title = Path::new(&file.file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&file.file_name)
        .to_owned();
    let existing_asset = photo_asset::Entity::find()
        .filter(photo_asset::Column::FileId.eq(file.id.clone()))
        .one(db)
        .await?;

    if let Some(existing_asset) = existing_asset {
        let mut active_asset: photo_asset::ActiveModel = existing_asset.into();
        active_asset.title = Set(title);
        active_asset.file_name = Set(file.file_name.clone());
        active_asset.source_path = Set(file.full_path.clone());
        active_asset.mime_type = Set(file.mime_type.clone());
        active_asset.file_size = Set(file.file_size);
        active_asset.taken_at = Set(taken_at);
        active_asset.batch_time = Set(batch_time);
        active_asset.updated_at = Set(now);
        active_asset.update(db).await?;

        return Ok(());
    }

    photo_asset::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        item_id: Set(file.item_id.clone()),
        file_id: Set(file.id.clone()),
        library_id: Set(library.id.clone()),
        title: Set(title),
        file_name: Set(file.file_name.clone()),
        source_path: Set(file.full_path.clone()),
        mime_type: Set(file.mime_type.clone()),
        file_size: Set(file.file_size),
        width: Set(None),
        height: Set(None),
        thumb_rel_path: Set(None),
        preview_rel_path: Set(None),
        thumb_file_size: Set(None),
        preview_file_size: Set(None),
        thumb_generated_at: Set(None),
        preview_generated_at: Set(None),
        taken_at: Set(taken_at),
        batch_time: Set(batch_time),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;

    Ok(())
}
