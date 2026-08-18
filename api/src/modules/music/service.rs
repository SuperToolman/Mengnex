use std::path::PathBuf;

use chrono::Utc;
use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::{Accessor, ItemKey},
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, Set,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    core::error::ApiError,
    infra::entities::{
        media_file, media_library, music_album, music_artist, music_track, music_track_artist,
    },
    modules::{
        photos::service::PreviewOperationSummary, sources, tasks::service::wait_for_task_permit,
    },
};

pub async fn upsert_music_track<C: ConnectionTrait>(
    db: &C,
    library: &media_library::Model,
    file: &media_file::Model,
    fallback_title: &str,
) -> Result<(), ApiError> {
    let now = Utc::now();
    if let Some(existing) = music_track::Entity::find()
        .filter(music_track::Column::FileId.eq(&file.id))
        .one(db)
        .await?
    {
        let mut active: music_track::ActiveModel = existing.into();
        active.item_id = Set(file.item_id.clone());
        active.library_id = Set(library.id.clone());
        active.title = Set(fallback_title.to_owned());
        active.metadata_status = Set("pending".to_owned());
        active.metadata_error = Set(None);
        active.updated_at = Set(now);
        active.update(db).await?;
        return Ok(());
    }
    music_track::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        item_id: Set(file.item_id.clone()),
        file_id: Set(file.id.clone()),
        library_id: Set(library.id.clone()),
        album_id: Set(None),
        title: Set(fallback_title.to_owned()),
        artist: Set(None),
        album_title: Set(None),
        album_artist: Set(None),
        track_number: Set(None),
        disc_number: Set(None),
        year: Set(None),
        duration_seconds: Set(None),
        codec: Set(file.extension.clone()),
        bitrate_kbps: Set(None),
        sample_rate_hz: Set(None),
        bit_depth: Set(None),
        genre: Set(None),
        composer: Set(None),
        lyricist: Set(None),
        producer: Set(None),
        lyrics: Set(None),
        lyrics_source: Set(None),
        metadata_status: Set("pending".to_owned()),
        metadata_error: Set(None),
        analyzed_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(())
}

#[derive(Debug)]
struct ParsedMetadata {
    title: Option<String>,
    artist: Option<String>,
    album_artist: Option<String>,
    album: Option<String>,
    track: Option<i32>,
    disc: Option<i32>,
    year: Option<i32>,
    genre: Option<String>,
    composer: Option<String>,
    lyricist: Option<String>,
    producer: Option<String>,
    lyrics: Option<String>,
    lyrics_source: Option<String>,
    duration: f64,
    bitrate_kbps: Option<i32>,
    sample_rate_hz: Option<i32>,
    bit_depth: Option<i32>,
    cover: Option<Vec<u8>>,
}

fn parse_audio(path: PathBuf) -> Result<ParsedMetadata, String> {
    let tagged = lofty::read_from_path(path).map_err(|error| error.to_string())?;
    let tag = tagged.primary_tag();
    let cover = tag
        .and_then(|value| value.pictures().first())
        .map(|picture| picture.data().to_vec())
        .filter(|bytes| bytes.len() <= 8 * 1024 * 1024);
    Ok(ParsedMetadata {
        title: tag
            .and_then(|value| value.title())
            .map(|value| value.into_owned()),
        artist: tag
            .and_then(|value| value.artist())
            .map(|value| value.into_owned()),
        album_artist: tag
            .and_then(|value| value.get_string(&ItemKey::AlbumArtist))
            .map(str::to_owned),
        album: tag
            .and_then(|value| value.album())
            .map(|value| value.into_owned()),
        track: tag
            .and_then(|value| value.track())
            .map(|value| value as i32),
        disc: tag.and_then(|value| value.disk()).map(|value| value as i32),
        year: tag.and_then(|value| value.year()).map(|value| value as i32),
        genre: tag
            .and_then(|value| value.genre())
            .map(|value| value.into_owned()),
        composer: tag
            .and_then(|value| value.get_string(&ItemKey::Composer))
            .map(str::to_owned),
        lyricist: tag
            .and_then(|value| value.get_string(&ItemKey::Lyricist))
            .map(str::to_owned),
        producer: tag
            .and_then(|value| value.get_string(&ItemKey::Producer))
            .map(str::to_owned),
        lyrics: tag
            .and_then(|value| value.get_string(&ItemKey::Lyrics))
            .map(str::to_owned),
        lyrics_source: tag
            .and_then(|value| value.get_string(&ItemKey::Lyrics))
            .map(|_| "embedded".to_owned()),
        duration: tagged.properties().duration().as_secs_f64(),
        bitrate_kbps: tagged
            .properties()
            .audio_bitrate()
            .map(|value| value as i32),
        sample_rate_hz: tagged.properties().sample_rate().map(|value| value as i32),
        bit_depth: tagged.properties().bit_depth().map(|value| value as i32),
        cover,
    })
}

fn normalized(value: &str) -> String {
    value.trim().to_lowercase()
}
fn cover_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("preview")
        .join("music")
}

fn local_lrc(path: &str) -> Option<String> {
    std::fs::read_to_string(PathBuf::from(path).with_extension("lrc"))
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[derive(Debug, Clone)]
pub struct MetadataCandidate {
    pub provider: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub score: u8,
}

pub trait MusicMetadataProvider: Send + Sync {
    fn search<'a>(
        &'a self,
        title: &'a str,
        artist: Option<&'a str>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Vec<MetadataCandidate>, String>> + Send + 'a>,
    >;
}

pub struct MusicBrainzProvider;
#[derive(Deserialize)]
struct MusicBrainzResult {
    recordings: Vec<MusicBrainzRecording>,
}
#[derive(Deserialize)]
struct MusicBrainzRecording {
    title: String,
    score: Option<u8>,
    #[serde(rename = "artist-credit")]
    artists: Option<Vec<MusicBrainzArtist>>,
    releases: Option<Vec<MusicBrainzRelease>>,
}
#[derive(Deserialize)]
struct MusicBrainzArtist {
    name: String,
}
#[derive(Deserialize)]
struct MusicBrainzRelease {
    title: String,
    date: Option<String>,
}
impl MusicMetadataProvider for MusicBrainzProvider {
    fn search<'a>(
        &'a self,
        title: &'a str,
        artist: Option<&'a str>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Vec<MetadataCandidate>, String>> + Send + 'a>,
    > {
        Box::pin(async move {
            let mut query = format!("recording:\"{title}\"");
            if let Some(artist) = artist.filter(|value| !value.trim().is_empty()) {
                query.push_str(&format!(" AND artist:\"{artist}\""));
            }
            let response = reqwest::Client::new()
                .get("https://musicbrainz.org/ws/2/recording/")
                .header("User-Agent", "Mengnex/0.1 metadata matcher")
                .query(&[
                    ("query", query),
                    ("fmt", "json".to_owned()),
                    ("limit", "5".to_owned()),
                ])
                .send()
                .await
                .map_err(|error| error.to_string())?
                .error_for_status()
                .map_err(|error| error.to_string())?
                .json::<MusicBrainzResult>()
                .await
                .map_err(|error| error.to_string())?;
            Ok(response
                .recordings
                .into_iter()
                .map(|item| MetadataCandidate {
                    provider: "musicbrainz".to_owned(),
                    title: item.title,
                    artist: item
                        .artists
                        .and_then(|items| items.first().map(|item| item.name.clone())),
                    album: item
                        .releases
                        .as_ref()
                        .and_then(|items| items.first().map(|item| item.title.clone())),
                    year: item.releases.and_then(|items| {
                        items
                            .first()
                            .and_then(|item| item.date.as_deref())
                            .and_then(|date| date.get(0..4))
                            .and_then(|year| year.parse().ok())
                    }),
                    score: item.score.unwrap_or(0),
                })
                .collect())
        })
    }
}

pub async fn metadata_candidates(title: &str, artist: Option<&str>) -> Vec<MetadataCandidate> {
    let providers: Vec<Box<dyn MusicMetadataProvider>> = vec![Box::new(MusicBrainzProvider)];
    let mut candidates = Vec::new();
    for provider in providers {
        if let Ok(mut items) = provider.search(title, artist).await {
            candidates.append(&mut items);
        }
    }
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.score));
    candidates
}

pub async fn generate_library_music_metadata(
    db: &DatabaseConnection,
    library: &media_library::Model,
    task_id: &str,
) -> Result<PreviewOperationSummary, ApiError> {
    let tracks = music_track::Entity::find()
        .filter(music_track::Column::LibraryId.eq(&library.id))
        .all(db)
        .await?;
    let mut summary = PreviewOperationSummary {
        total_operations: tracks.len() as i64,
        ..Default::default()
    };
    for track in tracks {
        wait_for_task_permit(db, task_id).await?;
        let Some(file) = media_file::Entity::find_by_id(&track.file_id)
            .one(db)
            .await?
        else {
            continue;
        };
        let materialized =
            sources::materialize_media_file_for_derivative(db, library, &file).await?;
        let audio_path = materialized.path.clone();
        let source_path = file.full_path.clone();
        let parsed = tokio::task::spawn_blocking(move || parse_audio(audio_path))
            .await
            .map_err(|error| {
                ApiError::BadRequest(format!("audio metadata worker failed: {error}"))
            })?;
        summary.processed_assets += 1;
        match parsed {
            Ok(mut parsed) => {
                if let Some(lyrics) = local_lrc(&source_path) {
                    parsed.lyrics = Some(lyrics);
                    parsed.lyrics_source = Some("lrc".to_owned());
                }
                let album_title = parsed
                    .album
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let artist = parsed
                    .artist
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let album_artist = parsed.album_artist.as_deref().or(artist);
                let album_id = if let Some(album_title) = album_title {
                    Some(
                        upsert_album(
                            db,
                            library,
                            album_title,
                            album_artist,
                            parsed.year,
                            parsed.cover.as_deref(),
                        )
                        .await?,
                    )
                } else {
                    None
                };
                let track_id = track.id.clone();
                let mut active: music_track::ActiveModel = track.into();
                if let Some(title) = parsed.title.filter(|value| !value.trim().is_empty()) {
                    active.title = Set(title);
                }
                active.artist = Set(artist.map(str::to_owned));
                active.album_artist = Set(album_artist.map(str::to_owned));
                active.album_title = Set(album_title.map(str::to_owned));
                active.album_id = Set(album_id);
                active.track_number = Set(parsed.track);
                active.disc_number = Set(parsed.disc);
                active.year = Set(parsed.year);
                active.genre = Set(parsed.genre);
                active.composer = Set(parsed.composer);
                active.lyricist = Set(parsed.lyricist);
                active.producer = Set(parsed.producer);
                active.duration_seconds = Set((parsed.duration > 0.0).then_some(parsed.duration));
                active.bitrate_kbps = Set(parsed.bitrate_kbps);
                active.sample_rate_hz = Set(parsed.sample_rate_hz);
                active.bit_depth = Set(parsed.bit_depth);
                active.lyrics = Set(parsed.lyrics);
                active.lyrics_source = Set(parsed.lyrics_source);
                active.metadata_status = Set("ready".to_owned());
                active.metadata_error = Set(None);
                active.analyzed_at = Set(Some(Utc::now()));
                active.updated_at = Set(Utc::now());
                active.update(db).await?;
                sync_track_artists(db, &track_id, artist, "primary").await?;
                sync_track_artists(
                    db,
                    &track_id,
                    parsed.album_artist.as_deref(),
                    "album_artist",
                )
                .await?;
                summary.generated_previews += 1;
            }
            Err(error) => {
                let mut active: music_track::ActiveModel = track.into();
                active.metadata_status = Set("failed".to_owned());
                active.metadata_error = Set(Some(error.clone()));
                active.updated_at = Set(Utc::now());
                active.update(db).await?;
                summary.failed_assets += 1;
                summary.last_error = Some(error.clone());
                summary.errors.push(error);
            }
        }
    }
    refresh_album_counts(db, &library.id).await?;
    Ok(summary)
}

async fn sync_track_artists(
    db: &DatabaseConnection,
    track_id: &str,
    artist_value: Option<&str>,
    role: &str,
) -> Result<(), ApiError> {
    music_track_artist::Entity::delete_many()
        .filter(music_track_artist::Column::TrackId.eq(track_id))
        .filter(music_track_artist::Column::Role.eq(role))
        .exec(db)
        .await?;
    let Some(value) = artist_value else {
        return Ok(());
    };
    for (position, name) in artist_names(value).into_iter().enumerate() {
        let normalized_name = normalized(name);
        let artist = if let Some(existing) = music_artist::Entity::find()
            .filter(music_artist::Column::NormalizedName.eq(&normalized_name))
            .one(db)
            .await?
        {
            existing
        } else {
            music_artist::ActiveModel {
                id: Set(Uuid::new_v4().to_string()),
                normalized_name: Set(normalized_name),
                display_name: Set(name.to_owned()),
                created_at: Set(Utc::now()),
                updated_at: Set(Utc::now()),
            }
            .insert(db)
            .await?
        };
        music_track_artist::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            track_id: Set(track_id.to_owned()),
            artist_id: Set(artist.id),
            role: Set(role.to_owned()),
            position: Set(position as i32),
        }
        .insert(db)
        .await?;
    }
    Ok(())
}

fn artist_names(value: &str) -> Vec<&str> {
    value
        .split([',', ';', '/', '、'])
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect()
}

async fn upsert_album(
    db: &DatabaseConnection,
    library: &media_library::Model,
    title: &str,
    artist: Option<&str>,
    year: Option<i32>,
    cover: Option<&[u8]>,
) -> Result<String, ApiError> {
    let artist = artist.unwrap_or("").to_owned();
    let key = normalized(title);
    let existing = music_album::Entity::find()
        .filter(music_album::Column::LibraryId.eq(&library.id))
        .filter(music_album::Column::NormalizedTitle.eq(&key))
        .filter(music_album::Column::Artist.eq(Some(artist.clone())))
        .one(db)
        .await?;
    let (id, mut active) = if let Some(value) = existing {
        let id = value.id.clone();
        (id, music_album::ActiveModel::from(value))
    } else {
        let id = Uuid::new_v4().to_string();
        (
            id.clone(),
            music_album::ActiveModel {
                id: Set(id.clone()),
                library_id: Set(library.id.clone()),
                title: Set(title.to_owned()),
                normalized_title: Set(key),
                artist: Set(Some(artist.clone())),
                year: Set(year),
                cover_rel_path: Set(None),
                track_count: Set(0),
                created_at: Set(Utc::now()),
                updated_at: Set(Utc::now()),
            },
        )
    };
    if let Some(bytes) = cover.filter(|bytes| !bytes.is_empty()) {
        let extension = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            "png"
        } else if bytes.starts_with(b"RIFF") && bytes.windows(4).any(|part| part == b"WEBP") {
            "webp"
        } else if bytes.starts_with(b"GIF8") {
            "gif"
        } else {
            "jpg"
        };
        let rel = format!("music/{id}.{extension}");
        let path = cover_root().join(format!("{id}.{extension}"));
        tokio::fs::create_dir_all(cover_root()).await?;
        tokio::fs::write(path, bytes).await?;
        active.cover_rel_path = Set(Some(rel));
    }
    active.title = Set(title.to_owned());
    active.artist = Set(Some(artist));
    active.year = Set(year);
    active.updated_at = Set(Utc::now());
    active.save(db).await?;
    Ok(id)
}

async fn refresh_album_counts(db: &DatabaseConnection, library_id: &str) -> Result<(), ApiError> {
    let active_item_ids = crate::infra::entities::media_item::Entity::find()
        .filter(crate::infra::entities::media_item::Column::LibraryId.eq(library_id))
        .filter(crate::infra::entities::media_item::Column::DeletedAt.is_null())
        .filter(crate::infra::entities::media_item::Column::SourceMissingAt.is_null())
        .all(db)
        .await?
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();
    let albums = music_album::Entity::find()
        .filter(music_album::Column::LibraryId.eq(library_id))
        .all(db)
        .await?;
    for album in albums {
        let count = music_track::Entity::find()
            .filter(music_track::Column::AlbumId.eq(&album.id))
            .filter(music_track::Column::ItemId.is_in(active_item_ids.clone()))
            .count(db)
            .await? as i64;
        if count == 0 {
            if let Some(relative) = album.cover_rel_path.as_deref()
                && let Some(file_name) = relative.rsplit('/').next()
            {
                let _ = tokio::fs::remove_file(cover_root().join(file_name)).await;
            }
            music_album::Entity::delete_by_id(album.id).exec(db).await?;
            continue;
        }
        let mut active: music_album::ActiveModel = album.into();
        active.track_count = Set(count);
        active.updated_at = Set(Utc::now());
        active.update(db).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{artist_names, normalized};

    #[test]
    fn normalizes_artist_identity_and_preserves_multiple_credits() {
        assert_eq!(normalized("  Artist  "), "artist");
        assert_eq!(artist_names("A / B、C; D"), vec!["A", "B", "C", "D"]);
    }

    #[test]
    fn rejects_oversized_embedded_cover() {
        let bytes = vec![0_u8; 8 * 1024 * 1024 + 1];
        assert!(bytes.len() > 8 * 1024 * 1024);
    }
}
