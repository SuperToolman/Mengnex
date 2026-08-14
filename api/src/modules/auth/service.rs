use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{app_user, auth_session, role_permission},
};

pub const OWNER: &str = "owner";
pub const ADMIN: &str = "admin";
pub const EDITOR: &str = "editor";
pub const VIEWER: &str = "viewer";
const COOKIE_NAME: &str = "mengnex_session";

#[derive(Clone, Debug)]
pub struct CurrentUser {
    pub id: String,
    pub role: String,
}

pub fn valid_role(role: &str) -> bool {
    matches!(role, OWNER | ADMIN | EDITOR | VIEWER)
}
pub fn valid_permission(permission: &str) -> bool {
    matches!(
        permission,
        "media.read" | "media.write" | "system.manage" | "role.manage"
    )
}

fn required_permission(method: &str, path: &str) -> &'static str {
    if path.starts_with("/api/auth/roles") {
        return if matches!(method, "GET" | "HEAD") {
            "system.manage"
        } else {
            "role.manage"
        };
    }
    if path.starts_with("/api/auth/users") {
        return "system.manage";
    }
    if method == "PUT" && path.starts_with("/api/videos/") && path.ends_with("/playback") {
        return "media.read";
    }
    if matches!(method, "GET" | "HEAD") {
        return "media.read";
    }
    if (method == "DELETE"
        && (path.starts_with("/api/photos/") || path.starts_with("/api/recycle-bin/")))
        || (method == "POST" && path.ends_with("/restore"))
    {
        return "media.write";
    }
    "system.manage"
}

pub fn hash_password(password: &str) -> Result<String, ApiError> {
    if password.len() < 10 {
        return Err(ApiError::BadRequest(
            "password must contain at least 10 characters".to_owned(),
        ));
    }
    let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes())
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| ApiError::BadRequest(err.to_string()))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .ok()
        .and_then(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .ok()
        })
        .is_some()
}

pub async fn create_session(db: &DatabaseConnection, user_id: String) -> Result<String, ApiError> {
    let token = Uuid::new_v4().to_string();
    auth_session::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        user_id: Set(user_id),
        token: Set(token.clone()),
        expires_at: Set(Utc::now() + Duration::days(30)),
        created_at: Set(Utc::now()),
    }
    .insert(db)
    .await?;
    Ok(token)
}

pub fn session_cookie(token: &str) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
    ))
    .expect("valid session cookie")
}

pub fn clear_session_cookie() -> HeaderValue {
    HeaderValue::from_static("mengnex_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

fn cookie_token(request: &Request) -> Option<&str> {
    request
        .headers()
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| part.trim().strip_prefix("mengnex_session="))
}

pub async fn require_auth(
    axum::extract::State(state): axum::extract::State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let Some(token) = cookie_token(&request) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let session = match auth_session::Entity::find()
        .filter(auth_session::Column::Token.eq(token))
        .one(&state.db)
        .await
    {
        Ok(Some(value)) if value.expires_at > Utc::now() => value,
        _ => return StatusCode::UNAUTHORIZED.into_response(),
    };
    let user = match app_user::Entity::find_by_id(session.user_id)
        .one(&state.db)
        .await
    {
        Ok(Some(value)) => value,
        _ => return StatusCode::UNAUTHORIZED.into_response(),
    };
    let current = CurrentUser {
        id: user.id,
        role: user.role,
    };

    let permission = required_permission(request.method().as_str(), request.uri().path());
    let allowed = role_permission::Entity::find()
        .filter(role_permission::Column::Role.eq(current.role.clone()))
        .filter(role_permission::Column::Permission.eq(permission))
        .one(&state.db)
        .await
        .ok()
        .flatten()
        .is_some();
    if !allowed {
        return StatusCode::FORBIDDEN.into_response();
    }
    request.extensions_mut().insert(current);
    next.run(request).await
}
