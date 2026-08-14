use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{
        author, author_resource, manga_chapter, manga_page, manga_series, media_file, tag,
        tag_resource,
    },
    modules::manga::dto::{
        MangaChapterResponse, MangaDetailResponse, MangaPageResponse, MangaReaderResponse,
        MangaSeriesResponse,
    },
};
use axum::{
    Json,
    extract::{Path, State},
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};

fn src(file_id: Option<&String>) -> Option<String> {
    file_id.map(|id| format!("/api/media/files/{id}/content"))
}
async fn series_response(
    db: &DatabaseConnection,
    value: manga_series::Model,
) -> Result<MangaSeriesResponse, ApiError> {
    let author_name = author_resource::Entity::find()
        .filter(author_resource::Column::ResourceType.eq("manga_series"))
        .filter(author_resource::Column::ResourceId.eq(value.id.clone()))
        .one(db)
        .await?
        .map(|resource| resource.author_id);
    let author_name = match author_name {
        Some(author_id) => author::Entity::find_by_id(author_id)
            .one(db)
            .await?
            .map(|value| value.name),
        None => None,
    };
    let tag_ids = tag_resource::Entity::find()
        .filter(tag_resource::Column::ResourceType.eq("manga_series"))
        .filter(tag_resource::Column::ResourceId.eq(value.id.clone()))
        .all(db)
        .await?
        .into_iter()
        .map(|resource| resource.tag_id)
        .collect::<Vec<_>>();
    let tags = if tag_ids.is_empty() {
        Vec::new()
    } else {
        tag::Entity::find()
            .filter(tag::Column::Id.is_in(tag_ids))
            .all(db)
            .await?
            .into_iter()
            .map(|value| value.name)
            .collect()
    };

    Ok(MangaSeriesResponse {
        id: value.id,
        library_id: value.library_id,
        title: value.title,
        layout: value.layout,
        cover_src: src(value.cover_file_id.as_ref()),
        author_name,
        tags,
        chapter_count: value.chapter_count,
        page_count: value.page_count,
    })
}
#[utoipa::path(get,path="/api/manga",responses((status=200,body=[MangaSeriesResponse])),tag="manga")]
pub async fn list_series(
    State(state): State<AppState>,
) -> Result<Json<Vec<MangaSeriesResponse>>, ApiError> {
    Ok(Json({
        let series = manga_series::Entity::find()
            .order_by_desc(manga_series::Column::CreatedAt)
            .all(&state.db)
            .await?;
        let mut response = Vec::with_capacity(series.len());
        for item in series {
            response.push(series_response(&state.db, item).await?);
        }
        response
    }))
}
#[utoipa::path(get,path="/api/manga/{id}",responses((status=200,body=MangaDetailResponse)),tag="manga")]
pub async fn get_series(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<MangaDetailResponse>, ApiError> {
    let series = manga_series::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("manga"))?;
    let chapters = manga_chapter::Entity::find()
        .filter(manga_chapter::Column::SeriesId.eq(series.id.clone()))
        .order_by_asc(manga_chapter::Column::SortOrder)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|c| MangaChapterResponse {
            id: c.id,
            title: c.title,
            cover_src: src(c.cover_file_id.as_ref()),
            page_count: c.page_count,
        })
        .collect();
    Ok(Json(MangaDetailResponse {
        id: series.id,
        library_id: series.library_id,
        title: series.title,
        layout: series.layout,
        cover_src: src(series.cover_file_id.as_ref()),
        chapter_count: series.chapter_count,
        page_count: series.page_count,
        chapters,
    }))
}
#[utoipa::path(get,path="/api/manga/chapters/{id}/reader",responses((status=200,body=MangaReaderResponse)),tag="manga")]
pub async fn get_reader(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<MangaReaderResponse>, ApiError> {
    let chapter = manga_chapter::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("manga chapter"))?;
    let pages = manga_page::Entity::find()
        .filter(manga_page::Column::ChapterId.eq(chapter.id.clone()))
        .order_by_asc(manga_page::Column::SortOrder)
        .all(&state.db)
        .await?;
    let file_ids = pages.iter().map(|p| p.file_id.clone()).collect::<Vec<_>>();
    let files = media_file::Entity::find()
        .filter(media_file::Column::Id.is_in(file_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|f| (f.id.clone(), f.file_name))
        .collect::<std::collections::HashMap<_, _>>();
    Ok(Json(MangaReaderResponse {
        chapter_id: chapter.id.clone(),
        series_id: chapter.series_id,
        title: chapter.title,
        pages: pages
            .into_iter()
            .filter_map(|p| {
                files.get(&p.file_id).map(|name| MangaPageResponse {
                    id: p.file_id.clone(),
                    src: format!("/api/media/files/{}/content", p.file_id),
                    file_name: name.clone(),
                    page_number: p.sort_order + 1,
                })
            })
            .collect(),
    }))
}
