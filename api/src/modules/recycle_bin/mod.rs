use axum::{
    Router,
    routing::{delete, get, post},
};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/recycle-bin", get(handlers::list_recycle_bin))
        .route(
            "/api/recycle-bin/{item_id}/restore",
            post(handlers::restore_item),
        )
        .route("/api/recycle-bin/{item_id}", delete(handlers::purge_item))
}
