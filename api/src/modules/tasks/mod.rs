use axum::{Router, routing::{get, post}};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/tasks", get(handlers::list_tasks))
        .route("/api/tasks/{id}/pause", post(handlers::pause_task))
        .route("/api/tasks/{id}/resume", post(handlers::resume_task))
        .route("/api/tasks/{id}/cancel", post(handlers::cancel_task))
}
