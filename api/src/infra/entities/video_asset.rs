use sea_orm::entity::prelude::*;
use serde::Serialize;

/// Technical metadata for a playable video file. Content catalogues (movie,
/// series, episode) deliberately reference this entity instead of duplicating
/// stream and codec fields per media type.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "video_assets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub item_id: String,
    pub file_id: String,
    pub library_id: String,
    pub title: String,
    pub duration_seconds: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub container: Option<String>,
    pub analysis_status: String,
    pub analysis_error: Option<String>,
    pub analyzed_at: Option<DateTimeUtc>,
    pub poster_rel_path: Option<String>,
    pub poster_file_size: Option<i64>,
    pub poster_generated_at: Option<DateTimeUtc>,
    pub poster_error: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
