pub mod dto;
pub mod handlers;
pub mod service;
use axum::{
    Router,
    routing::{delete, get, put},
};
pub fn routes() -> Router<crate::core::app::AppState> {
    Router::new()
        .route("/api/authors", get(handlers::list_authors))
        .route("/api/authors/{id}", get(handlers::get_author))
        .route(
            "/api/authors/{id}/avatar",
            get(handlers::get_avatar).put(handlers::upload_avatar),
        )
        .route(
            "/api/authors/{id}/avatars/{avatar_id}/select",
            put(handlers::select_avatar),
        )
        .route(
            "/api/authors/{id}/avatars/{avatar_id}",
            delete(handlers::delete_avatar),
        )
}
