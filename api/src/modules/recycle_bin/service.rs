use std::{fs, path::Path};

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};

use crate::{
    core::error::ApiError,
    infra::entities::{
        media_file, media_item, photo_asset, video_asset, video_collection_member,
        video_playback_state,
    },
    modules::photos::service::delete_asset_derivatives,
};

pub async fn restore_media_item(db: &DatabaseConnection, item_id: &str) -> Result<(), ApiError> {
    let item = media_item::Entity::find_by_id(item_id.to_owned())
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("recycle bin item"))?;

    if item.deleted_at.is_none() {
        return Err(ApiError::BadRequest(
            "item is not in the recycle bin".to_owned(),
        ));
    }

    let mut item: media_item::ActiveModel = item.into();
    item.deleted_at = Set(None);
    item.updated_at = Set(Utc::now());
    item.update(db).await?;
    Ok(())
}

pub async fn purge_media_item(db: &DatabaseConnection, item_id: &str) -> Result<(), ApiError> {
    let item = media_item::Entity::find_by_id(item_id.to_owned())
        .one(db)
        .await?
        .ok_or(ApiError::NotFound("recycle bin item"))?;

    if item.deleted_at.is_none() {
        return Err(ApiError::BadRequest(
            "only recycled items can be permanently deleted".to_owned(),
        ));
    }

    let assets = photo_asset::Entity::find()
        .filter(photo_asset::Column::ItemId.eq(item.id.clone()))
        .all(db)
        .await?;

    for asset in &assets {
        if Path::new(&asset.source_path).exists() {
            fs::remove_file(&asset.source_path)?;
        }
        delete_asset_derivatives(asset)?;
    }

    let item_video_ids = video_asset::Entity::find()
        .filter(video_asset::Column::ItemId.eq(item.id.clone()))
        .all(db)
        .await?
        .into_iter()
        .map(|asset| asset.id)
        .collect::<Vec<_>>();
    let txn = db.begin().await?;
    photo_asset::Entity::delete_many()
        .filter(photo_asset::Column::ItemId.eq(item.id.clone()))
        .exec(&txn)
        .await?;
    if !item_video_ids.is_empty() {
        video_collection_member::Entity::delete_many()
            .filter(video_collection_member::Column::VideoAssetId.is_in(item_video_ids.clone()))
            .exec(&txn)
            .await?;
        video_playback_state::Entity::delete_many()
            .filter(video_playback_state::Column::VideoAssetId.is_in(item_video_ids))
            .exec(&txn)
            .await?;
    }
    video_asset::Entity::delete_many()
        .filter(video_asset::Column::ItemId.eq(item.id.clone()))
        .exec(&txn)
        .await?;
    media_file::Entity::delete_many()
        .filter(media_file::Column::ItemId.eq(item.id.clone()))
        .exec(&txn)
        .await?;
    media_item::Entity::delete_by_id(item.id).exec(&txn).await?;
    txn.commit().await?;

    Ok(())
}
