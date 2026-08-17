use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::header,
    response::{IntoResponse, Response},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TryIntoModel,
};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_item, media_library, novel_book, novel_chapter, novel_reading_state},
    modules::{
        auth::service::CurrentUser,
        novels::{
            dto::{
                ListNovelsQuery, NovelBookResponse, NovelChapterContentResponse,
                NovelChapterResponse, NovelDetailResponse, NovelReadingStateResponse,
                UpdateNovelReadingStateRequest, book_response,
            },
            service::{cover_path, read_chapter_content},
        },
    },
};

#[utoipa::path(get, path = "/api/novels", params(ListNovelsQuery), responses((status = 200, body = [NovelBookResponse])), tag = "novels")]
pub async fn list_books(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<ListNovelsQuery>,
) -> Result<Json<Vec<NovelBookResponse>>, ApiError> {
    let mut select = novel_book::Entity::find().order_by_desc(novel_book::Column::UpdatedAt);
    if let Some(library_ids) = current.library_ids {
        select = select.filter(novel_book::Column::LibraryId.is_in(library_ids));
    }
    if let Some(library_id) = query.library_id {
        select = select.filter(novel_book::Column::LibraryId.eq(library_id));
    }
    if let Some(search) = query.search.filter(|value| !value.trim().is_empty()) {
        select = select.filter(novel_book::Column::Title.contains(search.trim()));
    }
    let books = select
        .limit(query.limit.unwrap_or(60).clamp(1, 200))
        .offset(query.offset.unwrap_or_default())
        .all(&state.db)
        .await?;
    let active_item_ids = media_item::Entity::find()
        .filter(media_item::Column::DeletedAt.is_null())
        .filter(media_item::Column::SourceMissingAt.is_null())
        .all(&state.db)
        .await?
        .into_iter()
        .map(|item| item.id)
        .collect::<std::collections::HashSet<_>>();
    Ok(Json(
        books
            .into_iter()
            .filter(|book| active_item_ids.contains(&book.item_id))
            .map(book_response)
            .collect(),
    ))
}

#[utoipa::path(get, path = "/api/novels/{id}", params(("id" = String, Path)), responses((status = 200, body = NovelDetailResponse), (status = 404)), tag = "novels")]
pub async fn get_book(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<NovelDetailResponse>, ApiError> {
    let book = find_book(&state, &current, &id).await?;
    let chapters = novel_chapter::Entity::find()
        .filter(novel_chapter::Column::BookId.eq(&book.id))
        .order_by_asc(novel_chapter::Column::Sequence)
        .all(&state.db)
        .await?
        .into_iter()
        .map(NovelChapterResponse::from)
        .collect();
    Ok(Json(NovelDetailResponse {
        book: book_response(book),
        chapters,
    }))
}

#[utoipa::path(get, path = "/api/novels/{id}/cover", params(("id" = String, Path)), responses((status = 200, description = "Novel cover"), (status = 404)), tag = "novels")]
pub async fn get_cover(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let book = find_book(&state, &current, &id).await?;
    let relative = book
        .cover_rel_path
        .ok_or(ApiError::NotFound("novel cover"))?;
    let path = cover_path(&relative).ok_or(ApiError::NotFound("novel cover"))?;
    let bytes = tokio::fs::read(&path).await?;
    let content_type = if relative.ends_with(".png") {
        "image/png"
    } else if relative.ends_with(".webp") {
        "image/webp"
    } else if relative.ends_with(".gif") {
        "image/gif"
    } else {
        "image/jpeg"
    };
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "private, max-age=604800, immutable"),
        ],
        bytes,
    )
        .into_response())
}

#[utoipa::path(get, path = "/api/novels/{id}/chapters/{chapter_id}", params(("id" = String, Path), ("chapter_id" = String, Path)), responses((status = 200, body = NovelChapterContentResponse), (status = 404)), tag = "novels")]
pub async fn get_chapter(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path((id, chapter_id)): Path<(String, String)>,
) -> Result<Json<NovelChapterContentResponse>, ApiError> {
    let book = find_book(&state, &current, &id).await?;
    let chapter = novel_chapter::Entity::find_by_id(chapter_id)
        .one(&state.db)
        .await?
        .filter(|chapter| chapter.book_id == book.id)
        .ok_or(ApiError::NotFound("novel chapter"))?;
    let library = media_library::Entity::find_by_id(&book.library_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;
    let content = read_chapter_content(&state.db, &library, &book, &chapter).await?;
    Ok(Json(NovelChapterContentResponse {
        id: chapter.id,
        book_id: book.id,
        title: chapter.title,
        sequence: chapter.sequence,
        content,
        word_count: chapter.word_count,
    }))
}

#[utoipa::path(get, path = "/api/novels/{id}/reading-state", params(("id" = String, Path)), responses((status = 200, body = Option<NovelReadingStateResponse>)), tag = "novels")]
pub async fn get_reading_state(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Option<NovelReadingStateResponse>>, ApiError> {
    let book = find_book(&state, &current, &id).await?;
    Ok(Json(
        novel_reading_state::Entity::find()
            .filter(novel_reading_state::Column::UserId.eq(&current.id))
            .filter(novel_reading_state::Column::BookId.eq(&book.id))
            .one(&state.db)
            .await?
            .map(NovelReadingStateResponse::from),
    ))
}

#[utoipa::path(put, path = "/api/novels/{id}/reading-state", params(("id" = String, Path)), request_body = UpdateNovelReadingStateRequest, responses((status = 200, body = NovelReadingStateResponse), (status = 404)), tag = "novels")]
pub async fn update_reading_state(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateNovelReadingStateRequest>,
) -> Result<Json<NovelReadingStateResponse>, ApiError> {
    let book = find_book(&state, &current, &id).await?;
    if let Some(chapter_id) = payload.chapter_id.as_deref() {
        let exists = novel_chapter::Entity::find_by_id(chapter_id)
            .one(&state.db)
            .await?
            .is_some_and(|chapter| chapter.book_id == book.id);
        if !exists {
            return Err(ApiError::BadRequest(
                "chapter does not belong to novel".to_owned(),
            ));
        }
    }
    let now = Utc::now();
    let mut state_value = novel_reading_state::Entity::find()
        .filter(novel_reading_state::Column::UserId.eq(&current.id))
        .filter(novel_reading_state::Column::BookId.eq(&book.id))
        .one(&state.db)
        .await?
        .map(Into::into)
        .unwrap_or(novel_reading_state::ActiveModel {
            user_id: Set(current.id),
            book_id: Set(book.id),
            ..Default::default()
        });
    state_value.chapter_id = Set(payload.chapter_id);
    state_value.progress_percent = Set(payload.progress_percent.clamp(0, 100));
    state_value.locator = Set(payload
        .locator
        .map(|value| value.chars().take(128).collect()));
    state_value.updated_at = Set(now);
    let result = state_value.save(&state.db).await?;
    Ok(Json(NovelReadingStateResponse::from(
        result
            .try_into_model()
            .map_err(|_| ApiError::BadRequest("unable to save reading state".to_owned()))?,
    )))
}

async fn find_book(
    state: &AppState,
    current: &CurrentUser,
    id: &str,
) -> Result<novel_book::Model, ApiError> {
    let book = novel_book::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("novel"))?;
    if !current.can_access_library(&book.library_id) {
        return Err(ApiError::NotFound("novel"));
    }
    Ok(book)
}
