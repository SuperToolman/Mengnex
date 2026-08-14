use chrono::{DateTime, Utc};
use sea_orm::Set;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infra::entities::media_library;
use crate::modules::{photos::dto::PhotoAssetResponse, videos::dto::VideoAssetResponse};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Photo,
    Video,
    MixedVideo,
    Game,
    Manga,
    Anime,
    Movie,
    Series,
    Novel,
    Music,
    Other,
}

impl std::fmt::Display for MediaType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Photo => "photo",
            Self::Video => "video",
            Self::MixedVideo => "mixed_video",
            Self::Game => "game",
            Self::Manga => "manga",
            Self::Anime => "anime",
            Self::Movie => "movie",
            Self::Series => "series",
            Self::Novel => "novel",
            Self::Music => "music",
            Self::Other => "other",
        };

        formatter.write_str(value)
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateLibraryRequest {
    pub name: String,
    pub media_type: MediaType,
    pub root_path: String,
    pub previews_enabled: bool,
    #[serde(default = "default_source_type")]
    pub source_type: String,
    pub webdav_connection_id: Option<String>,
    pub scan_extensions: Option<Vec<String>>,
    #[serde(default)]
    pub collections_enabled: bool,
    pub collection_type: Option<String>,
}

fn default_source_type() -> String {
    "local".to_owned()
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateLibraryPreviewConfigRequest {
    pub previews_enabled: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateLibraryRequest {
    pub name: Option<String>,
    pub root_path: Option<String>,
    pub enabled: Option<bool>,
    pub previews_enabled: Option<bool>,
    pub source_type: Option<String>,
    pub webdav_connection_id: Option<String>,
    pub scan_extensions: Option<Vec<String>>,
    pub collections_enabled: Option<bool>,
    pub collection_type: Option<String>,
}

#[derive(Debug, Serialize, ToSchema, Default, Clone)]
pub struct LibraryPreviewStatusResponse {
    pub total_assets: i64,
    pub preview_ready_assets: i64,
    pub pending_assets: i64,
    pub preview_total_bytes: i64,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub last_generated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LibraryPreviewJobResponse {
    pub library_id: String,
    pub processed_assets: i64,
    pub generated_previews: i64,
    pub skipped_assets: i64,
    pub deleted_previews: i64,
    pub reclaimed_bytes: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PreviewGenerationTaskResponse {
    pub task_id: String,
    pub library_id: String,
    pub status: String,
    pub total_assets: i64,
    pub processed_assets: i64,
    pub generated_previews: i64,
    pub skipped_assets: i64,
    pub progress_percent: i32,
    pub error_message: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LibraryResponse {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub root_path: String,
    pub enabled: bool,
    pub previews_enabled: bool,
    pub source_type: String,
    pub webdav_connection_id: Option<String>,
    pub scan_extensions: Vec<String>,
    pub collections_enabled: bool,
    pub collection_type: Option<String>,
    pub resource_count: i64,
    pub preview_status: LibraryPreviewStatusResponse,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteLibraryResponse {
    pub id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LibraryCoversResponse {
    pub photos: Vec<PhotoAssetResponse>,
    pub videos: Vec<VideoAssetResponse>,
}

impl LibraryResponse {
    pub fn from_model(
        value: media_library::Model,
        resource_count: i64,
        preview_status: LibraryPreviewStatusResponse,
    ) -> Self {
        Self {
            id: value.id,
            name: value.name,
            media_type: value.media_type,
            root_path: value.root_path,
            enabled: value.enabled,
            previews_enabled: value.previews_enabled,
            source_type: value.source_type,
            webdav_connection_id: value.webdav_connection_id,
            scan_extensions: parse_scan_extensions(value.scan_extensions.as_deref()),
            collections_enabled: value.collections_enabled,
            collection_type: value.collection_type,
            resource_count,
            preview_status,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl CreateLibraryRequest {
    pub fn into_active_model(self) -> media_library::ActiveModel {
        let now = Utc::now();

        media_library::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            name: Set(self.name),
            media_type: Set(self.media_type.to_string()),
            root_path: Set(self.root_path),
            enabled: Set(true),
            previews_enabled: Set(self.previews_enabled),
            source_type: Set(self.source_type),
            webdav_connection_id: Set(self.webdav_connection_id),
            scan_extensions: Set(serialize_scan_extensions(self.scan_extensions)),
            collections_enabled: Set(self.collections_enabled),
            collection_type: Set(self.collection_type),
            created_at: Set(now),
            updated_at: Set(now),
        }
    }
}

pub const SUPPORTED_VIDEO_EXTENSIONS: &[&str] =
    &["mp4", "m4v", "mkv", "webm", "mov", "avi", "ts", "m2ts"];

pub fn normalize_scan_extensions(values: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    for value in values {
        let extension = value.trim().trim_start_matches('.').to_ascii_lowercase();
        if !SUPPORTED_VIDEO_EXTENSIONS.contains(&extension.as_str()) {
            return Err(format!("unsupported video extension: {value}"));
        }
        if !normalized.contains(&extension) {
            normalized.push(extension);
        }
    }
    if normalized.is_empty() {
        return Err("at least one video extension must be selected".to_owned());
    }
    Ok(normalized)
}

pub fn serialize_scan_extensions(values: Option<Vec<String>>) -> Option<String> {
    values.map(|items| items.join(","))
}

pub fn parse_scan_extensions(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .filter(|item| !item.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::normalize_scan_extensions;

    #[test]
    fn normalizes_video_extensions_and_removes_duplicates() {
        assert_eq!(
            normalize_scan_extensions(vec![".MP4".to_owned(), "mkv".to_owned(), "mp4".to_owned()])
                .expect("valid extensions"),
            vec!["mp4", "mkv"]
        );
    }

    #[test]
    fn rejects_empty_or_unsupported_video_extensions() {
        assert!(normalize_scan_extensions(Vec::new()).is_err());
        assert!(normalize_scan_extensions(vec!["webp".to_owned()]).is_err());
    }
}
