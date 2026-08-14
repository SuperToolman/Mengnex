pub mod dto;
pub mod handlers;
pub mod service;

use axum::{Router, routing::get};
pub fn routes() -> Router<crate::core::app::AppState> {
    Router::new()
        .route("/api/manga", get(handlers::list_series))
        .route("/api/manga/{id}", get(handlers::get_series))
        .route("/api/manga/chapters/{id}/reader", get(handlers::get_reader))
}
