use axum::{Router, routing::get};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/novels", get(handlers::list_books))
        .route("/api/novels/{id}", get(handlers::get_book))
        .route("/api/novels/{id}/cover", get(handlers::get_cover))
        .route(
            "/api/novels/{id}/chapters/{chapter_id}",
            get(handlers::get_chapter),
        )
        .route(
            "/api/novels/{id}/reading-state",
            get(handlers::get_reading_state).put(handlers::update_reading_state),
        )
}
