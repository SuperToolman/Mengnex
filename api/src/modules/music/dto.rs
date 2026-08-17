use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::entities::{music_album, music_track};

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct MusicTrackResponse {
    pub id: String,
    pub file_id: String,
    pub library_id: String,
    pub album_id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album_title: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration_seconds: Option<f64>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub codec: Option<String>,
    pub bitrate_kbps: Option<i32>,
    pub sample_rate_hz: Option<i32>,
    pub bit_depth: Option<i32>,
    pub stream_src: String,
    pub playback_position_seconds: f64,
    pub playback_completed: bool,
    pub is_favorite: bool,
}

impl From<music_track::Model> for MusicTrackResponse {
    fn from(value: music_track::Model) -> Self {
        Self {
            stream_src: format!("/api/media/files/{}/content", value.file_id),
            id: value.id,
            file_id: value.file_id,
            library_id: value.library_id,
            album_id: value.album_id,
            title: value.title,
            artist: value.artist,
            album_artist: value.album_artist,
            album_title: value.album_title,
            track_number: value.track_number,
            disc_number: value.disc_number,
            duration_seconds: value.duration_seconds,
            genre: value.genre,
            year: value.year,
            codec: value.codec,
            bitrate_kbps: value.bitrate_kbps,
            sample_rate_hz: value.sample_rate_hz,
            bit_depth: value.bit_depth,
            playback_position_seconds: 0.0,
            playback_completed: false,
            is_favorite: false,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicLyricsResponse {
    pub track_id: String,
    pub source: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicMetadataCandidateResponse {
    pub provider: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub score: u8,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicLibraryStatsResponse {
    pub track_count: u64,
    pub album_count: u64,
    pub artist_count: u64,
    pub total_duration_seconds: f64,
    pub genres: Vec<String>,
    pub years: Vec<i32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicFolderResponse {
    pub path: String,
    pub track_count: u64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct MusicAlbumResponse {
    pub id: String,
    pub library_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub year: Option<i32>,
    pub track_count: i64,
    pub cover_src: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

impl From<music_album::Model> for MusicAlbumResponse {
    fn from(value: music_album::Model) -> Self {
        let cover_src = value.cover_rel_path.as_ref().map(|_| {
            format!(
                "/api/music/albums/{}/cover?v={}",
                value.id,
                value.updated_at.timestamp()
            )
        });
        Self {
            id: value.id,
            library_id: value.library_id,
            title: value.title,
            artist: value.artist,
            year: value.year,
            track_count: value.track_count,
            cover_src,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicAlbumDetailResponse {
    pub album: MusicAlbumResponse,
    pub tracks: Vec<MusicTrackResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicArtistResponse {
    pub id: String,
    pub name: String,
    pub track_count: u64,
    pub album_count: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicArtistDetailResponse {
    pub artist: MusicArtistResponse,
    pub tracks: Vec<MusicTrackResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicFavoriteResponse {
    pub track_id: String,
    pub is_favorite: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateMusicFavoriteRequest {
    pub favorite: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateMusicPlaylistRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicPlaylistResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub track_count: u64,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicPlaylistDetailResponse {
    pub playlist: MusicPlaylistResponse,
    pub tracks: Vec<MusicTrackResponse>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddMusicPlaylistTrackRequest {
    pub track_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateMusicPlaybackRequest {
    pub position_seconds: f64,
    pub completed: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MusicPlaybackResponse {
    pub track_id: String,
    pub position_seconds: f64,
    pub completed: bool,
    #[schema(value_type = String, format = DateTime)]
    pub last_played_at: DateTime<Utc>,
}
