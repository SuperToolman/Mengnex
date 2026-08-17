use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::infra::entities::{novel_book, novel_chapter, novel_reading_state};

#[derive(Debug, Deserialize, IntoParams)]
pub struct ListNovelsQuery {
    pub library_id: Option<String>,
    pub search: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NovelBookResponse {
    pub id: String,
    pub library_id: String,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub format: String,
    pub cover_src: Option<String>,
    pub chapter_count: i64,
    pub parse_status: String,
    pub parse_error: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub parsed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NovelChapterResponse {
    pub id: String,
    pub sequence: i64,
    pub title: String,
    pub word_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NovelDetailResponse {
    #[serde(flatten)]
    pub book: NovelBookResponse,
    pub chapters: Vec<NovelChapterResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NovelChapterContentResponse {
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub sequence: i64,
    pub content: String,
    pub word_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NovelReadingStateResponse {
    pub chapter_id: Option<String>,
    pub progress_percent: i32,
    pub locator: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateNovelReadingStateRequest {
    pub chapter_id: Option<String>,
    pub progress_percent: i32,
    pub locator: Option<String>,
}

impl From<novel_chapter::Model> for NovelChapterResponse {
    fn from(value: novel_chapter::Model) -> Self {
        Self {
            id: value.id,
            sequence: value.sequence,
            title: value.title,
            word_count: value.word_count,
        }
    }
}

impl From<novel_reading_state::Model> for NovelReadingStateResponse {
    fn from(value: novel_reading_state::Model) -> Self {
        Self {
            chapter_id: value.chapter_id,
            progress_percent: value.progress_percent,
            locator: value.locator,
            updated_at: value.updated_at,
        }
    }
}

pub fn book_response(value: novel_book::Model) -> NovelBookResponse {
    let version = value
        .parsed_at
        .map(|time| time.timestamp_millis())
        .unwrap_or_default();
    NovelBookResponse {
        id: value.id.clone(),
        library_id: value.library_id,
        title: value.title,
        author: value.author,
        language: value.language,
        description: value.description,
        format: value.format,
        cover_src: value
            .cover_rel_path
            .map(|_| format!("/api/novels/{}/cover?v={version}", value.id)),
        chapter_count: value.chapter_count,
        parse_status: value.parse_status,
        parse_error: value.parse_error,
        parsed_at: value.parsed_at,
    }
}
