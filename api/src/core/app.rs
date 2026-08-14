use axum::http::{HeaderValue, Method, header};
use axum::{Json, Router, middleware, response::Html, routing::get};
use sea_orm::DatabaseConnection;
use tower_http::cors::{AllowOrigin, CorsLayer};
use utoipa::OpenApi;

use crate::{
    core::{health, openapi::ApiDoc},
    modules::{
        auth, authors, libraries, manga, media, photos, preferences, recycle_bin, scanner, tags,
        tasks, videos, webdav,
    },
};

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
}

pub fn router(db: DatabaseConnection) -> Router {
    let state = AppState { db };

    let protected = Router::new()
        .merge(auth::protected_routes())
        .merge(libraries::routes())
        .merge(media::routes())
        .merge(manga::routes())
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
