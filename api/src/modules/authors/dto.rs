use crate::modules::{manga::dto::MangaSeriesResponse, photos::dto::PhotoAssetResponse};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
#[derive(Debug, Serialize, ToSchema)]
pub struct AuthorResponse {
    pub id: String,
    pub name: String,
    pub avatar_src: Option<String>,
    pub resource_count: i64,
    pub resource_types: Vec<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct AuthorAvatarResponse {
    pub id: String,
    pub src: String,
    pub is_current: bool,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct AuthorDetailResponse {
    pub id: String,
    pub name: String,
    pub avatar_src: Option<String>,
    pub avatar_history: Vec<AuthorAvatarResponse>,
    pub resource_count: i64,
    pub resource_types: Vec<String>,
    pub manga: Vec<MangaSeriesResponse>,
    pub photos: Vec<PhotoAssetResponse>,
}
