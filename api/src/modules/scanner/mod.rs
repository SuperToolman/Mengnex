use axum::{Router, routing::get};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/scans",
        get(handlers::list_scan_tasks).post(handlers::start_scan),
    )
}
