use axum::{Router, routing::get};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/libraries",
            get(handlers::list_libraries).post(handlers::create_library),
        )
        .route("/api/libraries/{id}", get(handlers::get_library))
}
