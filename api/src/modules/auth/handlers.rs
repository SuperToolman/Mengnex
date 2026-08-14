use axum::{
    Json,
    extract::{Extension, State},
    http::header,
};
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{app_user, auth_session, role_permission},
    modules::auth::{
        dto::{
            AuthStatusResponse, AuthenticatedUserResponse, CreateUserRequest, CredentialsRequest,
            RolePermissionsResponse, UpdateRolePermissionsRequest, UserResponse,
        },
        service::{self, ADMIN, CurrentUser, OWNER},
    },
};

fn user_response(user: app_user::Model) -> UserResponse {
    UserResponse {
        id: user.id,
        display_name: user.display_name.unwrap_or_else(|| user.username.clone()),
        avatar_url: user.avatar_url,
        username: user.username,
        role: user.role,
        created_at: user.created_at,
    }
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

#[utoipa::path(get, path = "/api/auth/status", responses((status = 200, body = AuthStatusResponse)), tag = "auth")]
pub async fn status(_state: State<AppState>) -> Result<Json<AuthStatusResponse>, ApiError> {
    Ok(Json(AuthStatusResponse {
        setup_required: false,
    }))
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
    let user = app_user::Entity::find()
        .filter(app_user::Column::Username.eq(payload.username.trim()))
        .one(&state.db)
        .await?
        .ok_or(ApiError::BadRequest(
            "invalid username or password".to_owned(),
        ))?;
    if !service::verify_password(&payload.password, &user.password_hash) {
        return Err(ApiError::BadRequest(
            "invalid username or password".to_owned(),
        ));
    }
    let token = service::create_session(&state.db, user.id.clone()).await?;
    Ok((
        [(header::SET_COOKIE, service::session_cookie(&token))],
        Json(AuthenticatedUserResponse {
            user: user_response(user),
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
            .filter(auth_session::Column::Token.eq(token))
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
        user: user_response(user),
    }))
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
    Ok(Json(
        app_user::Entity::find()
            .order_by_asc(app_user::Column::Username)
            .all(&state.db)
            .await?
            .into_iter()
            .map(user_response)
            .collect(),
    ))
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
    let now = Utc::now();
    let user = app_user::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        username: Set(payload.username.trim().to_owned()),
        display_name: Set(Some(payload.display_name.trim().to_owned())),
        avatar_url: Set(payload.avatar_url.filter(|value| !value.trim().is_empty())),
        password_hash: Set(service::hash_password(&payload.password)?),
        role: Set(payload.role),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(user_response(user)))
}

#[utoipa::path(get, path = "/api/auth/roles", responses((status = 200, body = [RolePermissionsResponse])), tag = "auth")]
pub async fn list_role_permissions(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<RolePermissionsResponse>>, ApiError> {
    if !matches!(current.role.as_str(), OWNER | ADMIN) {
        return Err(ApiError::BadRequest(
            "administrator role required".to_owned(),
        ));
    }
    let mut response = Vec::new();
    for role in [OWNER, ADMIN, "editor", "viewer"] {
        let permissions = role_permission::Entity::find()
            .filter(role_permission::Column::Role.eq(role))
            .order_by_asc(role_permission::Column::Permission)
            .all(&state.db)
            .await?
            .into_iter()
            .map(|item| item.permission)
            .collect();
        response.push(RolePermissionsResponse {
            role: role.to_owned(),
            permissions,
        });
    }
    Ok(Json(response))
}

#[utoipa::path(put, path = "/api/auth/roles/{role}/permissions", params(("role" = String, Path)), request_body = UpdateRolePermissionsRequest, responses((status = 200, body = RolePermissionsResponse)), tag = "auth")]
pub async fn update_role_permissions(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    axum::extract::Path(role): axum::extract::Path<String>,
    Json(payload): Json<UpdateRolePermissionsRequest>,
) -> Result<Json<RolePermissionsResponse>, ApiError> {
    if current.role != OWNER {
        return Err(ApiError::BadRequest("owner role required".to_owned()));
    }
    if !service::valid_role(&role)
        || (role == OWNER
            && !payload
                .permissions
                .iter()
                .any(|permission| permission == "role.manage"))
    {
        return Err(ApiError::BadRequest("invalid role permissions".to_owned()));
    }
    if payload
        .permissions
        .iter()
        .any(|permission| !service::valid_permission(permission))
    {
        return Err(ApiError::BadRequest("invalid permission".to_owned()));
    }
    role_permission::Entity::delete_many()
        .filter(role_permission::Column::Role.eq(role.clone()))
        .exec(&state.db)
        .await?;
    let now = Utc::now();
    for permission in &payload.permissions {
        role_permission::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            role: Set(role.clone()),
            permission: Set(permission.clone()),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&state.db)
        .await?;
    }
    Ok(Json(RolePermissionsResponse {
        role,
        permissions: payload.permissions,
    }))
}
