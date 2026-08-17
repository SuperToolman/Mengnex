use axum::{
    Json,
    body::Bytes,
    extract::{Extension, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, Instant},
};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{app_user, auth_session, media_library, user_library_permission},
    modules::auth::{
        dto::{
            AuthStatusResponse, AuthenticatedUserResponse, CreateUserRequest, CredentialsRequest,
            RolePermissionsResponse, SetupRequest, UpdateCurrentUserRequest, UserResponse,
        },
        service::{self, ADMIN, CurrentUser, OWNER, role_permissions},
    },
};

async fn user_response(
    db: &impl sea_orm::ConnectionTrait,
    user: app_user::Model,
) -> Result<UserResponse, ApiError> {
    let library_ids = user_library_permission::Entity::find()
        .filter(user_library_permission::Column::UserId.eq(user.id.clone()))
        .all(db)
        .await?
        .into_iter()
        .map(|permission| permission.library_id)
        .collect();
    Ok(UserResponse {
        id: user.id,
        display_name: user.display_name.unwrap_or_else(|| user.username.clone()),
        avatar_url: user.avatar_url,
        username: user.username,
        role: user.role,
        library_ids,
        created_at: user.created_at,
    })
}
fn validate_username(value: &str) -> Result<(), ApiError> {
    if value.trim().len() < 3 || value.len() > 64 {
        Err(ApiError::BadRequest(
            "username must contain 3 to 64 characters".to_owned(),
        ))
    } else {
        Ok(())
    }
}

fn user_avatar_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("avatars")
        .join("users")
}

fn avatar_extension(body: &[u8]) -> Result<&'static str, ApiError> {
    if body.starts_with(&[0x89, b'P', b'N', b'G']) {
        Ok("png")
    } else if body.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok("jpg")
    } else if body.starts_with(b"RIFF") && body.get(8..12) == Some(b"WEBP") {
        Ok("webp")
    } else {
        Err(ApiError::BadRequest(
            "仅支持 PNG、JPEG 或 WebP 图片".to_owned(),
        ))
    }
}

fn user_avatar_file(user_id: &str) -> Option<(PathBuf, &'static str)> {
    ["png", "jpg", "webp"].into_iter().find_map(|extension| {
        let path = user_avatar_dir().join(format!("{user_id}.{extension}"));
        path.exists().then_some((path, extension))
    })
}

async fn setup_required(db: &impl sea_orm::ConnectionTrait) -> Result<bool, ApiError> {
    let users = app_user::Entity::find().all(db).await?;
    Ok(users.is_empty()
        || (users.len() == 1
            && users[0].username == "superadmin"
            && service::verify_password("Mengnex@2026", &users[0].password_hash)))
}

#[utoipa::path(get, path = "/api/auth/status", responses((status = 200, body = AuthStatusResponse)), tag = "auth")]
pub async fn status(State(state): State<AppState>) -> Result<Json<AuthStatusResponse>, ApiError> {
    Ok(Json(AuthStatusResponse {
        setup_required: setup_required(&state.db).await?,
    }))
}

#[utoipa::path(post, path = "/api/auth/setup", request_body = SetupRequest, responses((status = 200, body = AuthenticatedUserResponse)), tag = "auth")]
pub async fn setup(
    State(state): State<AppState>,
    Json(payload): Json<SetupRequest>,
) -> Result<
    (
        [(header::HeaderName, header::HeaderValue); 1],
        Json<AuthenticatedUserResponse>,
    ),
    ApiError,
> {
    let _guard = state.setup_lock.lock().await;
    if !setup_required(&state.db).await? {
        return Err(ApiError::Conflict(
            "application setup is already complete".to_owned(),
        ));
    }
    validate_username(&payload.username)?;
    if payload.display_name.trim().is_empty() {
        return Err(ApiError::BadRequest("display name is required".to_owned()));
    }
    let now = Utc::now();
    let txn = state.db.begin().await?;
    if let Some(legacy_user) = app_user::Entity::find()
        .filter(app_user::Column::Username.eq("superadmin"))
        .one(&txn)
        .await?
        .filter(|user| service::verify_password("Mengnex@2026", &user.password_hash))
    {
        auth_session::Entity::delete_many()
            .filter(auth_session::Column::UserId.eq(&legacy_user.id))
            .exec(&txn)
            .await?;
        app_user::Entity::delete_by_id(legacy_user.id)
            .exec(&txn)
            .await?;
    }
    let user = app_user::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        username: Set(payload.username.trim().to_owned()),
        display_name: Set(Some(payload.display_name.trim().to_owned())),
        avatar_url: Set(None),
        password_hash: Set(service::hash_password(&payload.password)?),
        role: Set(OWNER.to_owned()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await?;
    let token = service::create_session(&txn, user.id.clone()).await?;
    let response = user_response(&txn, user).await?;
    txn.commit().await?;
    Ok((
        [(
            header::SET_COOKIE,
            service::session_cookie(&token, state.secure_cookies),
        )],
        Json(AuthenticatedUserResponse { user: response }),
    ))
}

#[utoipa::path(post, path = "/api/auth/login", request_body = CredentialsRequest, responses((status = 200, body = AuthenticatedUserResponse)), tag = "auth")]
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<CredentialsRequest>,
) -> Result<
    (
        [(header::HeaderName, header::HeaderValue); 1],
        Json<AuthenticatedUserResponse>,
    ),
    ApiError,
> {
    let attempt_key = payload.username.trim().to_ascii_lowercase();
    {
        let mut attempts = state.login_attempts.lock().await;
        let recent = attempts.entry(attempt_key.clone()).or_default();
        recent.retain(|attempt| attempt.elapsed() < Duration::from_secs(60));
        if recent.len() >= 5 {
            return Err(ApiError::TooManyRequests(
                "too many login attempts; try again later".to_owned(),
            ));
        }
    }
    let user = app_user::Entity::find()
        .filter(app_user::Column::Username.eq(payload.username.trim()))
        .one(&state.db)
        .await?;
    let valid = user
        .as_ref()
        .is_some_and(|user| service::verify_password(&payload.password, &user.password_hash));
    if !valid {
        state
            .login_attempts
            .lock()
            .await
            .entry(attempt_key)
            .or_default()
            .push(Instant::now());
        return Err(ApiError::Unauthorized(
            "invalid username or password".to_owned(),
        ));
    }
    let user = user.expect("validated user must exist");
    state.login_attempts.lock().await.remove(&attempt_key);
    let token = service::create_session(&state.db, user.id.clone()).await?;
    Ok((
        [(
            header::SET_COOKIE,
            service::session_cookie(&token, state.secure_cookies),
        )],
        Json(AuthenticatedUserResponse {
            user: user_response(&state.db, user).await?,
        }),
    ))
}

#[utoipa::path(post, path = "/api/auth/logout", responses((status = 200, body = AuthStatusResponse)), tag = "auth")]
pub async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<
    (
        [(header::HeaderName, header::HeaderValue); 1],
        Json<AuthStatusResponse>,
    ),
    ApiError,
> {
    if let Some(token) = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(';')
                .find_map(|part| part.trim().strip_prefix("mengnex_session="))
        })
    {
        auth_session::Entity::delete_many()
            .filter(
                auth_session::Column::Token
                    .is_in([service::hash_session_token(token), token.to_owned()]),
            )
            .exec(&state.db)
            .await?;
    }
    Ok((
        [(header::SET_COOKIE, service::clear_session_cookie())],
        Json(AuthStatusResponse {
            setup_required: false,
        }),
    ))
}

#[utoipa::path(get, path = "/api/auth/me", responses((status = 200, body = AuthenticatedUserResponse)), tag = "auth")]
pub async fn me(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<AuthenticatedUserResponse>, ApiError> {
    let user = app_user::Entity::find_by_id(current.id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("user"))?;
    Ok(Json(AuthenticatedUserResponse {
        user: user_response(&state.db, user).await?,
    }))
}

#[utoipa::path(put, path = "/api/auth/me/profile", request_body = UpdateCurrentUserRequest, responses((status = 200, body = UserResponse)), tag = "auth")]
pub async fn update_current_user(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateCurrentUserRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    let display_name = payload.display_name.trim();
    if display_name.is_empty() {
        return Err(ApiError::BadRequest("display name is required".to_owned()));
    }
    let mut active_user = app_user::ActiveModel {
        id: Set(current.id.clone()),
        display_name: Set(Some(display_name.to_owned())),
        updated_at: Set(Utc::now()),
        ..Default::default()
    };
    if let Some(password) = payload.password.filter(|value| !value.is_empty()) {
        active_user.password_hash = Set(service::hash_password(&password)?);
    }
    active_user.update(&state.db).await?;
    let user = app_user::Entity::find_by_id(current.id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("user"))?;
    Ok(Json(user_response(&state.db, user).await?))
}

async fn user_avatar_response(user_id: &str) -> Result<Response, ApiError> {
    let (path, extension) = user_avatar_file(user_id).ok_or(ApiError::NotFound("user avatar"))?;
    let content_type = match extension {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        _ => "image/webp",
    };
    let bytes = tokio::fs::read(path).await?;
    Ok((
        [(header::CONTENT_TYPE, HeaderValue::from_static(content_type))],
        bytes,
    )
        .into_response())
}

#[utoipa::path(get, path = "/api/auth/me/avatar", responses((status = 200, description = "Current user avatar")), tag = "auth")]
pub async fn get_current_user_avatar(
    Extension(current): Extension<CurrentUser>,
) -> Result<Response, ApiError> {
    user_avatar_response(&current.id).await
}

#[utoipa::path(get, path = "/api/auth/users/{id}/avatar", responses((status = 200, description = "User avatar")), tag = "auth")]
pub async fn get_user_avatar(
    Extension(current): Extension<CurrentUser>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Response, ApiError> {
    if current.id != id && !matches!(current.role.as_str(), "owner" | "admin") {
        return Err(ApiError::Unauthorized(
            "user avatar access denied".to_owned(),
        ));
    }
    user_avatar_response(&id).await
}

#[utoipa::path(put, path = "/api/auth/me/avatar", request_body(content = Vec<u8>, content_type = "application/octet-stream"), responses((status = 200, body = UserResponse)), tag = "auth")]
pub async fn upload_current_user_avatar(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<UserResponse>, ApiError> {
    if body.is_empty() || body.len() > 5 * 1024 * 1024 {
        return Err(ApiError::BadRequest("头像文件需小于 5MB".to_owned()));
    }
    let extension = avatar_extension(&body)?;
    let directory = user_avatar_dir();
    tokio::fs::create_dir_all(&directory).await?;
    let file_name = format!("{}.{}", current.id, extension);
    tokio::fs::write(directory.join(&file_name), body).await?;
    for stale_extension in ["png", "jpg", "webp"] {
        if stale_extension != extension {
            let _ = tokio::fs::remove_file(
                directory.join(format!("{}.{}", current.id, stale_extension)),
            )
            .await;
        }
    }
    let updated_at = Utc::now();
    let avatar_url = format!(
        "/api/auth/users/{}/avatar?v={}",
        current.id,
        updated_at.timestamp_millis()
    );
    app_user::ActiveModel {
        id: Set(current.id.clone()),
        avatar_url: Set(Some(avatar_url)),
        updated_at: Set(updated_at),
        ..Default::default()
    }
    .update(&state.db)
    .await?;
    let user = app_user::Entity::find_by_id(current.id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("user"))?;
    Ok(Json(user_response(&state.db, user).await?))
}
#[utoipa::path(get, path = "/api/auth/users", responses((status = 200, body = [UserResponse])), tag = "auth")]
pub async fn list_users(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<UserResponse>>, ApiError> {
    if !matches!(current.role.as_str(), OWNER | ADMIN) {
        return Err(ApiError::BadRequest(
            "administrator role required".to_owned(),
        ));
    }
    let users = app_user::Entity::find()
        .order_by_asc(app_user::Column::Username)
        .all(&state.db)
        .await?;
    let mut response = Vec::with_capacity(users.len());
    for user in users {
        response.push(user_response(&state.db, user).await?);
    }
    Ok(Json(response))
}
#[utoipa::path(post, path = "/api/auth/users", request_body = CreateUserRequest, responses((status = 200, body = UserResponse)), tag = "auth")]
pub async fn create_user(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    if !matches!(current.role.as_str(), OWNER | ADMIN) {
        return Err(ApiError::BadRequest(
            "administrator role required".to_owned(),
        ));
    }
    if !service::valid_role(&payload.role) || (payload.role == OWNER && current.role != OWNER) {
        return Err(ApiError::BadRequest("role is not allowed".to_owned()));
    }
    validate_username(&payload.username)?;
    if payload.display_name.trim().is_empty() {
        return Err(ApiError::BadRequest("display name is required".to_owned()));
    }
    let library_ids = payload.library_ids.iter().cloned().collect::<HashSet<_>>();
    if matches!(payload.role.as_str(), "editor" | "viewer") && !library_ids.is_empty() {
        let found = media_library::Entity::find()
            .filter(media_library::Column::Id.is_in(library_ids.iter().cloned()))
            .count(&state.db)
            .await? as usize;
        if found != library_ids.len() {
            return Err(ApiError::BadRequest(
                "one or more media libraries do not exist".to_owned(),
            ));
        }
    }
    let now = Utc::now();
    let txn = state.db.begin().await?;
    let user = app_user::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        username: Set(payload.username.trim().to_owned()),
        display_name: Set(Some(payload.display_name.trim().to_owned())),
        avatar_url: Set(payload.avatar_url.filter(|value| !value.trim().is_empty())),
        password_hash: Set(service::hash_password(&payload.password)?),
        role: Set(payload.role.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await?;
    for library_id in library_ids {
        user_library_permission::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            user_id: Set(user.id.clone()),
            library_id: Set(library_id),
            access_level: Set(if payload.role == "editor" {
                "write"
            } else {
                "read"
            }
            .to_owned()),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&txn)
        .await?;
    }
    let response = user_response(&txn, user).await?;
    txn.commit().await?;
    Ok(Json(response))
}

#[utoipa::path(get, path = "/api/auth/roles", responses((status = 200, body = [RolePermissionsResponse])), tag = "auth")]
pub async fn list_role_permissions(
    Extension(current): Extension<CurrentUser>,
    State(_state): State<AppState>,
) -> Result<Json<Vec<RolePermissionsResponse>>, ApiError> {
    if !matches!(current.role.as_str(), OWNER | ADMIN) {
        return Err(ApiError::BadRequest(
            "administrator role required".to_owned(),
        ));
    }
    let mut response = Vec::new();
    for role in [OWNER, ADMIN, "editor", "viewer"] {
        let permissions = role_permissions(role)
            .iter()
            .map(|value| (*value).to_owned())
            .collect();
        response.push(RolePermissionsResponse {
            role: role.to_owned(),
            permissions,
        });
    }
    Ok(Json(response))
}
