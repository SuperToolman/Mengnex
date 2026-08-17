use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    ScanLibrary,
    GenerateCache,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Paused,
    Completed,
    Canceled,
    Failed,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Canceled => "canceled",
            Self::Failed => "failed",
        };

        formatter.write_str(value)
    }
}

impl std::fmt::Display for TaskKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::ScanLibrary => "scan_library",
            Self::GenerateCache => "generate_cache",
        };

        formatter.write_str(value)
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TaskResponse {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub library_id: Option<String>,
    pub library_name: Option<String>,
    pub status: String,
    pub progress_percent: i32,
    pub scan_processed_items: Option<i64>,
    pub scan_total_items: Option<i64>,
    pub preview_processed_items: Option<i64>,
    pub preview_total_items: Option<i64>,
    pub detail: Option<String>,
    pub error_message: Option<String>,
    pub error_details: Vec<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteTasksResponse {
    pub deleted_count: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TaskSummaryResponse {
    pub total: u64,
    pub active: u64,
    pub history: u64,
    pub failed: u64,
}
