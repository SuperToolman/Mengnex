use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::entities::video_asset;

#[derive(Debug, Serialize, ToSchema)]
pub struct VideoAssetResponse {
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
    pub stream_src: String,
    pub poster_src: Option<String>,
    pub poster_file_size: Option<i64>,
    pub playback_position_seconds: f64,
    pub playback_completed: bool,
    pub collection_id: Option<String>,
    pub collection_title: Option<String>,
    pub collection_type: Option<String>,
    pub collection_member_count: Option<u64>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

impl From<video_asset::Model> for VideoAssetResponse {
    fn from(value: video_asset::Model) -> Self {
        let poster_src = value.poster_rel_path.as_ref().map(|_| {
            let version = value
                .poster_generated_at
                .as_ref()
                .map(|generated_at| generated_at.timestamp_millis())
                .unwrap_or_default();
            format!("/api/videos/{}/poster?v={version}", value.id)
        });
        Self {
            stream_src: format!("/api/media/files/{}/content", value.file_id),
            poster_src,
            id: value.id,
            item_id: value.item_id,
            file_id: value.file_id,
            library_id: value.library_id,
            title: value.title,
            duration_seconds: value.duration_seconds,
            width: value.width,
            height: value.height,
            video_codec: value.video_codec,
            audio_codec: value.audio_codec,
            container: value.container,
            analysis_status: value.analysis_status,
            poster_file_size: value.poster_file_size,
            playback_position_seconds: 0.0,
            playback_completed: false,
            collection_id: None,
            collection_title: None,
            collection_type: None,
            collection_member_count: None,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VideoCatalogResponse {
    pub items: Vec<VideoAssetResponse>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VideoDetailResponse {
    #[serde(flatten)]
    pub video: VideoAssetResponse,
    pub library_name: String,
    pub file_name: String,
    pub file_size: i64,
    pub source_path: String,
    pub source_missing: bool,
    pub analysis_error: Option<String>,
    pub poster_error: Option<String>,
    pub previous_video_id: Option<String>,
    pub next_video_id: Option<String>,
    pub collection: Option<VideoCollectionResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VideoCollectionResponse {
    pub id: String,
    pub title: String,
    pub collection_type: String,
    pub default_video_asset_id: String,
    pub members: Vec<VideoAssetResponse>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateVideoPlaybackRequest {
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub completed: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VideoPlaybackResponse {
    pub video_asset_id: String,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub completed: bool,
    #[schema(value_type = String, format = DateTime)]
    pub last_played_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VideoCoverJobResponse {
    pub library_id: String,
    pub processed_assets: i64,
    pub generated_covers: i64,
    pub skipped_assets: i64,
    pub failed_assets: i64,
    pub deleted_covers: i64,
    pub reclaimed_bytes: i64,
}
