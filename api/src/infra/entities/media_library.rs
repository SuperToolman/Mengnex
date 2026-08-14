use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "media_libraries")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub root_path: String,
    pub source_type: String,
    pub webdav_connection_id: Option<String>,
    pub enabled: bool,
    pub previews_enabled: bool,
    pub scan_extensions: Option<String>,
    pub collections_enabled: bool,
    pub collection_type: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
