use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, Set};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::app_setting,
    modules::preferences::dto::{
        PhotoDisplaySource, PreferencesResponse, UpdatePreferencesRequest,
    },
};

const SETTINGS_ID: &str = "global";

#[utoipa::path(
    get,
    path = "/api/preferences",
    responses((status = 200, description = "Application preferences", body = PreferencesResponse)),
    tag = "preferences"
)]
pub async fn get_preferences(
    State(state): State<AppState>,
) -> Result<Json<PreferencesResponse>, ApiError> {
    let settings = ensure_settings(&state).await?;
    Ok(Json(PreferencesResponse::from(settings)))
}

#[utoipa::path(
    put,
    path = "/api/preferences",
    request_body = UpdatePreferencesRequest,
    responses((status = 200, description = "Updated application preferences", body = PreferencesResponse)),
    tag = "preferences"
)]
pub async fn update_preferences(
    State(state): State<AppState>,
    Json(payload): Json<UpdatePreferencesRequest>,
) -> Result<Json<PreferencesResponse>, ApiError> {
    let settings = ensure_settings(&state).await?;
    let now = Utc::now();
    let mut active_settings: app_setting::ActiveModel = settings.into();
    active_settings.photo_display_source = Set(payload.photo_display_source.to_string());
    active_settings.updated_at = Set(now);
    let settings = active_settings.update(&state.db).await?;

    Ok(Json(PreferencesResponse::from(settings)))
}

async fn ensure_settings(state: &AppState) -> Result<app_setting::Model, ApiError> {
    if let Some(settings) = app_setting::Entity::find_by_id(SETTINGS_ID)
        .one(&state.db)
        .await?
    {
        return Ok(settings);
    }

    let now = Utc::now();

    Ok(app_setting::ActiveModel {
        id: Set(SETTINGS_ID.to_owned()),
        photo_display_source: Set(PhotoDisplaySource::Thumbnail.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await?)
}
