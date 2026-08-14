use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct RecycleBinItemResponse {
    pub id: String,
    pub media_type: String,
    pub title: String,
    pub original_path: String,
    pub file_id: Option<String>,
    pub image_src: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub deleted_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RestoreRecycleBinItemResponse {
    pub id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PurgeRecycleBinItemResponse {
    pub id: String,
}
