use axum::{Json, extract::State};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, EntityTrait, Set};

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::app_setting,
    modules::preferences::dto::{PreferencesResponse, UpdatePreferencesRequest},
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
    let settings = app_setting::Entity::find_by_id(SETTINGS_ID)
        .one(&state.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("Preferences not found".into()))?;

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
    let settings = app_setting::Entity::find_by_id(SETTINGS_ID)
        .one(&state.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("Preferences not found".into()))?;

    let mut active_settings: app_setting::ActiveModel = settings.into();

    if let Some(value) = payload.thumb_max_dimension {
        if !(64..=2048).contains(&value) {
            return Err(ApiError::BadRequest("thumb_max_dimension must be between 64 and 2048".into()));
        }
        active_settings.thumb_max_dimension = Set(value);
    }

    if let Some(value) = payload.preview_max_dimension {
        if !(128..=4096).contains(&value) {
            return Err(ApiError::BadRequest("preview_max_dimension must be between 128 and 4096".into()));
        }
        active_settings.preview_max_dimension = Set(value);
    }

    if let Some(value) = payload.thumb_quality {
        if !(1..=100).contains(&value) {
            return Err(ApiError::BadRequest("thumb_quality must be between 1 and 100".into()));
        }
        active_settings.thumb_quality = Set(value);
    }

    if let Some(value) = payload.preview_quality {
        if !(1..=100).contains(&value) {
            return Err(ApiError::BadRequest("preview_quality must be between 1 and 100".into()));
        }
        active_settings.preview_quality = Set(value);
    }

    active_settings.updated_at = Set(Utc::now());
    let saved = active_settings.update(&state.db).await?;

    Ok(Json(PreferencesResponse::from(saved)))
}
