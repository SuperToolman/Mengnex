use axum::{Router, routing::{delete, get}};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/photos", get(handlers::list_photos))
        .route("/api/photos/{photo_id}", delete(handlers::delete_photo))
}
