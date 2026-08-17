use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "music_albums")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub library_id: String,
    pub title: String,
    pub normalized_title: String,
    pub artist: Option<String>,
    pub year: Option<i32>,
    pub cover_rel_path: Option<String>,
    pub track_count: i64,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
