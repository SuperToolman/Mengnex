use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{Json, Router, response::Html, routing::get};
use sea_orm::DatabaseConnection;
use tower_http::cors::CorsLayer;
use utoipa::OpenApi;

use crate::{
    core::{health, openapi::ApiDoc},
    modules::libraries::dto::ThumbnailGenerationTaskResponse,
    modules::{libraries, media, photos, preferences, scanner, tasks},
};

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub thumbnail_generation_tasks: Arc<Mutex<HashMap<String, ThumbnailGenerationTaskResponse>>>,
}

pub fn router(db: DatabaseConnection) -> Router {
    let state = AppState {
        db,
        thumbnail_generation_tasks: Arc::new(Mutex::new(HashMap::new())),
    };

    Router::new()
        .route("/health", get(health::health))
        .route("/docs", get(swagger_ui))
        .route("/openapi.json", get(openapi_json))
        .merge(libraries::routes())
        .merge(media::routes())
        .merge(photos::routes())
        .merge(preferences::routes())
        .merge(scanner::routes())
        .merge(tasks::routes())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

async fn swagger_ui() -> Html<&'static str> {
    Html(include_str!("../swagger.html"))
}
