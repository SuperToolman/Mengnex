use crate::{
    core::error::ApiError,
    infra::entities::{author_resource, media_file, media_library, photo_asset},
    modules::{authors::service::link_author_name, sources},
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};
use std::{fs::File, io::BufReader, path::Path};

#[expect(dead_code, reason = "reserved for explicit EXIF metadata rebuild jobs")]
pub async fn rebuild_photo_author_links_for_files(
    db: &DatabaseConnection,
    library: &media_library::Model,
    file_ids: &[String],
) -> Result<(), ApiError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    let assets = photo_asset::Entity::find()
        .filter(photo_asset::Column::LibraryId.eq(library.id.clone()))
        .filter(photo_asset::Column::FileId.is_in(file_ids.iter().cloned()))
        .all(db)
        .await?;
    for asset in assets {
        let Some(file) = media_file::Entity::find_by_id(asset.file_id.clone())
            .one(db)
            .await?
        else {
            continue;
        };
        let materialized =
            sources::materialize_media_file_for_derivative(db, library, &file).await?;
        let author = read_exif_author(&materialized.path).await;
        if materialized.temporary {
            let _ = tokio::fs::remove_file(&materialized.path).await;
        }
        let txn = db.begin().await?;
        author_resource::Entity::delete_many()
            .filter(author_resource::Column::ResourceType.eq("photo_asset"))
            .filter(author_resource::Column::ResourceId.eq(asset.id.clone()))
            .exec(&txn)
            .await?;
        if let Some(name) = author {
            link_author_name(&txn, &name, "photo_asset", &asset.id).await?;
        }
        txn.commit().await?;
    }
    Ok(())
}

async fn read_exif_author(path: &Path) -> Option<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = File::open(path).ok()?;
        let mut reader = BufReader::new(file);
        let exif = exif::Reader::new().read_from_container(&mut reader).ok()?;
        let field = exif.get_field(exif::Tag::Artist, exif::In::PRIMARY)?;
        let value = field.display_value().with_unit(&exif).to_string();
        let value = value.trim().to_owned();
        (!value.is_empty()).then_some(value)
    })
    .await
    .ok()
    .flatten()
}
