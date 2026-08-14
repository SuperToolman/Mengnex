use axum::{
    Router,
    routing::{delete, get},
};

use crate::core::app::AppState;

pub mod authors;
pub mod dto;
pub mod folders;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/photos", get(handlers::list_photos))
        .route(
            "/api/photos/folders/{library_id}",
            get(handlers::list_folder_contents),
        )
        .route("/api/photos/{photo_id}", delete(handlers::delete_photo))
}
