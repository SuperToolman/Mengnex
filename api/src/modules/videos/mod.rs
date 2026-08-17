use axum::{
    Router,
    routing::{delete, get, put},
};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/videos", get(handlers::list_videos))
        .route("/api/videos/catalog", get(handlers::list_video_catalog))
        .route("/api/videos/{id}", get(handlers::get_video))
        .route("/api/videos/{id}/playback", put(handlers::update_playback))
        .route("/api/videos/{id}/poster", get(handlers::get_poster))
        .route(
            "/api/videos/covers/{library_id}",
            delete(handlers::delete_covers),
        )
}
