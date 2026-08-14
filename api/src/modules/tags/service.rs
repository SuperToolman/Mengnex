use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{tag, tag_resource},
};

pub async fn link_tag_name(
    txn: &DatabaseTransaction,
    name: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), ApiError> {
    let normalized_name = name.trim().to_lowercase();
    if normalized_name.is_empty() {
        return Ok(());
    }

    let now = Utc::now();
    let tag = match tag::Entity::find()
        .filter(tag::Column::NormalizedName.eq(normalized_name.clone()))
        .one(txn)
        .await?
    {
        Some(value) => value,
        None => {
            tag::ActiveModel {
                id: Set(Uuid::new_v4().to_string()),
                name: Set(name.trim().to_owned()),
                normalized_name: Set(normalized_name),
                avatar_url: Set(None),
                background_url: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(txn)
            .await?
        }
    };

    if tag_resource::Entity::find()
        .filter(tag_resource::Column::TagId.eq(tag.id.clone()))
        .filter(tag_resource::Column::ResourceType.eq(resource_type))
        .filter(tag_resource::Column::ResourceId.eq(resource_id))
        .one(txn)
        .await?
        .is_none()
    {
        tag_resource::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            tag_id: Set(tag.id),
            resource_type: Set(resource_type.to_owned()),
            resource_id: Set(resource_id.to_owned()),
            created_at: Set(now),
        }
        .insert(txn)
        .await?;
    }

    Ok(())
}
