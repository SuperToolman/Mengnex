use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::entities::app_setting;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PhotoDisplaySource {
    Thumbnail,
    Original,
}

impl std::fmt::Display for PhotoDisplaySource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Thumbnail => "thumbnail",
            Self::Original => "original",
        };

        formatter.write_str(value)
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdatePreferencesRequest {
    pub photo_display_source: PhotoDisplaySource,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PreferencesResponse {
    pub photo_display_source: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

impl From<app_setting::Model> for PreferencesResponse {
    fn from(value: app_setting::Model) -> Self {
        Self {
            photo_display_source: value.photo_display_source,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}
