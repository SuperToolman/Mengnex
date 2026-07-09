use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::entities::app_setting;

#[derive(Debug, Serialize, ToSchema)]
pub struct PreferencesResponse {
    pub thumb_max_dimension: i32,
    pub preview_max_dimension: i32,
    pub thumb_quality: i32,
    pub preview_quality: i32,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdatePreferencesRequest {
    pub thumb_max_dimension: Option<i32>,
    pub preview_max_dimension: Option<i32>,
    pub thumb_quality: Option<i32>,
    pub preview_quality: Option<i32>,
}

impl From<app_setting::Model> for PreferencesResponse {
    fn from(value: app_setting::Model) -> Self {
        Self {
            thumb_max_dimension: value.thumb_max_dimension,
            preview_max_dimension: value.preview_max_dimension,
            thumb_quality: value.thumb_quality,
            preview_quality: value.preview_quality,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}
