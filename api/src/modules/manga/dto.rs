use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct MangaSeriesResponse {
    pub id: String,
    pub library_id: String,
    pub title: String,
    pub layout: String,
    pub cover_src: Option<String>,
    pub author_name: Option<String>,
    pub tags: Vec<String>,
    pub chapter_count: i64,
    pub page_count: i64,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct MangaChapterResponse {
    pub id: String,
    pub title: String,
    pub cover_src: Option<String>,
    pub page_count: i64,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct MangaDetailResponse {
    pub id: String,
    pub library_id: String,
    pub title: String,
    pub layout: String,
    pub cover_src: Option<String>,
    pub chapter_count: i64,
    pub page_count: i64,
    pub chapters: Vec<MangaChapterResponse>,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct MangaPageResponse {
    pub id: String,
    pub src: String,
    pub file_name: String,
    pub page_number: i64,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct MangaReaderResponse {
    pub chapter_id: String,
    pub series_id: String,
    pub title: String,
    pub pages: Vec<MangaPageResponse>,
}
