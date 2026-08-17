use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "novel_books")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub item_id: String,
    pub file_id: String,
    pub library_id: String,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub format: String,
    pub cover_rel_path: Option<String>,
    pub chapter_count: i64,
    pub parse_status: String,
    pub parse_error: Option<String>,
    pub parsed_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
