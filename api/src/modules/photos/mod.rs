use axum::{Router, routing::get};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/photos", get(handlers::list_photos))
}
