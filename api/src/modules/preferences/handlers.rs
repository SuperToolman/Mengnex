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
        .ok_or_else(|| ApiError::NotFound("Preferences not found"))?;

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
        .ok_or_else(|| ApiError::NotFound("Preferences not found"))?;

    let mut active_settings: app_setting::ActiveModel = settings.into();

    if let Some(value) = payload.preview_max_dimension {
        if !(128..=4096).contains(&value) {
            return Err(ApiError::BadRequest(
                "preview_max_dimension must be between 128 and 4096".into(),
            ));
        }
        active_settings.preview_max_dimension = Set(value);
    }

    if let Some(value) = payload.preview_quality {
        if !(1..=100).contains(&value) {
            return Err(ApiError::BadRequest(
                "preview_quality must be between 1 and 100".into(),
            ));
        }
        active_settings.preview_quality = Set(value);
    }

    if let Some(value) = payload.media_cache_max_bytes {
        const MIN_CACHE_BYTES: i64 = 128 * 1024 * 1024;
        const MAX_CACHE_BYTES: i64 = 1024 * 1024 * 1024 * 1024;
        if !(MIN_CACHE_BYTES..=MAX_CACHE_BYTES).contains(&value) {
            return Err(ApiError::BadRequest(format!(
                "media_cache_max_bytes must be between {MIN_CACHE_BYTES} and {MAX_CACHE_BYTES}"
            )));
        }
        active_settings.media_cache_max_bytes = Set(value);
    }

    if let Some(value) = payload.media_cache_directory {
        let directory = value.trim();
        if directory.contains('\0') {
            return Err(ApiError::BadRequest(
                "media_cache_directory contains an invalid character".into(),
            ));
        }
        active_settings.media_cache_directory =
            Set((!directory.is_empty()).then(|| directory.to_owned()));
    }

    if let Some(value) = payload.video_probe_enabled {
        active_settings.video_probe_enabled = Set(value);
    }

    if let Some(value) = payload.video_probe_command {
        let command = value.trim();
        if command.is_empty() || command.contains('\0') {
            return Err(ApiError::BadRequest(
                "video_probe_command must be a non-empty executable name or path".into(),
            ));
        }
        active_settings.video_probe_command = Set(command.to_owned());
    }

    if let Some(value) = payload.video_probe_timeout_seconds {
        if !(5..=300).contains(&value) {
            return Err(ApiError::BadRequest(
                "video_probe_timeout_seconds must be between 5 and 300".into(),
            ));
        }
        active_settings.video_probe_timeout_seconds = Set(value);
    }

    if let Some(value) = payload.video_ffmpeg_command {
        let command = value.trim();
        if command.is_empty() || command.contains('\0') {
            return Err(ApiError::BadRequest(
                "video_ffmpeg_command must be a non-empty executable name or path".into(),
            ));
        }
        active_settings.video_ffmpeg_command = Set(command.to_owned());
    }

    if let Some(value) = payload.video_cover_time_percent {
        if !(1..=90).contains(&value) {
            return Err(ApiError::BadRequest(
                "video_cover_time_percent must be between 1 and 90".into(),
            ));
        }
        active_settings.video_cover_time_percent = Set(value);
    }

    active_settings.updated_at = Set(Utc::now());
    let saved = active_settings.update(&state.db).await?;

    Ok(Json(PreferencesResponse::from(saved)))
}
