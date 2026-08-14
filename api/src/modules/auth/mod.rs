use axum::{
    Router,
    routing::{get, post},
};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/status", get(handlers::status))
        .route("/api/auth/setup", post(handlers::setup))
        .route("/api/auth/login", post(handlers::login))
        .route("/api/auth/logout", post(handlers::logout))
}

pub fn protected_routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/me", get(handlers::me))
        .route(
            "/api/auth/users",
            get(handlers::list_users).post(handlers::create_user),
        )
        .route("/api/auth/roles", get(handlers::list_role_permissions))
}
