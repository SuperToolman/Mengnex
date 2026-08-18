use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{app_user, auth_session, user_library_permission},
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
    pub library_ids: Option<Vec<String>>,
}

impl CurrentUser {
    pub fn can_access_library(&self, library_id: &str) -> bool {
        self.library_ids
            .as_ref()
            .is_none_or(|ids| ids.iter().any(|id| id == library_id))
    }
}

pub fn valid_role(role: &str) -> bool {
    matches!(role, OWNER | ADMIN | EDITOR | VIEWER)
}
/// Role capabilities are application policy and are intentionally not editable at runtime.
pub fn role_permissions(role: &str) -> &'static [&'static str] {
    match role {
        OWNER => &["media.read", "media.write", "system.manage"],
        ADMIN => &["media.read", "media.write", "system.manage"],
        EDITOR => &["media.read", "media.write"],
        VIEWER => &["media.read"],
        _ => &[],
    }
}

fn required_permission(method: &str, path: &str) -> &'static str {
    if path.starts_with("/api/auth/roles") {
        return "system.manage";
    }
    if method == "GET" && path.starts_with("/api/auth/users/") && path.ends_with("/avatar") {
        return "media.read";
    }
    if path.starts_with("/api/auth/users") {
        return "system.manage";
    }
    if path.starts_with("/api/auth/me") {
        return "media.read";
    }
    if path.starts_with("/api/media/import") {
        return "media.write";
    }
    if method == "PUT" && path.starts_with("/api/videos/") && path.ends_with("/playback") {
        return "media.read";
    }
    if matches!(method, "GET" | "HEAD") {
        return "media.read";
    }
    if path.starts_with("/api/tags")
        || path.starts_with("/api/authors/")
        || (method == "DELETE" && path.starts_with("/api/photos/"))
        || path.starts_with("/api/recycle-bin/")
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

pub async fn create_session(
    db: &impl sea_orm::ConnectionTrait,
    user_id: String,
) -> Result<String, ApiError> {
    let token = Uuid::new_v4().to_string();
    auth_session::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        user_id: Set(user_id),
        token: Set(hash_session_token(&token)),
        expires_at: Set(Utc::now() + Duration::days(30)),
        created_at: Set(Utc::now()),
    }
    .insert(db)
    .await?;
    Ok(token)
}

pub fn hash_session_token(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

pub fn session_cookie(token: &str, secure: bool) -> HeaderValue {
    let secure_attribute = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000{secure_attribute}"
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
    let token_hash = hash_session_token(token);
    let session = match auth_session::Entity::find()
        .filter(auth_session::Column::Token.is_in([token_hash, token.to_owned()]))
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
        id: user.id.clone(),
        library_ids: if matches!(user.role.as_str(), OWNER | ADMIN) {
            None
        } else {
            Some(
                user_library_permission::Entity::find()
                    .filter(user_library_permission::Column::UserId.eq(user.id.clone()))
                    .all(&state.db)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .map(|permission| permission.library_id)
                    .collect(),
            )
        },
        role: user.role,
    };

    let permission = required_permission(request.method().as_str(), request.uri().path());
    let allowed = role_permissions(&current.role).contains(&permission);
    if !allowed {
        return StatusCode::FORBIDDEN.into_response();
    }
    request.extensions_mut().insert(current);
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::{ADMIN, OWNER, VIEWER, required_permission, role_permissions};

    #[test]
    fn media_writes_do_not_require_system_management() {
        assert_eq!(required_permission("POST", "/api/tags"), "media.write");
        assert_eq!(
            required_permission("DELETE", "/api/photos/1"),
            "media.write"
        );
        assert_eq!(
            required_permission("POST", "/api/recycle-bin/1/restore"),
            "media.write"
        );
    }

    #[test]
    fn administrative_writes_require_system_management() {
        assert_eq!(
            required_permission("POST", "/api/libraries"),
            "system.manage"
        );
        assert_eq!(required_permission("POST", "/api/scans"), "system.manage");
    }

    #[test]
    fn built_in_role_permissions_are_fixed() {
        assert_eq!(role_permissions(OWNER), role_permissions(ADMIN));
        assert_eq!(role_permissions(VIEWER), &["media.read"]);
    }
}
