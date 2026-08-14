use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TagResponse {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub avatar_url: Option<String>,
    pub background_url: Option<String>,
    pub resource_count: i64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateTagRequest {
    pub name: String,
    pub avatar_url: Option<String>,
    pub background_url: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTagRequest {
    pub name: String,
    pub avatar_url: Option<String>,
    pub background_url: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReplaceResourceTagsRequest {
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TagResourceResponse {
    pub id: String,
    pub resource_type: String,
    pub title: String,
    pub image_src: Option<String>,
}
