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
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LibraryResponse {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub root_path: String,
    pub enabled: bool,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

impl From<media_library::Model> for LibraryResponse {
    fn from(value: media_library::Model) -> Self {
        Self {
            id: value.id,
            name: value.name,
            media_type: value.media_type,
            root_path: value.root_path,
            enabled: value.enabled,
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
            created_at: Set(now),
            updated_at: Set(now),
        }
    }
}
