use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sea_orm::DbErr;
use serde::Serialize;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Database(DbErr),
    Io(std::io::Error),
    NotFound(&'static str),
}

#[derive(Serialize)]
struct ErrorResponse {
    message: String,
}

impl From<DbErr> for ApiError {
    fn from(value: DbErr) -> Self {
        Self::Database(value)
    }
}

impl From<std::io::Error> for ApiError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Database(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            Self::Io(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            Self::NotFound(resource) => (StatusCode::NOT_FOUND, format!("{resource} not found")),
        };

        (status, Json(ErrorResponse { message })).into_response()
    }
}
