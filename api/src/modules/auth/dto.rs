use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AuthRole {
    Owner,
    Admin,
    Editor,
    Viewer,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CredentialsRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUserRequest {
    pub display_name: String,
    pub username: String,
    pub password: String,
    pub avatar_url: Option<String>,
    #[schema(value_type = AuthRole)]
    pub role: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateRolePermissionsRequest {
    pub permissions: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuthStatusResponse {
    pub setup_required: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UserResponse {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    #[schema(value_type = AuthRole)]
    pub role: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuthenticatedUserResponse {
    pub user: UserResponse,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RolePermissionsResponse {
    #[schema(value_type = AuthRole)]
    pub role: String,
    pub permissions: Vec<String>,
}
