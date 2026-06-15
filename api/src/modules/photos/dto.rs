use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use crate::infra::entities::photo_asset;

#[derive(Debug, Serialize, ToSchema)]
pub struct PhotoAssetResponse {
    pub id: String,
    pub item_id: String,
    pub file_id: String,
    pub library_id: String,
    pub title: String,
    pub file_name: String,
    pub src: String,
    pub source_path: String,
    pub mime_type: Option<String>,
    pub file_size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub taken_at: Option<DateTime<Utc>>,
    #[schema(value_type = String, format = DateTime)]
    pub batch_time: DateTime<Utc>,
}

impl From<photo_asset::Model> for PhotoAssetResponse {
    fn from(value: photo_asset::Model) -> Self {
        Self {
            id: value.id,
            item_id: value.item_id,
            file_id: value.file_id.clone(),
            library_id: value.library_id,
            title: value.title,
            file_name: value.file_name,
            src: format!("/api/media/files/{}/content", value.file_id),
            source_path: value.source_path,
            mime_type: value.mime_type,
            file_size: value.file_size,
            width: value.width,
            height: value.height,
            taken_at: value.taken_at,
            batch_time: value.batch_time,
        }
    }
}
