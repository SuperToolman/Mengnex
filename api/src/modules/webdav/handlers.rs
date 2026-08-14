use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::webdav_connection,
    modules::webdav::{
        dto::{CreateWebdavConnectionRequest, WebdavConnectionResponse},
        service::WebDavClient,
    },
};
use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, QueryOrder, Set};
use uuid::Uuid;

#[utoipa::path(get, path = "/api/webdav-connections", responses((status = 200, body = [WebdavConnectionResponse])), tag = "webdav")]
pub async fn list(
    State(state): State<AppState>,
) -> Result<Json<Vec<WebdavConnectionResponse>>, ApiError> {
    Ok(Json(
        webdav_connection::Entity::find()
            .order_by_desc(webdav_connection::Column::CreatedAt)
            .all(&state.db)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}
#[utoipa::path(post, path = "/api/webdav-connections", request_body = CreateWebdavConnectionRequest, responses((status = 200, body = WebdavConnectionResponse)), tag = "webdav")]
pub async fn create(
    State(state): State<AppState>,
    Json(payload): Json<CreateWebdavConnectionRequest>,
) -> Result<Json<WebdavConnectionResponse>, ApiError> {
    if payload.name.trim().is_empty() || payload.url.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "WebDAV name and URL are required".to_owned(),
        ));
    }
    WebDavClient::new(&payload.url, &payload.username, &payload.password)?
        .validate_connection()
        .await?;
    let now = Utc::now();
    let saved = webdav_connection::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        name: Set(payload.name.trim().to_owned()),
        url: Set(payload.url.trim_end_matches('/').to_owned()),
        username: Set(payload.username),
        password: Set(payload.password),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(saved.into()))
}
