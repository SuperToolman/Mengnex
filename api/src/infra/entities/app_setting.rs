use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "app_settings")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub preview_max_dimension: i32,
    pub preview_quality: i32,
    pub media_cache_max_bytes: i64,
    pub media_cache_directory: Option<String>,
    pub video_probe_enabled: bool,
    pub video_probe_command: String,
    pub video_probe_timeout_seconds: i32,
    pub video_ffmpeg_command: String,
    pub video_cover_time_percent: i32,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
