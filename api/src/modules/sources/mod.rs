use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::{DateTime, Utc};
use reqwest::{Response, Url};
use sea_orm::{DatabaseConnection, EntityTrait};
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{media_file, media_library, webdav_connection},
    modules::webdav::service,
};

pub const LOCAL: &str = "local";
pub const WEBDAV: &str = "webdav";

/// A source-owned media entry. `locator` is the persistent identity used by
/// indexing; `local_path` exists only while a source can provide local access.
#[derive(Debug, Clone)]
pub struct SourceEntry {
    pub locator: String,
    pub local_path: Option<PathBuf>,
    pub file_name: String,
    pub extension: Option<String>,
    pub file_size: i64,
    pub modified_at: Option<DateTime<Utc>>,
    pub etag: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MaterializedMediaFile {
    pub path: PathBuf,
    pub temporary: bool,
}

/// Storage backends enumerate media independently of scanner and media-type
/// processing. Future remote backends can replace `local_path` with a cache
/// materialization strategy without changing indexing callers.
pub trait MediaSource: Send + Sync {
    fn list_entries(&self) -> Result<Vec<SourceEntry>, ApiError>;
}

pub struct LocalMediaSource {
    root: PathBuf,
}

impl LocalMediaSource {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl MediaSource for LocalMediaSource {
    fn list_entries(&self) -> Result<Vec<SourceEntry>, ApiError> {
        if !self.root.exists() {
            return Err(ApiError::BadRequest(format!(
                "library root path does not exist: {}",
                self.root.display()
            )));
        }
        if !self.root.is_dir() {
            return Err(ApiError::BadRequest(format!(
                "library root path is not a directory: {}",
                self.root.display()
            )));
        }

        let mut entries = Vec::new();
        collect_local_entries(&self.root, &mut entries)?;
        Ok(entries)
    }
}

pub struct WebDavMediaSource {
    files: Vec<service::WebDavFile>,
}

impl WebDavMediaSource {
    pub fn new(files: Vec<service::WebDavFile>) -> Self {
        Self { files }
    }
}

impl MediaSource for WebDavMediaSource {
    fn list_entries(&self) -> Result<Vec<SourceEntry>, ApiError> {
        self.files
            .iter()
            .map(source_entry_from_webdav_file)
            .collect()
    }
}

/// Resolves a library source to the scanner-facing source interface. WebDAV
/// provides remote locators only; materialization is handled by the consumer
/// that actually needs file bytes.
pub async fn resolve_library_source(
    db: &DatabaseConnection,
    library: &media_library::Model,
    _scan_task_id: &str,
) -> Result<Box<dyn MediaSource>, ApiError> {
    match library.source_type.as_str() {
        LOCAL => Ok(Box::new(LocalMediaSource::new(PathBuf::from(
            &library.root_path,
        )))),
        WEBDAV => {
            let connection_id = library.webdav_connection_id.as_deref().ok_or_else(|| {
                ApiError::BadRequest("WebDAV connection is not configured".to_owned())
            })?;
            let connection = webdav_connection::Entity::find_by_id(connection_id)
                .one(db)
                .await?
                .ok_or_else(|| {
                    ApiError::BadRequest("WebDAV connection was not found".to_owned())
                })?;
            let client = service::WebDavClient::new(
                &connection.url,
                &connection.username,
                &connection.password,
            )?;
            let files = client.list_directory(&library.root_path).await?;
            Ok(Box::new(WebDavMediaSource::new(files)))
        }
        source_type => Err(ApiError::BadRequest(format!(
            "unsupported library source type: {source_type}"
        ))),
    }
}

fn collect_local_entries(path: &Path, entries: &mut Vec<SourceEntry>) -> Result<(), ApiError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            collect_local_entries(&path, entries)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }

        entries.push(source_entry_from_path(
            &path,
            path.to_string_lossy().replace('\\', "/"),
        )?);
    }

    Ok(())
}

fn source_entry_from_path(path: &Path, locator: String) -> Result<SourceEntry, ApiError> {
    let metadata = fs::metadata(path)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| DateTime::<Utc>::from(SystemTime::UNIX_EPOCH + duration));

    Ok(SourceEntry {
        locator,
        local_path: Some(path.to_path_buf()),
        file_name,
        extension,
        file_size: metadata.len() as i64,
        modified_at,
        etag: None,
    })
}

fn source_entry_from_webdav_file(file: &service::WebDavFile) -> Result<SourceEntry, ApiError> {
    let url = Url::parse(&file.remote_url)
        .map_err(|_| ApiError::BadRequest("invalid WebDAV media locator".to_owned()))?;
    let file_name = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| ApiError::BadRequest("WebDAV media locator has no file name".to_owned()))?
        .to_owned();
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    Ok(SourceEntry {
        locator: file.remote_url.clone(),
        local_path: None,
        file_name,
        extension,
        file_size: file.file_size,
        modified_at: file.modified_at,
        etag: file.etag.clone(),
    })
}

pub async fn open_webdav_content(
    db: &DatabaseConnection,
    library: &media_library::Model,
    locator: &str,
    range: Option<&str>,
) -> Result<Response, ApiError> {
    let connection_id = library
        .webdav_connection_id
        .as_deref()
        .ok_or_else(|| ApiError::BadRequest("WebDAV connection is not configured".to_owned()))?;
    let connection = webdav_connection::Entity::find_by_id(connection_id)
        .one(db)
        .await?
        .ok_or_else(|| ApiError::BadRequest("WebDAV connection was not found".to_owned()))?;
    service::WebDavClient::new(&connection.url, connection.username, connection.password)?
        .get_content(locator, range)
        .await
}

/// Downloads a remote file only for a derivative render. Unlike the regular
/// materialization path, this never populates the persistent media cache.
pub async fn materialize_media_file_for_derivative(
    db: &DatabaseConnection,
    library: &media_library::Model,
    file: &media_file::Model,
) -> Result<MaterializedMediaFile, ApiError> {
    match library.source_type.as_str() {
        LOCAL => Ok(MaterializedMediaFile {
            path: PathBuf::from(&file.full_path),
            temporary: false,
        }),
        WEBDAV => {
            let locator = file.source_locator.as_deref().ok_or_else(|| {
                ApiError::BadRequest("WebDAV media file has no source locator".to_owned())
            })?;
            let response = open_webdav_content(db, library, locator, None).await?;
            if !response.status().is_success() {
                return Err(ApiError::BadRequest(format!(
                    "WebDAV preview source returned {} for {locator}",
                    response.status()
                )));
            }

            let bytes = response.bytes().await.map_err(|error| {
                ApiError::BadRequest(format!("WebDAV preview source read failed: {error}"))
            })?;
            let extension = file.extension.as_deref().unwrap_or("media");
            let transient_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("data")
                .join("webdav-transient");
            tokio::fs::create_dir_all(&transient_root).await?;
            let path = transient_root.join(format!("{}.{}", Uuid::new_v4(), extension));
            tokio::fs::write(&path, bytes).await?;

            Ok(MaterializedMediaFile {
                path,
                temporary: true,
            })
        }
        source_type => Err(ApiError::BadRequest(format!(
            "unsupported library source type: {source_type}"
        ))),
    }
}
