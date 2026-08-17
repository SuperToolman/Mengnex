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
        photos::folders::{folder_path_for_source, refresh_photo_folder_index},
        tasks::service::wait_for_task_permit,
        videos::service::{resolve_cover_path, upsert_video_asset},
    },
};

#[derive(Debug, Default)]
pub struct ScanSummary {
    pub discovered_files: i64,
    pub processed_files: i64,
    pub inserted_items: i64,
    pub updated_files: i64,
    pub removed_files: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ScanProgress {
    pub discovered_files: i64,
    pub processed_files: i64,
    pub inserted_items: i64,
    pub updated_files: i64,
    pub removed_files: i64,
}

impl From<&ScanSummary> for ScanProgress {
    fn from(value: &ScanSummary) -> Self {
        Self {
            discovered_files: value.discovered_files,
            processed_files: value.processed_files,
            inserted_items: value.inserted_items,
            updated_files: value.updated_files,
            removed_files: value.removed_files,
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
            if library.media_type == "video"
                && let Some(configured) = library.scan_extensions.as_deref()
            {
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
            processor_for(&library.media_type).is_none_or(|processor| {
                processor.accepts(
                    entry.extension.as_deref().and_then(infer_mime_type),
                    &entry.file_name,
                )
            })
        })
        .collect::<Vec<_>>();
    let mut summary = ScanSummary {
        discovered_files: files.len() as i64,
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

    Ok(summary)
}

fn difference_group_name(file_name: &str) -> Option<(Option<String>, String)> {
    let stem = Path::new(file_name).file_stem()?.to_str()?.trim();
    let mut title = stem;
    let author = crate::modules::authors::service::leading_author(stem).map(str::trim);
    if author.is_some()
        && let Some(end) = title.find(']')
    {
        title = title[end + 1..].trim();
    }
    loop {
        let trimmed = title.trim_end();
        let stripped = ['}', ')', ']'].iter().find_map(|close| {
            let open = match close {
                ')' => '(',
                ']' => '[',
                '}' => '{',
                _ => return None,
            };
            trimmed
                .rfind(open)
                .filter(|index| trimmed[*index..].ends_with(*close))
                .map(|index| trimmed[..index].trim())
        });
        match stripped {
            Some(value) => title = value,
            None => break,
        }
    }
    let lower = title.to_ascii_lowercase();
    if lower.strip_prefix("video").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
    }) {
        title = &title[.."video".len()];
    }
    let lower = title.to_ascii_lowercase();
    let title = [" custom outfit", " original outfit"]
        .iter()
        .find_map(|suffix| {
            lower
                .ends_with(suffix)
                .then(|| title[..title.len() - suffix.len()].trim())
        })
        .unwrap_or(title);
    (!title.is_empty()).then(|| (author.map(str::to_owned), title.to_owned()))
}

fn difference_group_key(file_name: &str) -> Option<(Option<String>, String)> {
    difference_group_name(file_name).map(|(author, title)| {
        (
            author.map(|value| value.to_ascii_lowercase()),
            title.to_ascii_lowercase(),
        )
    })
}

fn source_parent_path(source: &str) -> Option<String> {
    let normalized = source.replace('\\', "/");
    let (parent, _) = normalized.rsplit_once('/')?;
    (!parent.is_empty()).then(|| parent.to_owned())
}

fn difference_group_identity(
    source: &str,
    file_name: &str,
) -> Option<(String, Option<String>, String)> {
    let parent = source_parent_path(source)?;
    let (author, title) = difference_group_key(file_name)?;
    Some((parent, author, title))
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
    let mut groups: HashMap<
        (String, Option<String>, String),
        (Option<String>, String, BTreeMap<String, String>),
    > = HashMap::new();

    for file in files {
        if !active_item_ids.contains(&file.item_id) {
            continue;
        }
        let Some(asset) = assets_by_file.get(&file.id) else {
            continue;
        };
        let source = file.source_locator.as_deref().unwrap_or(&file.full_path);
        let Some(group_key) = difference_group_identity(source, &file.file_name) else {
            continue;
        };
        let Some((display_author, display_title)) = difference_group_name(&file.file_name) else {
            continue;
        };
        groups
            .entry(group_key)
            .or_insert_with(|| (display_author, display_title, BTreeMap::new()))
            .2
            .entry(file.file_name.clone())
            .or_insert_with(|| asset.id.clone());
    }

    let now = Utc::now();
    for ((parent, author, title), (display_author, display_title, members)) in groups {
        if members.len() < 2 {
            continue;
        }
        let collection_id = Uuid::new_v4().to_string();
        let default_video_asset_id = members
            .values()
            .next()
            .expect("collection has members")
            .clone();
        let collection_title = display_author
            .as_deref()
            .map(|author| format!("[{author}] {display_title}"))
            .unwrap_or(display_title);
        let collection_source_path = format!(
            "difference://{}/{}/{}",
            parent,
            author.as_deref().unwrap_or("unattributed"),
            title
        );
        video_collection::ActiveModel {
            id: Set(collection_id.clone()),
            library_id: Set(library.id.clone()),
            title: Set(collection_title),
            source_path: Set(collection_source_path),
            collection_type: Set("difference".to_owned()),
            default_video_asset_id: Set(default_video_asset_id),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&txn)
        .await?;
        for (sort_order, video_asset_id) in members.values().enumerate() {
            video_collection_member::ActiveModel {
                id: Set(Uuid::new_v4().to_string()),
                collection_id: Set(collection_id.clone()),
                video_asset_id: Set(video_asset_id.clone()),
                sort_order: Set(sort_order as i32),
                created_at: Set(now),
            }
            .insert(&txn)
            .await?;
        }
    }
    txn.commit().await?;
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
    if let Some(asset) = &asset
        && let Some(path) = resolve_cover_path(asset)
    {
        let _ = tokio::fs::remove_file(path).await;
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
    use super::{difference_group_identity, difference_group_key, difference_group_name};

    #[test]
    fn keeps_same_normalized_title_in_separate_parent_directories() {
        let dir1_video = difference_group_identity("D:/SAVE/dir1/video.mp4", "video.mp4");
        let dir1_video1 = difference_group_identity("D:/SAVE/dir1/video1.mp4", "video1.mp4");
        let dir2_video = difference_group_identity("D:/SAVE/dir2/video.mp4", "video.mp4");
        let dir2_video2 = difference_group_identity("D:/SAVE/dir2/video2.mp4", "video2.mp4");

        assert_eq!(dir1_video, dir1_video1);
        assert_eq!(dir2_video, dir2_video2);
        assert_ne!(dir1_video, dir2_video);
        assert_eq!(
            difference_group_key("video.mp4"),
            Some((None, "video".to_owned()))
        );
    }

    #[test]
    fn normalizes_optional_author_and_known_video_variants() {
        assert_eq!(
            difference_group_name("[Aries] 2B & 9S - YoRHa Bunker (4K).mp4"),
            Some((
                Some("Aries".to_owned()),
                "2B & 9S - YoRHa Bunker".to_owned(),
            ))
        );
        assert_eq!(
            difference_group_key("[Aries] 2B & 9S - YoRHa Bunker (4K).mp4"),
            Some((
                Some("aries".to_owned()),
                "2b & 9s - yorha bunker".to_owned(),
            ))
        );
        assert_eq!(
            difference_group_key("[Aries] 2B & 9S - YoRHa Bunker [WM].mp4"),
            difference_group_key("[Aries] 2B & 9S - YoRHa Bunker (4K).mp4")
        );
        assert_eq!(
            difference_group_key("[Erovirus] 2025 ToSaveMankind Complete Custom Outfit.mp4"),
            difference_group_key("[Erovirus] 2025 ToSaveMankind Complete Original Outfit.mp4")
        );
    }
}
