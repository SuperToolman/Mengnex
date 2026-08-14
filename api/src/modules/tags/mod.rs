pub mod dto;
pub mod handlers;
pub mod service;

use axum::{
    Router,
    routing::{get, put},
};

use crate::core::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/tags",
            get(handlers::list_tags)
                .post(handlers::create_tag)
                .delete(handlers::clear_tags),
        )
        .route(
            "/api/tags/{id}",
            put(handlers::update_tag).delete(handlers::delete_tag),
        )
        .route(
            "/api/tags/resources/{resource_type}/{resource_id}",
            get(handlers::list_resource_tags).put(handlers::replace_resource_tags),
        )
        .route(
            "/api/tags/{id}/avatar",
            get(handlers::get_avatar).put(handlers::upload_avatar),
        )
        .route(
            "/api/tags/{id}/resources",
            get(handlers::list_tag_resources),
        )
}
