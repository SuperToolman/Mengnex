use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use crate::infra::entities::{media_file, media_item};

#[derive(Debug, Serialize, ToSchema)]
pub struct MediaItemResponse {
    pub id: String,
    pub library_id: String,
    pub media_type: String,
    pub title: String,
    pub sort_title: Option<String>,
    pub original_path: String,
    pub year: Option<i32>,
    pub metadata_json: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MediaFileResponse {
    pub id: String,
    pub item_id: String,
    pub library_id: String,
    pub scan_task_id: Option<String>,
    pub full_path: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: i64,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub modified_at: Option<DateTime<Utc>>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

impl From<media_item::Model> for MediaItemResponse {
    fn from(value: media_item::Model) -> Self {
        Self {
            id: value.id,
            library_id: value.library_id,
            media_type: value.media_type,
            title: value.title,
            sort_title: value.sort_title,
            original_path: value.original_path,
            year: value.year,
            metadata_json: value.metadata_json,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<media_file::Model> for MediaFileResponse {
    fn from(value: media_file::Model) -> Self {
        Self {
            id: value.id,
            item_id: value.item_id,
            library_id: value.library_id,
            scan_task_id: value.scan_task_id,
            full_path: value.full_path,
            file_name: value.file_name,
            extension: value.extension,
            mime_type: value.mime_type,
            file_size: value.file_size,
            modified_at: value.modified_at,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}
