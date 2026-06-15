use axum::{
    Json,
    extract::{Path, State},
};
use sea_orm::{ActiveModelTrait, EntityTrait, QueryOrder};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::media_library,
    modules::libraries::dto::{CreateLibraryRequest, LibraryResponse},
};

#[utoipa::path(
    get,
    path = "/api/libraries",
    responses((status = 200, description = "List media libraries", body = [LibraryResponse])),
    tag = "libraries"
)]
pub async fn list_libraries(
    State(state): State<AppState>,
) -> Result<Json<Vec<LibraryResponse>>, ApiError> {
    let libraries = media_library::Entity::find()
        .order_by_desc(media_library::Column::CreatedAt)
        .all(&state.db)
        .await?
        .into_iter()
        .map(LibraryResponse::from)
        .collect();

    Ok(Json(libraries))
}

#[utoipa::path(
    post,
    path = "/api/libraries",
    request_body = CreateLibraryRequest,
    responses((status = 200, description = "Created media library", body = LibraryResponse)),
    tag = "libraries"
)]
pub async fn create_library(
    State(state): State<AppState>,
    Json(payload): Json<CreateLibraryRequest>,
) -> Result<Json<LibraryResponse>, ApiError> {
    let library = payload.into_active_model().insert(&state.db).await?;

    Ok(Json(LibraryResponse::from(library)))
}

#[utoipa::path(
    get,
    path = "/api/libraries/{id}",
    params(("id" = String, Path, description = "Library id")),
    responses(
        (status = 200, description = "Media library detail", body = LibraryResponse),
        (status = 404, description = "Media library not found")
    ),
    tag = "libraries"
)]
pub async fn get_library(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LibraryResponse>, ApiError> {
    let library = media_library::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;

    Ok(Json(LibraryResponse::from(library)))
}
