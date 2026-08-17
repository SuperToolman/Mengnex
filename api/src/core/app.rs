use std::{collections::HashMap, sync::Arc, time::Instant};

use axum::http::{HeaderValue, Method, header};
use axum::{Json, Router, middleware, response::Html, routing::get};
use sea_orm::DatabaseConnection;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use utoipa::OpenApi;

use crate::{
    core::{health, openapi::ApiDoc},
    modules::{
        auth, authors, libraries, manga, media, music, novels, photos, preferences, recycle_bin,
        scanner, tags, tasks, videos, webdav,
    },
};

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub login_attempts: Arc<tokio::sync::Mutex<HashMap<String, Vec<Instant>>>>,
    pub setup_lock: Arc<tokio::sync::Mutex<()>>,
    pub secure_cookies: bool,
}

pub fn router(db: DatabaseConnection) -> Router {
    let secure_cookies = std::env::var("COOKIE_SECURE")
        .is_ok_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE"));
    let state = AppState {
        db,
        login_attempts: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        setup_lock: Arc::new(tokio::sync::Mutex::new(())),
        secure_cookies,
    };

    let protected = Router::new()
        .merge(auth::protected_routes())
        .merge(libraries::routes())
        .merge(media::routes())
        .merge(music::routes())
        .merge(manga::routes())
        .merge(novels::routes())
        .merge(authors::routes())
        .merge(photos::routes())
        .merge(preferences::routes())
        .merge(recycle_bin::routes())
        .merge(scanner::routes())
        .merge(tags::routes())
        .merge(tasks::routes())
        .merge(webdav::routes())
        .merge(videos::routes())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::service::require_auth,
        ));

    Router::new()
        .route("/health", get(health::health))
        .route("/docs", get(swagger_ui))
        .route("/openapi.json", get(openapi_json))
        .merge(auth::public_routes())
        .merge(protected)
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(TraceLayer::new_for_http())
        .layer(SetRequestIdLayer::new(
            header::HeaderName::from_static("x-request-id"),
            MakeRequestUuid,
        ))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list([
                    HeaderValue::from_static("http://localhost:3000"),
                    HeaderValue::from_static("http://127.0.0.1:3000"),
                ]))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([header::CONTENT_TYPE])
                .allow_credentials(true),
        )
        .with_state(state)
}

async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

async fn swagger_ui() -> Html<&'static str> {
    Html(include_str!("../swagger.html"))
}
