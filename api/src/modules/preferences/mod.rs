use axum::{Router, routing::get};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/preferences",
        get(handlers::get_preferences).put(handlers::update_preferences),
    )
}
