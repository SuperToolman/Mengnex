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
    Conflict(String),
    Database(DbErr),
    Io(std::io::Error),
    NotFound(&'static str),
    TooManyRequests(String),
    Unauthorized(String),
    TaskCanceled,
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
            Self::Conflict(message) => (StatusCode::CONFLICT, message),
            Self::Database(err) => {
                tracing::error!(error = %err, "database request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_owned(),
                )
            }
            Self::Io(err) => {
                tracing::error!(error = %err, "I/O request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_owned(),
                )
            }
            Self::NotFound(resource) => (StatusCode::NOT_FOUND, format!("{resource} not found")),
            Self::TooManyRequests(message) => (StatusCode::TOO_MANY_REQUESTS, message),
            Self::Unauthorized(message) => (StatusCode::UNAUTHORIZED, message),
            Self::TaskCanceled => (StatusCode::CONFLICT, "task was canceled".to_owned()),
        };

        (status, Json(ErrorResponse { message })).into_response()
    }
}
