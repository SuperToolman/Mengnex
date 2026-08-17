use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "music_tracks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub item_id: String,
    pub file_id: String,
    pub library_id: String,
    pub album_id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album_title: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub year: Option<i32>,
    pub duration_seconds: Option<f64>,
    pub codec: Option<String>,
    pub bitrate_kbps: Option<i32>,
    pub sample_rate_hz: Option<i32>,
    pub bit_depth: Option<i32>,
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub lyricist: Option<String>,
    pub producer: Option<String>,
    pub lyrics: Option<String>,
    pub lyrics_source: Option<String>,
    pub metadata_status: String,
    pub metadata_error: Option<String>,
    pub analyzed_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
