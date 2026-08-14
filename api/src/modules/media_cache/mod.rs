use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::{DateTime, Utc};

use sea_orm::{DatabaseConnection, EntityTrait};

use crate::{
    core::error::ApiError,
    infra::entities::{app_setting, media_file},
};

/// Persistent, read-through cache for remote source originals. Cache placement
/// is source-agnostic so future S3/SMB adapters can reuse the same lifecycle.
#[derive(Debug, Clone)]
pub struct MediaCache {
    root: PathBuf,
    max_bytes: u64,
}

const DEFAULT_MAX_BYTES: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Debug)]
struct CacheEntry {
    path: PathBuf,
    size: u64,
    last_accessed: SystemTime,
}

impl Default for MediaCache {
    fn default() -> Self {
        Self {
            root: default_cache_directory(),
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

impl MediaCache {
    pub async fn load(db: &DatabaseConnection) -> Result<Self, ApiError> {
        let settings = app_setting::Entity::find_by_id("global")
            .one(db)
            .await?
            .ok_or_else(|| ApiError::NotFound("application settings"))?;
        let root = settings
            .media_cache_directory
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_cache_directory);
        Ok(Self {
            root,
            max_bytes: settings.media_cache_max_bytes.max(1) as u64,
        })
    }

    pub async fn cached_path(&self, file: &media_file::Model) -> Result<Option<PathBuf>, ApiError> {
        let path = self.path_for(file);
        let metadata = match tokio::fs::metadata(&path).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };

        if file.file_size > 0 && metadata.len() != file.file_size as u64 {
            return Ok(None);
        }

        if let Some(source_modified_at) = file.modified_at {
            let cached_modified_at = metadata.modified().ok().map(DateTime::<Utc>::from);
            if cached_modified_at.is_none_or(|cached| cached < source_modified_at) {
                return Ok(None);
            }
        }

        self.touch_access_marker(&path).await?;
        Ok(Some(path))
    }

    pub async fn store(&self, file: &media_file::Model, bytes: &[u8]) -> Result<PathBuf, ApiError> {
        let path = self.path_for(file);
        self.evict_for(bytes.len() as u64, &path).await?;
        let parent = path
            .parent()
            .ok_or_else(|| ApiError::BadRequest("invalid media cache path".to_owned()))?;
        tokio::fs::create_dir_all(parent).await?;

        let temporary = self.marker_path(&path, "part");
        tokio::fs::write(&temporary, bytes).await?;
        if tokio::fs::try_exists(&path).await? {
            tokio::fs::remove_file(&path).await?;
        }
        tokio::fs::rename(&temporary, &path).await?;
        self.touch_access_marker(&path).await?;
        Ok(path)
    }

    fn path_for(&self, file: &media_file::Model) -> PathBuf {
        let extension = file
            .extension
            .as_deref()
            .filter(|value| {
                value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
            })
            .unwrap_or("media");
        self.root
            .join(&file.library_id)
            .join(format!("{}.{}", file.id, extension))
    }

    async fn evict_for(&self, incoming_size: u64, protected_path: &Path) -> Result<(), ApiError> {
        if incoming_size > self.max_bytes {
            return Err(ApiError::BadRequest(format!(
                "media file is larger than the cache limit of {} bytes",
                self.max_bytes
            )));
        }

        let root = self.root.clone();
        let mut entries = tokio::task::spawn_blocking(move || collect_cache_entries(&root))
            .await
            .map_err(|error| ApiError::BadRequest(format!("media cache scan failed: {error}")))??;
        let mut total_size = entries.iter().map(|entry| entry.size).sum::<u64>();
        if let Some(existing) = entries.iter().find(|entry| entry.path == protected_path) {
            total_size = total_size.saturating_sub(existing.size);
        }
        if total_size.saturating_add(incoming_size) <= self.max_bytes {
            return Ok(());
        }

        entries.sort_by_key(|entry| entry.last_accessed);
        for entry in entries {
            if entry.path == protected_path {
                continue;
            }
            tokio::fs::remove_file(&entry.path).await?;
            let marker = self.marker_path(&entry.path, "access");
            if tokio::fs::try_exists(&marker).await? {
                tokio::fs::remove_file(marker).await?;
            }
            total_size = total_size.saturating_sub(entry.size);
            if total_size.saturating_add(incoming_size) <= self.max_bytes {
                break;
            }
        }
        Ok(())
    }

    async fn touch_access_marker(&self, path: &Path) -> Result<(), ApiError> {
        tokio::fs::write(self.marker_path(path, "access"), []).await?;
        Ok(())
    }

    fn marker_path(&self, path: &Path, marker: &str) -> PathBuf {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("media");
        path.with_file_name(format!("{name}.mng-{marker}"))
    }
}

fn default_cache_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/media-cache")
}

fn collect_cache_entries(root: &Path) -> Result<Vec<CacheEntry>, std::io::Error> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    collect_cache_entries_recursive(root, &mut entries)?;
    Ok(entries)
}

fn collect_cache_entries_recursive(
    directory: &Path,
    entries: &mut Vec<CacheEntry>,
) -> Result<(), std::io::Error> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            collect_cache_entries_recursive(&path, entries)?;
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if name.ends_with(".mng-access") || name.ends_with(".mng-part") {
            continue;
        }
        let access_marker = path.with_file_name(format!("{name}.mng-access"));
        let last_accessed = fs::metadata(access_marker)
            .and_then(|marker| marker.modified())
            .or_else(|_| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push(CacheEntry {
            path,
            size: metadata.len(),
            last_accessed,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::MediaCache;
    use chrono::Utc;

    #[test]
    fn cache_path_is_scoped_to_library_and_file() {
        let file = crate::infra::entities::media_file::Model {
            id: "file-id".to_owned(),
            item_id: "item-id".to_owned(),
            library_id: "library-id".to_owned(),
            scan_task_id: None,
            full_path: "unused".to_owned(),
            source_locator: None,
            file_name: "photo.jpg".to_owned(),
            extension: Some("jpg".to_owned()),
            mime_type: None,
            file_size: 0,
            modified_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let path = MediaCache::default().path_for(&file);
        assert!(path.ends_with("library-id/file-id.jpg"));
    }
}
