use std::{
    collections::{BTreeMap, HashMap, HashSet},
    future::Future,
    path::Path,
};

use chrono::{DateTime, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    QueryFilter, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{
        media_file, media_item, media_library, photo_asset, video_asset, video_collection,
        video_collection_member, video_playback_state,
    },
    modules::{
        manga::service::rebuild_image_manga_index,
        media_types::processor_for,
        photos::{
            folders::{folder_path_for_source, refresh_photo_folder_index},
            service::{PreviewGenerationProgress, generate_library_previews_with_progress},
        },
        tasks::service::{UpdateAppTaskParams, update_app_task, wait_for_task_permit},
        videos::service::{generate_library_covers, resolve_cover_path, upsert_video_asset},
    },
};

#[derive(Debug, Default)]
pub struct ScanSummary {
    pub discovered_files: i64,
    pub processed_files: i64,
    pub inserted_items: i64,
    pub updated_files: i64,
    pub removed_files: i64,
    pub preview_file_ids: Vec<String>,
    pub preview_total: i64,
    pub preview_processed: i64,
    pub preview_failed: i64,
    pub previews_generated: i64,
    pub has_preview_phase: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ScanProgress {
    pub discovered_files: i64,
    pub processed_files: i64,
    pub inserted_items: i64,
    pub updated_files: i64,
    pub removed_files: i64,
    pub has_preview_phase: bool,
}

impl From<&ScanSummary> for ScanProgress {
    fn from(value: &ScanSummary) -> Self {
        Self {
            discovered_files: value.discovered_files,
            processed_files: value.processed_files,
            inserted_items: value.inserted_items,
            updated_files: value.updated_files,
            removed_files: value.removed_files,
            has_preview_phase: value.has_preview_phase,
        }
    }
}

pub async fn scan_library<F>(
    db: &DatabaseConnection,
    library: &media_library::Model,
    scan_task_id: String,
    mut on_progress: F,
) -> Result<ScanSummary, ApiError>
where
    F: FnMut(
        &ScanProgress,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), ApiError>> + Send + '_>>,
{
    let source =
        crate::modules::sources::resolve_library_source(db, library, &scan_task_id).await?;
    let files = source
        .list_entries()?
        .into_iter()
        .filter(|entry| {
            if library.media_type == "video" {
                if let Some(configured) = library.scan_extensions.as_deref() {
                    let extension = entry
                        .file_name
                        .rsplit_once('.')
                        .map(|(_, extension)| extension.to_ascii_lowercase());
                    if extension.as_ref().is_none_or(|extension| {
                        !configured.split(',').any(|allowed| allowed == extension)
                    }) {
                        return false;
                    }
                }
            }
            processor_for(&library.media_type).is_none_or(|processor| {
                processor.accepts(
                    entry.extension.as_deref().and_then(infer_mime_type),
                    &entry.file_name,
                )
            })
        })
        .collect::<Vec<_>>();
    let has_preview_phase = processor_for(&library.media_type)
        .is_some_and(|processor| processor.creates_derived_assets())
        && library.previews_enabled;
    let mut summary = ScanSummary {
        discovered_files: files.len() as i64,
        has_preview_phase,
        ..ScanSummary::default()
    };
    let existing_items = media_item::Entity::find()
        .filter(media_item::Column::LibraryId.eq(library.id.clone()))
        .all(db)
        .await?
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect::<HashMap<_, _>>();
    let mut existing_files = media_file::Entity::find()
        .filter(media_file::Column::LibraryId.eq(library.id.clone()))
        .all(db)
        .await?
        .into_iter()
        // `source_locator` is the stable source identity. `full_path` is only
        // a materialized local path and may change between WebDAV scans.
        .map(|file| {
            let locator = file
                .source_locator
                .clone()
                .unwrap_or_else(|| file.full_path.clone());
            (locator, file)
        })
        .collect::<HashMap<_, _>>();
    if processor_for(&library.media_type).is_some_and(|processor| processor.media_type() == "video")
    {
        let invalid_locators = existing_files
            .iter()
            .filter(|(_, file)| {
                let unsupported_media =
                    !processor_for(&library.media_type).is_some_and(|processor| {
                        processor.accepts(file.mime_type.as_deref(), &file.file_name)
                    });
                let excluded_by_library = library.media_type == "video"
                    && library
                        .scan_extensions
                        .as_deref()
                        .is_some_and(|configured| {
                            file.extension.as_ref().is_none_or(|extension| {
                                !configured.split(',').any(|allowed| allowed == extension)
                            })
                        });
                unsupported_media || excluded_by_library
            })
            .map(|(locator, _)| locator.clone())
            .collect::<Vec<_>>();
        for locator in invalid_locators {
            if let Some(file) = existing_files.remove(&locator) {
                purge_invalid_video_index(db, &file).await?;
                summary.removed_files += 1;
            }
        }
    }
    on_progress(&ScanProgress::from(&summary)).await?;

    for entry in files {
        wait_for_task_permit(db, &scan_task_id).await?;
        let source_locator = entry.locator;
        let full_path = entry
            .local_path
            .as_ref()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| source_locator.clone());
        let file_name = entry.file_name;
        let extension = entry.extension;
        let mime_type = extension.as_deref().and_then(infer_mime_type);
        let now = Utc::now();

        if let Some(existing_file) = existing_files.remove(&source_locator) {
            let item = existing_items
                .get(&existing_file.item_id)
                .ok_or(ApiError::NotFound("media item"))?;
            let metadata_unchanged = existing_file.full_path == full_path
                && existing_file.file_name == file_name
                && existing_file.extension == extension
                && existing_file.mime_type.as_deref() == mime_type
                && existing_file.file_size == entry.file_size
                && existing_file.modified_at == entry.modified_at;
            let etag_is_current = existing_file.etag == entry.etag;
            let content_changed = match (&existing_file.etag, &entry.etag) {
                (Some(existing_etag), Some(entry_etag)) => existing_etag != entry_etag,
                _ => {
                    existing_file.file_size != entry.file_size
                        || existing_file.modified_at != entry.modified_at
                }
            };
            let restore_missing_item = item.source_missing_at.is_some();

            if !restore_missing_item && metadata_unchanged && etag_is_current {
                summary.processed_files += 1;
                on_progress(&ScanProgress::from(&summary)).await?;
                continue;
            }

            let modified_at = entry.modified_at;
            {
                let txn = db.begin().await?;
                let item_id = existing_file.item_id.clone();
                let mut active_file: media_file::ActiveModel = existing_file.into();
                active_file.scan_task_id = Set(Some(scan_task_id.clone()));
                active_file.full_path = Set(full_path.clone());
                active_file.source_locator = Set(Some(source_locator.clone()));
                active_file.file_name = Set(file_name.clone());
                active_file.extension = Set(extension.clone());
                active_file.mime_type = Set(mime_type.map(str::to_owned));
                active_file.file_size = Set(entry.file_size);
                active_file.modified_at = Set(modified_at);
                active_file.etag = Set(entry.etag.clone());
                active_file.updated_at = Set(now);
                let file = active_file.update(&txn).await?;

                let item = existing_items
                    .get(&item_id)
                    .cloned()
                    .ok_or(ApiError::NotFound("media item"))?;
                let item_title = item.title.clone();
                if restore_missing_item {
                    let mut active_item: media_item::ActiveModel = item.into();
                    active_item.deleted_at = Set(None);
                    active_item.source_missing_at = Set(None);
                    active_item.updated_at = Set(now);
                    active_item.update(&txn).await?;
                }

                if library.media_type == "photo"
                    && processor_for(&library.media_type).is_some_and(|processor| {
                        processor.accepts(file.mime_type.as_deref(), &file.file_name)
                    })
                {
                    let existing_asset = photo_asset::Entity::find()
                        .filter(photo_asset::Column::FileId.eq(file.id.clone()))
                        .one(&txn)
                        .await?;
                    upsert_photo_asset(
                        &txn,
                        library,
                        &file,
                        existing_asset,
                        folder_path_for_source(&file.full_path, library).unwrap_or_default(),
                        modified_at,
                        now,
                    )
                    .await?;
                }

                if processor_for(&library.media_type)
                    .is_some_and(|processor| processor.media_type() == "video")
                {
                    upsert_video_asset(&txn, &file, &item_title).await?;
                }

                if content_changed || restore_missing_item {
                    summary.preview_file_ids.push(file.id.clone());
                }

                txn.commit().await?;
            }

            summary.processed_files += 1;
            summary.updated_files += 1;
            on_progress(&ScanProgress::from(&summary)).await?;
            continue;
        }

        let title = entry
            .local_path
            .as_deref()
            .and_then(Path::file_stem)
            .and_then(|value| value.to_str())
            .unwrap_or(&file_name)
            .to_owned();
        let modified_at = entry.modified_at;
        {
            let txn = db.begin().await?;
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
                deleted_at: Set(None),
                source_missing_at: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&txn)
            .await?;

            let file = media_file::ActiveModel {
                id: Set(Uuid::new_v4().to_string()),
                item_id: Set(item.id.clone()),
                library_id: Set(library.id.clone()),
                scan_task_id: Set(Some(scan_task_id.clone())),
                full_path: Set(full_path),
                source_locator: Set(Some(source_locator)),
                file_name: Set(file_name),
                extension: Set(extension),
                mime_type: Set(mime_type.map(str::to_owned)),
                file_size: Set(entry.file_size),
                modified_at: Set(modified_at),
                etag: Set(entry.etag),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&txn)
            .await?;

            if library.media_type == "photo"
                && processor_for(&library.media_type).is_some_and(|processor| {
                    processor.accepts(file.mime_type.as_deref(), &file.file_name)
                })
            {
                upsert_photo_asset(
                    &txn,
                    library,
                    &file,
                    None,
                    folder_path_for_source(&file.full_path, library).unwrap_or_default(),
                    modified_at,
                    now,
                )
                .await?;
            }

            if processor_for(&library.media_type)
                .is_some_and(|processor| processor.media_type() == "video")
            {
                upsert_video_asset(&txn, &file, &title).await?;
            }

            summary.preview_file_ids.push(file.id.clone());

            txn.commit().await?;
        }

        summary.processed_files += 1;
        summary.inserted_items += 1;
        on_progress(&ScanProgress::from(&summary)).await?;
    }

    summary.removed_files +=
        mark_missing_library_files(db, existing_files.into_values().collect()).await?;
    if library.media_type == "photo" {
        refresh_photo_folder_index(db, library).await?;
    }
    if library.media_type == "manga" {
        rebuild_image_manga_index(db, library).await?;
    }
    if library.media_type == "video" {
        rebuild_difference_video_collections(db, library).await?;
    }
    on_progress(&ScanProgress::from(&summary)).await?;

    if processor_for(&library.media_type)
        .is_some_and(|processor| processor.creates_derived_assets())
        && library.previews_enabled
    {
        wait_for_task_permit(db, &scan_task_id).await?;
        if library.media_type == "photo" {
            let progress_db = db.clone();
            let progress_task_id = scan_task_id.clone();
            let scan_processed = summary.processed_files;
            let scan_total = summary.discovered_files;
            let preview_summary = generate_library_previews_with_progress(
                db,
                library,
                false,
                Some(&scan_task_id),
                move |progress| {
                    let progress_db = progress_db.clone();
                    let progress_task_id = progress_task_id.clone();
                    let progress = progress.clone();
                    Box::pin(async move {
                        update_preview_task_progress(
                            &progress_db,
                            &progress_task_id,
                            scan_processed,
                            scan_total,
                            &progress,
                        )
                        .await
                    })
                },
            )
            .await?;
            summary.preview_total = preview_summary.processed_assets;
            summary.preview_processed = preview_summary.processed_assets;
            summary.preview_failed = preview_summary.failed_assets;
            summary.previews_generated = preview_summary.generated_previews;
        } else if processor_for(&library.media_type)
            .is_some_and(|processor| processor.media_type() == "video")
        {
            let cover_summary = generate_library_covers(
                db,
                library,
                &scan_task_id,
                false,
                Some((summary.processed_files, summary.discovered_files)),
            )
            .await?;
            summary.preview_total = cover_summary.processed_assets;
            summary.preview_processed = cover_summary.processed_assets;
            summary.preview_failed = cover_summary.failed_assets;
            summary.previews_generated = cover_summary.generated_covers;
        }
    }

    Ok(summary)
}

fn difference_member_order(file_name: &str) -> Option<i32> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    if stem == "video" {
        return Some(0);
    }
    let suffix = stem.strip_prefix("video")?;
    if suffix.is_empty() || !suffix.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    suffix.parse::<i32>().ok()
}

fn source_parent_and_title(source: &str) -> Option<(String, String)> {
    let normalized = source.replace('\\', "/");
    let (parent, _) = normalized.rsplit_once('/')?;
    let title = parent.rsplit('/').next()?.trim();
    if title.is_empty() {
        return None;
    }
    Some((parent.to_owned(), title.to_owned()))
}

async fn rebuild_difference_video_collections(
    db: &DatabaseConnection,
    library: &media_library::Model,
) -> Result<(), ApiError> {
    let old_collection_ids = video_collection::Entity::find()
        .filter(video_collection::Column::LibraryId.eq(&library.id))
        .all(db)
        .await?
        .into_iter()
        .map(|collection| collection.id)
        .collect::<Vec<_>>();
    let txn = db.begin().await?;
    if !old_collection_ids.is_empty() {
        video_collection_member::Entity::delete_many()
            .filter(video_collection_member::Column::CollectionId.is_in(old_collection_ids))
            .exec(&txn)
            .await?;
    }
    video_collection::Entity::delete_many()
        .filter(video_collection::Column::LibraryId.eq(&library.id))
        .exec(&txn)
        .await?;

    if !library.collections_enabled || library.collection_type.as_deref() != Some("difference") {
        txn.commit().await?;
        return Ok(());
    }

    let active_item_ids = media_item::Entity::find()
        .filter(media_item::Column::LibraryId.eq(&library.id))
        .filter(media_item::Column::DeletedAt.is_null())
        .filter(media_item::Column::SourceMissingAt.is_null())
        .all(&txn)
        .await?
        .into_iter()
        .map(|item| item.id)
        .collect::<HashSet<_>>();
    let assets_by_file = video_asset::Entity::find()
        .filter(video_asset::Column::LibraryId.eq(&library.id))
        .all(&txn)
        .await?
        .into_iter()
        .map(|asset| (asset.file_id.clone(), asset))
        .collect::<HashMap<_, _>>();
    let files = media_file::Entity::find()
        .filter(media_file::Column::LibraryId.eq(&library.id))
        .all(&txn)
        .await?;
    let mut groups: HashMap<String, (String, BTreeMap<i32, String>)> = HashMap::new();

    for file in files {
        if !active_item_ids.contains(&file.item_id) {
            continue;
        }
        let Some(order) = difference_member_order(&file.file_name) else {
            continue;
        };
        let Some(asset) = assets_by_file.get(&file.id) else {
            continue;
        };
        let source = file.source_locator.as_deref().unwrap_or(&file.full_path);
        let Some((parent, title)) = source_parent_and_title(source) else {
            continue;
        };
        groups
            .entry(parent)
            .or_insert_with(|| (title, BTreeMap::new()))
            .1
            .entry(order)
            .or_insert_with(|| asset.id.clone());
    }

    let now = Utc::now();
    for (source_path, (title, members)) in groups {
        if members.len() < 2 {
            continue;
        }
        let collection_id = Uuid::new_v4().to_string();
        let default_video_asset_id = members
            .get(&0)
            .or_else(|| members.values().next())
            .expect("collection has members")
            .clone();
        video_collection::ActiveModel {
            id: Set(collection_id.clone()),
            library_id: Set(library.id.clone()),
            title: Set(title),
            source_path: Set(source_path),
            collection_type: Set("difference".to_owned()),
            default_video_asset_id: Set(default_video_asset_id),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&txn)
        .await?;
        for (sort_order, video_asset_id) in members {
            video_collection_member::ActiveModel {
                id: Set(Uuid::new_v4().to_string()),
                collection_id: Set(collection_id.clone()),
                video_asset_id: Set(video_asset_id),
                sort_order: Set(sort_order),
                created_at: Set(now),
            }
            .insert(&txn)
            .await?;
        }
    }
    txn.commit().await?;
    Ok(())
}

async fn update_preview_task_progress(
    db: &DatabaseConnection,
    task_id: &str,
    scan_processed: i64,
    scan_total: i64,
    progress: &PreviewGenerationProgress,
) -> Result<(), ApiError> {
    let overall_processed = scan_processed.saturating_add(progress.processed_assets);
    let overall_total = scan_total.saturating_add(progress.total_assets);
    let overall_percent = if overall_total <= 0 {
        99
    } else {
        ((overall_processed as f64 / overall_total as f64) * 100.0)
            .round()
            .clamp(0.0, 99.0) as i32
    };
    let mut detail = format!(
        "正在生成预览图：已生成 {}，已跳过 {}，失败 {}",
        progress.generated_previews, progress.skipped_assets, progress.failed_assets
    );
    if let Some(error) = progress.last_error.as_deref() {
        let abbreviated = error.chars().take(300).collect::<String>();
        detail.push_str(&format!("; last failure: {abbreviated}"));
    }
    update_app_task(
        db,
        task_id,
        UpdateAppTaskParams {
            progress_percent: Some(overall_percent),
            processed_items: Some(overall_processed),
            total_items: Some(overall_total),
            detail: Some(Some(detail)),
            error_message: Some(None),
            ..UpdateAppTaskParams::default()
        },
    )
    .await?;
    Ok(())
}

async fn purge_invalid_video_index(
    db: &DatabaseConnection,
    file: &media_file::Model,
) -> Result<(), ApiError> {
    let asset = video_asset::Entity::find()
        .filter(video_asset::Column::FileId.eq(&file.id))
        .one(db)
        .await?;
    if let Some(asset) = &asset {
        if let Some(path) = resolve_cover_path(asset) {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
    let txn = db.begin().await?;
    if let Some(asset) = asset {
        video_collection_member::Entity::delete_many()
            .filter(video_collection_member::Column::VideoAssetId.eq(&asset.id))
            .exec(&txn)
            .await?;
        video_playback_state::Entity::delete_many()
            .filter(video_playback_state::Column::VideoAssetId.eq(&asset.id))
            .exec(&txn)
            .await?;
        video_asset::Entity::delete_by_id(asset.id)
            .exec(&txn)
            .await?;
    }
    media_file::Entity::delete_by_id(file.id.clone())
        .exec(&txn)
        .await?;
    media_item::Entity::delete_by_id(file.item_id.clone())
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
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

async fn upsert_photo_asset(
    db: &DatabaseTransaction,
    library: &media_library::Model,
    file: &media_file::Model,
    existing_asset: Option<photo_asset::Model>,
    folder_path: String,
    taken_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    let batch_time = taken_at.unwrap_or(now);
    let title = Path::new(&file.file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&file.file_name)
        .to_owned();
    if let Some(existing_asset) = existing_asset {
        let mut active_asset: photo_asset::ActiveModel = existing_asset.into();
        active_asset.title = Set(title);
        active_asset.file_name = Set(file.file_name.clone());
        active_asset.source_path = Set(file.full_path.clone());
        active_asset.folder_path = Set(folder_path);
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
        folder_path: Set(folder_path),
        mime_type: Set(file.mime_type.clone()),
        file_size: Set(file.file_size),
        width: Set(None),
        height: Set(None),
        preview_rel_path: Set(None),
        preview_file_size: Set(None),
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

async fn mark_missing_library_files(
    db: &DatabaseConnection,
    stale_files: Vec<media_file::Model>,
) -> Result<i64, ApiError> {
    if stale_files.is_empty() {
        return Ok(0);
    }

    let active_items = media_item::Entity::find()
        .filter(media_item::Column::Id.is_in(stale_files.iter().map(|file| file.item_id.clone())))
        .filter(media_item::Column::DeletedAt.is_null())
        .all(db)
        .await?;

    if active_items.is_empty() {
        return Ok(0);
    }

    let marked_count = active_items.len() as i64;
    let txn = db.begin().await?;
    let now = Utc::now();
    for item in active_items {
        let mut active_item: media_item::ActiveModel = item.into();
        active_item.deleted_at = Set(Some(now));
        active_item.source_missing_at = Set(Some(now));
        active_item.updated_at = Set(now);
        active_item.update(&txn).await?;
    }
    txn.commit().await?;

    Ok(marked_count)
}

#[cfg(test)]
mod video_collection_tests {
    use super::{difference_member_order, source_parent_and_title};

    #[test]
    fn recognizes_only_difference_collection_member_names() {
        assert_eq!(difference_member_order("video.mp4"), Some(0));
        assert_eq!(difference_member_order("VIDEO2.mkv"), Some(2));
        assert_eq!(difference_member_order("video15.webm"), Some(15));
        assert_eq!(difference_member_order("其他视频.mp4"), None);
        assert_eq!(difference_member_order("video-edit.mp4"), None);
        assert_eq!(difference_member_order("video1-copy.mp4"), None);
    }

    #[test]
    fn derives_collection_title_from_parent_directory() {
        assert_eq!(
            source_parent_and_title("D:/SAVE/Test/AuditPool/去海的那一天/video.mp4"),
            Some((
                "D:/SAVE/Test/AuditPool/去海的那一天".to_owned(),
                "去海的那一天".to_owned(),
            ))
        );
    }
}
