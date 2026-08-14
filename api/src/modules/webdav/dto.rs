use crate::infra::entities::webdav_connection;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateWebdavConnectionRequest {
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct WebdavConnectionResponse {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: String,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}
impl From<webdav_connection::Model> for WebdavConnectionResponse {
    fn from(value: webdav_connection::Model) -> Self {
        Self {
            id: value.id,
            name: value.name,
            url: value.url,
            username: value.username,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}
