use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::entities::app_setting;

#[derive(Debug, Serialize, ToSchema)]
pub struct PreferencesResponse {
    pub preview_max_dimension: i32,
    pub preview_quality: i32,
    pub media_cache_max_bytes: i64,
    pub media_cache_directory: Option<String>,
    pub video_probe_enabled: bool,
    pub video_probe_command: String,
    pub video_probe_timeout_seconds: i32,
    pub video_ffmpeg_command: String,
    pub video_cover_time_percent: i32,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdatePreferencesRequest {
    pub preview_max_dimension: Option<i32>,
    pub preview_quality: Option<i32>,
    pub media_cache_max_bytes: Option<i64>,
    pub media_cache_directory: Option<String>,
    pub video_probe_enabled: Option<bool>,
    pub video_probe_command: Option<String>,
    pub video_probe_timeout_seconds: Option<i32>,
    pub video_ffmpeg_command: Option<String>,
    pub video_cover_time_percent: Option<i32>,
}

impl From<app_setting::Model> for PreferencesResponse {
    fn from(value: app_setting::Model) -> Self {
        Self {
            preview_max_dimension: value.preview_max_dimension,
            preview_quality: value.preview_quality,
            media_cache_max_bytes: value.media_cache_max_bytes,
            media_cache_directory: value.media_cache_directory,
            video_probe_enabled: value.video_probe_enabled,
            video_probe_command: value.video_probe_command,
            video_probe_timeout_seconds: value.video_probe_timeout_seconds,
            video_ffmpeg_command: value.video_ffmpeg_command,
            video_cover_time_percent: value.video_cover_time_percent,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}
