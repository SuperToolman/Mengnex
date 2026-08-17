use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "novel_chapters")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub book_id: String,
    pub sequence: i64,
    pub title: String,
    pub href: Option<String>,
    pub word_count: i64,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
