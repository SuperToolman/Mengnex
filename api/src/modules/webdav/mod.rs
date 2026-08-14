use crate::core::app::AppState;
use axum::{Router, routing::get};
pub mod dto;
pub mod handlers;
pub mod service;
pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/webdav-connections",
        get(handlers::list).post(handlers::create),
    )
}
