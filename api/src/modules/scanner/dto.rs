use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::entities::scan_task;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScanTaskStatus {
    Running,
    Paused,
    Completed,
    Canceled,
    Failed,
}

impl std::fmt::Display for ScanTaskStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Canceled => "canceled",
            Self::Failed => "failed",
        };

        formatter.write_str(value)
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateScanTaskRequest {
    pub library_id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ScanTaskResponse {
    pub id: String,
    pub library_id: String,
    pub status: String,
    pub discovered_files: i64,
    pub processed_files: i64,
    pub inserted_items: i64,
    pub updated_files: i64,
    pub removed_files: i64,
    pub error_message: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub started_at: DateTime<Utc>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub finished_at: Option<DateTime<Utc>>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

impl From<scan_task::Model> for ScanTaskResponse {
    fn from(value: scan_task::Model) -> Self {
        Self {
            id: value.id,
            library_id: value.library_id,
            status: value.status,
            discovered_files: value.discovered_files,
            processed_files: value.processed_files,
            inserted_items: value.inserted_items,
            updated_files: value.updated_files,
            removed_files: value.removed_files,
            error_message: value.error_message,
            started_at: value.started_at,
            finished_at: value.finished_at,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}
