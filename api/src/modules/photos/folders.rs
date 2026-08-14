use std::collections::BTreeMap;

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QuerySelect,
    QueryTrait, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{media_item, media_library, photo_asset, photo_folder},
};

#[derive(Debug)]
struct FolderAggregate {
    parent_path: String,
    name: String,
    photo_count: i64,
    cover_asset_id: Option<String>,
    cover_batch_time: Option<chrono::DateTime<Utc>>,
}

pub fn folder_path_for_source(source_path: &str, library: &media_library::Model) -> Option<String> {
    let source_path = source_path.replace('\\', "/");
    let root_path = library.root_path.replace('\\', "/");
    let relative = if library.source_type == "webdav" {
        let url = reqwest::Url::parse(&source_path).ok()?;
        url.path()
            .trim_matches('/')
            .strip_prefix(root_path.trim_matches('/'))?
            .trim_matches('/')
            .to_owned()
    } else {
        source_path
            .strip_prefix(root_path.trim_end_matches('/'))?
            .trim_matches('/')
            .to_owned()
    };
    let mut segments = relative
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    segments.pop()?;
    Some(segments.join("/"))
}

pub async fn refresh_photo_folder_index(
    db: &DatabaseConnection,
    library: &media_library::Model,
) -> Result<(), ApiError> {
    let deleted_items = media_item::Entity::find()
        .select_only()
        .column(media_item::Column::Id)
        .filter(media_item::Column::DeletedAt.is_not_null())
        .into_query();
    let assets = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .filter(
            sea_orm::sea_query::Expr::col(photo_asset::Column::ItemId)
                .not_in_subquery(deleted_items),
        )
        .all(db)
        .await?;
    let now = Utc::now();
    let mut folders = BTreeMap::<String, FolderAggregate>::new();
    folders.insert(
        String::new(),
        FolderAggregate {
            parent_path: String::new(),
            name: String::new(),
            photo_count: 0,
            cover_asset_id: None,
            cover_batch_time: None,
        },
    );

    for asset in assets {
        let folder_path = folder_path_for_source(&asset.source_path, library).unwrap_or_default();
        if asset.folder_path != folder_path {
            let mut active_asset: photo_asset::ActiveModel = asset.clone().into();
            active_asset.folder_path = Set(folder_path.clone());
            active_asset.updated_at = Set(now);
            active_asset.update(db).await?;
        }

        let segments = folder_path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        for depth in 0..=segments.len() {
            let path = segments[..depth].join("/");
            let parent_path = if depth == 0 {
                String::new()
            } else {
                segments[..depth - 1].join("/")
            };
            let name = segments
                .get(depth.saturating_sub(1))
                .copied()
                .unwrap_or_default()
                .to_owned();
            let folder = folders.entry(path).or_insert_with(|| FolderAggregate {
                parent_path,
                name,
                photo_count: 0,
                cover_asset_id: None,
                cover_batch_time: None,
            });
            folder.photo_count += 1;
            if folder
                .cover_batch_time
                .is_none_or(|time| asset.batch_time > time)
            {
                folder.cover_asset_id = Some(asset.id.clone());
                folder.cover_batch_time = Some(asset.batch_time);
            }
        }
    }

    let txn = db.begin().await?;
    photo_folder::Entity::delete_many()
        .filter(photo_folder::Column::LibraryId.eq(library.id.clone()))
        .exec(&txn)
        .await?;
    for (path, folder) in folders {
        photo_folder::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            library_id: Set(library.id.clone()),
            path: Set(path),
            parent_path: Set(folder.parent_path),
            name: Set(folder.name),
            photo_count: Set(folder.photo_count),
            cover_asset_id: Set(folder.cover_asset_id),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&txn)
        .await?;
    }
    txn.commit().await?;

    Ok(())
}

pub async fn ensure_photo_folder_index(
    db: &DatabaseConnection,
    library: &media_library::Model,
) -> Result<(), ApiError> {
    let indexed = photo_folder::Entity::find()
        .filter(photo_folder::Column::LibraryId.eq(library.id.clone()))
        .filter(photo_folder::Column::Path.eq(""))
        .one(db)
        .await?
        .is_some();
    if !indexed {
        refresh_photo_folder_index(db, library).await?;
    }
    Ok(())
}
