use chrono::{DateTime, Utc};
use sea_orm::Set;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infra::entities::media_library;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Photo,
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
    pub thumbnails_enabled: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateLibraryThumbnailConfigRequest {
    pub thumbnails_enabled: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateLibraryRequest {
    pub name: Option<String>,
    pub root_path: Option<String>,
    pub enabled: Option<bool>,
    pub thumbnails_enabled: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema, Default, Clone)]
pub struct LibraryThumbnailStatusResponse {
    pub total_assets: i64,
    pub thumb_ready_assets: i64,
    pub preview_ready_assets: i64,
    pub pending_assets: i64,
    pub thumb_total_bytes: i64,
    pub preview_total_bytes: i64,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub last_generated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LibraryThumbnailJobResponse {
    pub library_id: String,
    pub processed_assets: i64,
    pub generated_thumbnails: i64,
    pub generated_previews: i64,
    pub skipped_assets: i64,
    pub deleted_thumbnails: i64,
    pub deleted_previews: i64,
    pub reclaimed_bytes: i64,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailGenerationTaskStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

impl std::fmt::Display for ThumbnailGenerationTaskStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        };

        formatter.write_str(value)
    }
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ThumbnailGenerationTaskResponse {
    pub task_id: String,
    pub library_id: String,
    pub status: String,
    pub total_assets: i64,
    pub processed_assets: i64,
    pub generated_thumbnails: i64,
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
    pub thumbnails_enabled: bool,
    pub thumbnail_status: LibraryThumbnailStatusResponse,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteLibraryResponse {
    pub id: String,
}

impl ThumbnailGenerationTaskResponse {
    pub fn new(task_id: String, library_id: String, created_at: DateTime<Utc>) -> Self {
        Self {
            task_id,
            library_id,
            status: ThumbnailGenerationTaskStatus::Queued.to_string(),
            total_assets: 0,
            processed_assets: 0,
            generated_thumbnails: 0,
            generated_previews: 0,
            skipped_assets: 0,
            progress_percent: 0,
            error_message: None,
            created_at,
            updated_at: created_at,
            finished_at: None,
        }
    }
}

impl LibraryResponse {
    pub fn from_model(
        value: media_library::Model,
        thumbnail_status: LibraryThumbnailStatusResponse,
    ) -> Self {
        Self {
            id: value.id,
            name: value.name,
            media_type: value.media_type,
            root_path: value.root_path,
            enabled: value.enabled,
            thumbnails_enabled: value.thumbnails_enabled,
            thumbnail_status,
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
            thumbnails_enabled: Set(self.thumbnails_enabled),
            created_at: Set(now),
            updated_at: Set(now),
        }
    }
}
