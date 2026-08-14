use crate::{
    core::error::ApiError,
    infra::entities::{author, author_resource},
};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

pub fn leading_author(title: &str) -> Option<&str> {
    let mut value = title.trim_start();

    while let Some(stripped) = strip_leading_group(value) {
        value = stripped.trim_start();
    }

    let value = value.strip_prefix('[')?;
    let end = value.find(']')?;
    let name = value[..end].trim();
    (!name.is_empty()).then_some(name)
}

fn strip_leading_group(value: &str) -> Option<&str> {
    let (open, close) = match value.chars().next()? {
        '(' => ('(', ')'),
        '（' => ('（', '）'),
        _ => return None,
    };
    let end = value.find(close)?;
    value
        .strip_prefix(open)
        .map(|_| &value[end + close.len_utf8()..])
}
pub async fn link_author(
    txn: &DatabaseTransaction,
    title: &str,
    resource_id: &str,
) -> Result<(), ApiError> {
    let Some(name) = leading_author(title) else {
        return Ok(());
    };
    link_author_name(txn, name, "manga_series", resource_id).await
}

pub async fn link_author_name(
    txn: &DatabaseTransaction,
    name: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), ApiError> {
    let normalized = name.trim().to_lowercase();
    if normalized.is_empty() {
        return Ok(());
    }
    let now = Utc::now();
    let author = match author::Entity::find()
        .filter(author::Column::NormalizedName.eq(normalized.clone()))
        .one(txn)
        .await?
    {
        Some(value) => value,
        None => {
            author::ActiveModel {
                id: Set(Uuid::new_v4().to_string()),
                name: Set(name.to_owned()),
                normalized_name: Set(normalized),
                avatar_file_name: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(txn)
            .await?
        }
    };
    if author_resource::Entity::find()
        .filter(author_resource::Column::AuthorId.eq(author.id.clone()))
        .filter(author_resource::Column::ResourceType.eq(resource_type))
        .filter(author_resource::Column::ResourceId.eq(resource_id))
        .one(txn)
        .await?
        .is_none()
    {
        author_resource::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            author_id: Set(author.id),
            resource_type: Set(resource_type.to_owned()),
            resource_id: Set(resource_id.to_owned()),
            created_at: Set(now),
        }
        .insert(txn)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::leading_author;

    #[test]
    fn extracts_author_from_leading_brackets() {
        assert_eq!(
            leading_author("[ネッシートマト]会场限定本"),
            Some("ネッシートマト")
        );
    }

    #[test]
    fn ignores_event_prefix_before_author() {
        assert_eq!(
            leading_author("(C106) [ネッシートマト]会场限定本(チェンソーマン)[中国翻译]"),
            Some("ネッシートマト"),
        );
    }
}
