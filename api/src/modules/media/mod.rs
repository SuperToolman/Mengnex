use axum::{Router, routing::get};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/media/items", get(handlers::list_media_items))
        .route("/api/media/files", get(handlers::list_media_files))
        .route(
            "/api/media/files/{id}/content",
            get(handlers::get_media_file_content),
        )
}
