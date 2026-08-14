use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, sea_query::Expr,
};
use serde::Deserialize;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{media_file, media_item, media_library, photo_asset},
    modules::photos::service::resolve_derivative_path,
    modules::{
        media::dto::{MediaFileResponse, MediaItemResponse},
        sources,
    },
};

const DERIVATIVE_CACHE_CONTROL: &str = "private, max-age=604800, immutable";
const ORIGINAL_CACHE_CONTROL: &str = "private, max-age=3600";

#[derive(Debug, Deserialize)]
pub struct MediaContentQuery {
    pub variant: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListMediaQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/api/media/items",
    params(
        ("limit" = Option<u64>, Query, description = "Maximum number of items"),
        ("offset" = Option<u64>, Query, description = "Number of items to skip")
    ),
    responses((status = 200, description = "List scanned media items", body = [MediaItemResponse])),
    tag = "media"
)]
pub async fn list_media_items(
    State(state): State<AppState>,
    Query(query): Query<ListMediaQuery>,
) -> Result<Json<Vec<MediaItemResponse>>, ApiError> {
    let mut select = media_item::Entity::find()
        .filter(media_item::Column::DeletedAt.is_null())
        .order_by_desc(media_item::Column::CreatedAt);

    select = select.limit(bounded_limit(query.limit));

    if let Some(offset) = query.offset {
        select = select.offset(offset);
    }

    let items = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(MediaItemResponse::from)
        .collect();

    Ok(Json(items))
}

#[utoipa::path(
    get,
    path = "/api/media/files",
    params(
        ("limit" = Option<u64>, Query, description = "Maximum number of files"),
        ("offset" = Option<u64>, Query, description = "Number of files to skip")
    ),
    responses((status = 200, description = "List scanned media files", body = [MediaFileResponse])),
    tag = "media"
)]
pub async fn list_media_files(
    State(state): State<AppState>,
    Query(query): Query<ListMediaQuery>,
) -> Result<Json<Vec<MediaFileResponse>>, ApiError> {
    let deleted_items = media_item::Entity::find()
        .select_only()
        .column(media_item::Column::Id)
        .filter(media_item::Column::DeletedAt.is_not_null())
        .into_query();
    let mut select = media_file::Entity::find()
        .filter(Expr::col(media_file::Column::ItemId).not_in_subquery(deleted_items))
        .order_by_desc(media_file::Column::CreatedAt);

    select = select.limit(bounded_limit(query.limit));

    if let Some(offset) = query.offset {
        select = select.offset(offset);
    }

    let files = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(MediaFileResponse::from)
        .collect();

    Ok(Json(files))
}

#[utoipa::path(
    get,
    path = "/api/media/files/{id}/content",
    params(("id" = String, Path, description = "Media file id")),
    responses(
        (status = 200, description = "Media file content"),
        (status = 404, description = "Media file not found")
    ),
    tag = "media"
)]
pub async fn get_media_file_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<MediaContentQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let file = media_file::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media file"))?;
    let requested_variant = query.variant.unwrap_or_else(|| "original".to_owned());

    if requested_variant == "preview" || requested_variant == "preview" {
        let asset = photo_asset::Entity::find()
            .filter(photo_asset::Column::FileId.eq(file.id.clone()))
            .one(&state.db)
            .await?
            .ok_or(ApiError::NotFound("photo asset"))?;
        let derivative_path = resolve_derivative_path(&asset, &requested_variant)
            .ok_or(ApiError::NotFound("generated media variant"))?;
        let derivative_file = fs::File::open(derivative_path).await?;
        let content_type = asset
            .preview_rel_path
            .as_deref()
            .map(derivative_content_type)
            .unwrap_or("application/octet-stream");

        return Ok((
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type.to_owned()),
                (header::CACHE_CONTROL, DERIVATIVE_CACHE_CONTROL.to_owned()),
            ],
            Body::from_stream(ReaderStream::new(derivative_file)),
        )
            .into_response());
    }

    let library = media_library::Entity::find_by_id(file.library_id.clone())
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media library"))?;

    if library.source_type == "webdav" {
        if let Some(locator) = file.source_locator.as_deref() {
            let range = headers
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok());
            return proxy_webdav_content(&state.db, &library, locator, range).await;
        }
    }

    let mut source_file = fs::File::open(&file.full_path).await?;
    let file_size = source_file.metadata().await?.len();
    let content_type = file
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_byte_range(value, file_size))
        .transpose()?;

    let (status, start, end) = range
        .map(|(start, end)| (StatusCode::PARTIAL_CONTENT, start, end))
        .unwrap_or((StatusCode::OK, 0, file_size.saturating_sub(1)));
    let content_length = end.saturating_sub(start).saturating_add(1);
    source_file.seek(SeekFrom::Start(start)).await?;
    let stream = ReaderStream::new(source_file.take(content_length));
    let mut response = (
        status,
        [
            (header::CONTENT_TYPE, content_type),
            (header::ACCEPT_RANGES, "bytes".to_owned()),
            (header::CONTENT_LENGTH, content_length.to_string()),
            (header::CACHE_CONTROL, ORIGINAL_CACHE_CONTROL.to_owned()),
        ],
        Body::from_stream(stream),
    )
        .into_response();
    if status == StatusCode::PARTIAL_CONTENT {
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{file_size}"))
                .map_err(|_| ApiError::BadRequest("invalid local content range".to_owned()))?,
        );
    }
    Ok(response)
}

fn parse_byte_range(value: &str, file_size: u64) -> Result<(u64, u64), ApiError> {
    if file_size == 0 || !value.starts_with("bytes=") || value.contains(',') {
        return Err(ApiError::BadRequest(
            "requested byte range is not satisfiable".to_owned(),
        ));
    }
    let (start, end) = value[6..]
        .split_once('-')
        .ok_or_else(|| ApiError::BadRequest("invalid byte range".to_owned()))?;
    let (start, end) = if start.is_empty() {
        let suffix = end
            .parse::<u64>()
            .map_err(|_| ApiError::BadRequest("invalid byte range".to_owned()))?;
        let length = suffix.min(file_size);
        (file_size - length, file_size - 1)
    } else {
        let start = start
            .parse::<u64>()
            .map_err(|_| ApiError::BadRequest("invalid byte range".to_owned()))?;
        let end = if end.is_empty() {
            file_size - 1
        } else {
            end.parse::<u64>()
                .map_err(|_| ApiError::BadRequest("invalid byte range".to_owned()))?
                .min(file_size - 1)
        };
        (start, end)
    };
    if start >= file_size || start > end {
        return Err(ApiError::BadRequest(
            "requested byte range is not satisfiable".to_owned(),
        ));
    }
    Ok((start, end))
}

async fn proxy_webdav_content(
    db: &sea_orm::DatabaseConnection,
    library: &media_library::Model,
    locator: &str,
    range: Option<&str>,
) -> Result<Response, ApiError> {
    let response = sources::open_webdav_content(db, library, locator, range).await?;
    let status = StatusCode::from_u16(response.status().as_u16())
        .map_err(|_| ApiError::BadRequest("invalid WebDAV content status".to_owned()))?;
    if !status.is_success() {
        return Err(ApiError::BadRequest(format!(
            "WebDAV content returned {} for {}",
            response.status(),
            locator
        )));
    }

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let content_range = response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let content_length = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut proxied = (
        status,
        [
            (header::CONTENT_TYPE, content_type),
            (header::ACCEPT_RANGES, "bytes".to_owned()),
            (header::CACHE_CONTROL, ORIGINAL_CACHE_CONTROL.to_owned()),
        ],
        Body::from_stream(response.bytes_stream()),
    )
        .into_response();

    if let Some(content_length) = content_length {
        let value = HeaderValue::from_str(&content_length)
            .map_err(|_| ApiError::BadRequest("invalid WebDAV content length".to_owned()))?;
        proxied.headers_mut().insert(header::CONTENT_LENGTH, value);
    }

    if let Some(content_range) = content_range {
        let value = HeaderValue::from_str(&content_range)
            .map_err(|_| ApiError::BadRequest("invalid WebDAV content range".to_owned()))?;
        proxied.headers_mut().insert(header::CONTENT_RANGE, value);
    }

    Ok(proxied)
}

fn derivative_content_type(relative_path: &str) -> &'static str {
    if relative_path.ends_with(".webp") {
        return "image/webp";
    }

    if relative_path.ends_with(".jpg") || relative_path.ends_with(".jpeg") {
        return "image/jpeg";
    }

    "application/octet-stream"
}

fn bounded_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(100).clamp(1, 500)
}

#[cfg(test)]
mod tests {
    use super::{
        DERIVATIVE_CACHE_CONTROL, ORIGINAL_CACHE_CONTROL, bounded_limit, parse_byte_range,
    };

    #[test]
    fn bounds_media_list_limits() {
        assert_eq!(bounded_limit(None), 100);
        assert_eq!(bounded_limit(Some(0)), 1);
        assert_eq!(bounded_limit(Some(200)), 200);
        assert_eq!(bounded_limit(Some(999)), 500);
    }

    #[test]
    fn media_variants_use_the_expected_cache_policies() {
        assert_eq!(
            DERIVATIVE_CACHE_CONTROL,
            "private, max-age=604800, immutable"
        );
        assert_eq!(ORIGINAL_CACHE_CONTROL, "private, max-age=3600");
    }

    #[test]
    fn parses_single_byte_ranges() {
        assert_eq!(parse_byte_range("bytes=20-", 100).unwrap(), (20, 99));
        assert_eq!(parse_byte_range("bytes=-20", 100).unwrap(), (80, 99));
        assert_eq!(parse_byte_range("bytes=20-60", 100).unwrap(), (20, 60));
        assert!(parse_byte_range("bytes=100-", 100).is_err());
    }
}
