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
            "/api/libraries/{id}/previews/settings",
            axum::routing::put(handlers::update_library_preview_config),
        )
        .route(
            "/api/libraries/{id}/previews/generate",
            axum::routing::post(handlers::generate_library_preview_assets),
        )
        .route(
            "/api/libraries/{id}/previews/tasks/{task_id}",
            get(handlers::get_library_preview_generation_task),
        )
        .route(
            "/api/libraries/{id}/previews",
            axum::routing::delete(handlers::delete_library_preview_assets),
        )
}
