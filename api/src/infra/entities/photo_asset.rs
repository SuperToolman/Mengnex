use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "photo_assets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub item_id: String,
    pub file_id: String,
    pub library_id: String,
    pub title: String,
    pub file_name: String,
    pub source_path: String,
    pub mime_type: Option<String>,
    pub file_size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub thumb_rel_path: Option<String>,
    pub preview_rel_path: Option<String>,
    pub thumb_file_size: Option<i64>,
    pub preview_file_size: Option<i64>,
    pub thumb_generated_at: Option<DateTimeUtc>,
    pub preview_generated_at: Option<DateTimeUtc>,
    pub taken_at: Option<DateTimeUtc>,
    pub batch_time: DateTimeUtc,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
