use axum::{Router, routing::get};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/libraries",
            get(handlers::list_libraries).post(handlers::create_library),
        )
        .route(
            "/api/libraries/{id}",
            get(handlers::get_library)
                .put(handlers::update_library)
                .delete(handlers::delete_library),
        )
        .route(
            "/api/libraries/{id}/thumbnails/settings",
            axum::routing::put(handlers::update_library_thumbnail_config),
        )
        .route(
            "/api/libraries/{id}/thumbnails/generate",
            axum::routing::post(handlers::generate_library_thumbnail_assets),
        )
        .route(
            "/api/libraries/{id}/thumbnails/tasks/{task_id}",
            get(handlers::get_library_thumbnail_generation_task),
        )
        .route(
            "/api/libraries/{id}/thumbnails",
            axum::routing::delete(handlers::delete_library_thumbnail_assets),
        )
}
