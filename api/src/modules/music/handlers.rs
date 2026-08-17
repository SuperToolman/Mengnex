use std::collections::HashMap;

use axum::{
    Json,
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    core::{app::AppState, error::ApiError},
    infra::entities::{
        app_setting, media_file, music_album, music_artist, music_favorite, music_playback_state,
        music_playlist, music_playlist_track, music_track, music_track_artist,
    },
    modules::{
        auth::service::CurrentUser,
        music::dto::{
            AddMusicPlaylistTrackRequest, CreateMusicPlaylistRequest, MusicAlbumDetailResponse,
            MusicAlbumResponse, MusicArtistDetailResponse, MusicArtistResponse,
            MusicFavoriteResponse, MusicFolderResponse, MusicLibraryStatsResponse,
            MusicLyricsResponse, MusicMetadataCandidateResponse, MusicPlaybackResponse,
            MusicPlaylistDetailResponse, MusicPlaylistResponse, MusicTrackResponse,
            UpdateMusicFavoriteRequest, UpdateMusicPlaybackRequest,
        },
    },
};
use tokio::process::Command;
use tokio_util::io::ReaderStream;

#[derive(Debug, Deserialize)]
pub struct MusicListQuery {
    pub library_id: Option<String>,
    pub search: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub album_artist: Option<String>,
    pub sort: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MusicStreamQuery {
    pub format: Option<String>,
    pub bitrate_kbps: Option<u32>,
}

fn apply_track_filters(
    mut select: sea_orm::Select<music_track::Entity>,
    query: &MusicListQuery,
) -> sea_orm::Select<music_track::Entity> {
    if let Some(search) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        select = select.filter(
            Condition::any()
                .add(music_track::Column::Title.contains(search))
                .add(music_track::Column::Artist.contains(search))
                .add(music_track::Column::AlbumTitle.contains(search))
                .add(music_track::Column::Genre.contains(search)),
        );
    }
    if let Some(genre) = query
        .genre
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        select = select.filter(music_track::Column::Genre.eq(genre));
    }
    if let Some(year) = query.year {
        select = select.filter(music_track::Column::Year.eq(year));
    }
    if let Some(artist) = query
        .album_artist
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        select = select.filter(music_track::Column::AlbumArtist.contains(artist));
    }
    select
}

fn permitted_library_ids(current: &CurrentUser) -> Option<Vec<String>> {
    current.library_ids.clone()
}
fn bounded_limit(value: Option<u64>, default: u64) -> u64 {
    value.unwrap_or(default).clamp(1, 200)
}

#[utoipa::path(get, path = "/api/music/albums", params(("library_id" = Option<String>, Query), ("search" = Option<String>, Query), ("limit" = Option<u64>, Query), ("offset" = Option<u64>, Query)), responses((status = 200, body = [MusicAlbumResponse])), tag = "music")]
pub async fn list_albums(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<MusicListQuery>,
) -> Result<Json<Vec<MusicAlbumResponse>>, ApiError> {
    let mut select = music_album::Entity::find();
    if let Some(ids) = permitted_library_ids(&current) {
        select = select.filter(music_album::Column::LibraryId.is_in(ids));
    }
    if let Some(id) = query.library_id {
        select = select.filter(music_album::Column::LibraryId.eq(id));
    }
    if let Some(search) = query.search.filter(|value| !value.trim().is_empty()) {
        select = select.filter(
            Condition::any()
                .add(music_album::Column::Title.contains(search.trim()))
                .add(music_album::Column::Artist.contains(search.trim())),
        );
    }
    if let Some(year) = query.year {
        select = select.filter(music_album::Column::Year.eq(year));
    }
    if let Some(artist) = query
        .album_artist
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        select = select.filter(music_album::Column::Artist.contains(artist));
    }
    select = match query.sort.as_deref() {
        Some("title") => select.order_by_asc(music_album::Column::Title),
        Some("artist") => select.order_by_asc(music_album::Column::Artist),
        Some("year") => select.order_by_desc(music_album::Column::Year),
        _ => select.order_by_desc(music_album::Column::UpdatedAt),
    };
    Ok(Json(
        select
            .limit(bounded_limit(query.limit, 60))
            .offset(query.offset.unwrap_or_default())
            .all(&state.db)
            .await?
            .into_iter()
            .map(MusicAlbumResponse::from)
            .collect(),
    ))
}

#[utoipa::path(get, path = "/api/music/albums/{id}", params(("id" = String, Path)), responses((status = 200, body = MusicAlbumDetailResponse)), tag = "music")]
pub async fn get_album(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<MusicAlbumDetailResponse>, ApiError> {
    let album = music_album::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music album"))?;
    if !current.can_access_library(&album.library_id) {
        return Err(ApiError::NotFound("music album"));
    }
    let states = playback_map(&state.db, &current.id).await?;
    let favorite_ids = favorite_track_ids(&state.db, &current.id).await?;
    let tracks = music_track::Entity::find()
        .filter(music_track::Column::AlbumId.eq(&album.id))
        .order_by_asc(music_track::Column::DiscNumber)
        .order_by_asc(music_track::Column::TrackNumber)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|track| with_playback_and_favorite(track, &states, &favorite_ids))
        .collect();
    Ok(Json(MusicAlbumDetailResponse {
        album: album.into(),
        tracks,
    }))
}

#[utoipa::path(get, path = "/api/music/albums/{id}/cover", params(("id" = String, Path)), responses((status = 200, description = "Album cover")), tag = "music")]
pub async fn get_album_cover(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let album = music_album::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music album"))?;
    if !current.can_access_library(&album.library_id) {
        return Err(ApiError::NotFound("music album"));
    }
    let relative = album
        .cover_rel_path
        .ok_or(ApiError::NotFound("music album cover"))?;
    let file_name = relative
        .rsplit('/')
        .next()
        .ok_or(ApiError::NotFound("music album cover"))?;
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("preview")
        .join("music")
        .join(file_name);
    let bytes = tokio::fs::read(path).await?;
    let content_type = if file_name.ends_with(".png") {
        "image/png"
    } else if file_name.ends_with(".webp") {
        "image/webp"
    } else if file_name.ends_with(".gif") {
        "image/gif"
    } else {
        "image/jpeg"
    };
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "private, max-age=604800, immutable"),
        ],
        bytes,
    )
        .into_response())
}

#[utoipa::path(get, path = "/api/music/tracks", params(("library_id" = Option<String>, Query), ("search" = Option<String>, Query), ("limit" = Option<u64>, Query), ("offset" = Option<u64>, Query)), responses((status = 200, body = [MusicTrackResponse])), tag = "music")]
pub async fn list_tracks(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<MusicListQuery>,
) -> Result<Json<Vec<MusicTrackResponse>>, ApiError> {
    let mut select = music_track::Entity::find();
    if let Some(ids) = permitted_library_ids(&current) {
        select = select.filter(music_track::Column::LibraryId.is_in(ids));
    }
    if let Some(id) = query.library_id.as_deref() {
        select = select.filter(music_track::Column::LibraryId.eq(id));
    }
    select = apply_track_filters(select, &query);
    select = match query.sort.as_deref() {
        Some("title") => select.order_by_asc(music_track::Column::Title),
        Some("artist") => select.order_by_asc(music_track::Column::Artist),
        Some("year") => select.order_by_desc(music_track::Column::Year),
        Some("duration") => select.order_by_desc(music_track::Column::DurationSeconds),
        _ => select.order_by_desc(music_track::Column::UpdatedAt),
    };
    let states = playback_map(&state.db, &current.id).await?;
    let favorite_ids = favorite_track_ids(&state.db, &current.id).await?;
    Ok(Json(
        select
            .limit(bounded_limit(query.limit, 100))
            .offset(query.offset.unwrap_or_default())
            .all(&state.db)
            .await?
            .into_iter()
            .map(|track| with_playback_and_favorite(track, &states, &favorite_ids))
            .collect(),
    ))
}

#[utoipa::path(get, path = "/api/music/tracks/{id}/stream", params(("id" = String, Path), ("format" = Option<String>, Query), ("bitrate_kbps" = Option<u32>, Query)), responses((status = 200, description = "Transcoded audio stream")), tag = "music")]
pub async fn stream_track(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<MusicStreamQuery>,
) -> Result<Response, ApiError> {
    let track = music_track::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music track"))?;
    if !current.can_access_library(&track.library_id) {
        return Err(ApiError::NotFound("music track"));
    }
    let file = media_file::Entity::find_by_id(track.file_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("media file"))?;
    if file.source_locator.is_some() {
        return Err(ApiError::BadRequest(
            "remote music transcoding is not enabled yet".to_owned(),
        ));
    }
    let format = match query.format.as_deref() {
        Some("opus") => "opus",
        _ => "aac",
    };
    let bitrate = query.bitrate_kbps.unwrap_or(192).clamp(64, 320);
    let command = app_setting::Entity::find_by_id("default")
        .one(&state.db)
        .await?
        .map(|value| value.video_ffmpeg_command)
        .unwrap_or_else(|| "ffmpeg".to_owned());
    let mut child = Command::new(command)
        .args([
            "-v",
            "error",
            "-i",
            &file.full_path,
            "-vn",
            "-c:a",
            if format == "opus" { "libopus" } else { "aac" },
            "-b:a",
            &format!("{bitrate}k"),
            "-f",
            if format == "opus" { "ogg" } else { "adts" },
            "pipe:1",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| ApiError::BadRequest(format!("ffmpeg is unavailable: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::BadRequest("ffmpeg stdout unavailable".to_owned()))?;
    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                if format == "opus" {
                    "audio/ogg"
                } else {
                    "audio/aac"
                },
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        Body::from_stream(ReaderStream::new(stdout)),
    )
        .into_response())
}

#[utoipa::path(get, path = "/api/music/tracks/{id}/metadata-candidates", params(("id" = String, Path)), responses((status = 200, body = [MusicMetadataCandidateResponse])), tag = "music")]
pub async fn metadata_candidates(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<MusicMetadataCandidateResponse>>, ApiError> {
    let track = music_track::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music track"))?;
    if !current.can_access_library(&track.library_id) {
        return Err(ApiError::NotFound("music track"));
    }
    let candidates =
        crate::modules::music::service::metadata_candidates(&track.title, track.artist.as_deref())
            .await;
    Ok(Json(
        candidates
            .into_iter()
            .map(|item| MusicMetadataCandidateResponse {
                provider: item.provider,
                title: item.title,
                artist: item.artist,
                album: item.album,
                year: item.year,
                score: item.score,
            })
            .collect(),
    ))
}

#[utoipa::path(get, path = "/api/music/tracks/{id}/lyrics", params(("id" = String, Path)), responses((status = 200, body = MusicLyricsResponse)), tag = "music")]
pub async fn get_lyrics(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<MusicLyricsResponse>, ApiError> {
    let track = music_track::Entity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music track"))?;
    if !current.can_access_library(&track.library_id) {
        return Err(ApiError::NotFound("music track"));
    }
    Ok(Json(MusicLyricsResponse {
        track_id: track.id,
        source: track.lyrics_source,
        content: track.lyrics,
    }))
}

#[utoipa::path(get, path = "/api/music/stats", params(("library_id" = Option<String>, Query)), responses((status = 200, body = MusicLibraryStatsResponse)), tag = "music")]
pub async fn get_stats(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<MusicListQuery>,
) -> Result<Json<MusicLibraryStatsResponse>, ApiError> {
    let mut select = music_track::Entity::find();
    if let Some(ids) = permitted_library_ids(&current) {
        select = select.filter(music_track::Column::LibraryId.is_in(ids));
    }
    if let Some(id) = query.library_id {
        select = select.filter(music_track::Column::LibraryId.eq(id));
    }
    let tracks = select.all(&state.db).await?;
    let genres = tracks
        .iter()
        .filter_map(|track| track.genre.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let years = tracks
        .iter()
        .filter_map(|track| track.year)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let albums = tracks
        .iter()
        .filter_map(|track| track.album_id.as_ref())
        .collect::<std::collections::HashSet<_>>()
        .len() as u64;
    let artists = tracks
        .iter()
        .filter_map(|track| track.artist.as_ref())
        .collect::<std::collections::HashSet<_>>()
        .len() as u64;
    Ok(Json(MusicLibraryStatsResponse {
        track_count: tracks.len() as u64,
        album_count: albums,
        artist_count: artists,
        total_duration_seconds: tracks
            .iter()
            .filter_map(|track| track.duration_seconds)
            .sum(),
        genres,
        years,
    }))
}

#[utoipa::path(get, path = "/api/music/folders", params(("library_id" = Option<String>, Query)), responses((status = 200, body = [MusicFolderResponse])), tag = "music")]
pub async fn list_folders(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<MusicListQuery>,
) -> Result<Json<Vec<MusicFolderResponse>>, ApiError> {
    let mut tracks = music_track::Entity::find();
    if let Some(ids) = permitted_library_ids(&current) {
        tracks = tracks.filter(music_track::Column::LibraryId.is_in(ids));
    }
    if let Some(id) = query.library_id {
        tracks = tracks.filter(music_track::Column::LibraryId.eq(id));
    }
    let file_ids = tracks
        .all(&state.db)
        .await?
        .into_iter()
        .map(|track| track.file_id)
        .collect::<Vec<_>>();
    if file_ids.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let mut folders = HashMap::<String, u64>::new();
    for file in media_file::Entity::find()
        .filter(media_file::Column::Id.is_in(file_ids))
        .all(&state.db)
        .await?
    {
        let path = std::path::Path::new(&file.full_path)
            .parent()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .replace('\\', "/");
        *folders.entry(path).or_default() += 1;
    }
    let mut response = folders
        .into_iter()
        .map(|(path, track_count)| MusicFolderResponse { path, track_count })
        .collect::<Vec<_>>();
    response.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(Json(response))
}

#[utoipa::path(get, path = "/api/music/artists", params(("library_id" = Option<String>, Query)), responses((status = 200, body = [MusicArtistResponse])), tag = "music")]
pub async fn list_artists(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Query(query): Query<MusicListQuery>,
) -> Result<Json<Vec<MusicArtistResponse>>, ApiError> {
    let mut select = music_track::Entity::find();
    if let Some(ids) = permitted_library_ids(&current) {
        select = select.filter(music_track::Column::LibraryId.is_in(ids));
    }
    if let Some(id) = query.library_id {
        select = select.filter(music_track::Column::LibraryId.eq(id));
    }
    let mut artists: HashMap<String, (u64, std::collections::HashSet<String>)> = HashMap::new();
    for track in select.all(&state.db).await? {
        if let Some(artist) = track.artist.filter(|value| !value.trim().is_empty()) {
            let entry = artists
                .entry(artist)
                .or_insert_with(|| (0, std::collections::HashSet::new()));
            entry.0 += 1;
            if let Some(album_id) = track.album_id {
                entry.1.insert(album_id);
            }
        }
    }
    let mut values = artists
        .into_iter()
        .map(|(name, (track_count, albums))| MusicArtistResponse {
            id: name.clone(),
            name,
            track_count,
            album_count: albums.len() as u64,
        })
        .collect::<Vec<_>>();
    values.sort_by_key(|value| value.name.to_lowercase());
    Ok(Json(values))
}

#[utoipa::path(get, path = "/api/music/artists/{id}", params(("id" = String, Path)), responses((status = 200, body = MusicArtistDetailResponse)), tag = "music")]
pub async fn get_artist(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<MusicArtistDetailResponse>, ApiError> {
    let artist = music_artist::Entity::find()
        .filter(music_artist::Column::NormalizedName.eq(id))
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music artist"))?;
    let mut track_select = music_track::Entity::find();
    if let Some(ids) = current.library_ids.clone() {
        track_select = track_select.filter(music_track::Column::LibraryId.is_in(ids));
    }
    let track_ids = music_track_artist::Entity::find()
        .filter(music_track_artist::Column::ArtistId.eq(&artist.id))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|link| link.track_id)
        .collect::<Vec<_>>();
    if track_ids.is_empty() {
        return Ok(Json(MusicArtistDetailResponse {
            artist: MusicArtistResponse {
                id: artist.normalized_name,
                name: artist.display_name,
                track_count: 0,
                album_count: 0,
            },
            tracks: Vec::new(),
        }));
    }
    let tracks = track_select
        .filter(music_track::Column::Id.is_in(track_ids))
        .order_by_asc(music_track::Column::AlbumTitle)
        .order_by_asc(music_track::Column::TrackNumber)
        .all(&state.db)
        .await?;
    let album_count = tracks
        .iter()
        .filter_map(|track| track.album_id.as_ref())
        .collect::<std::collections::HashSet<_>>()
        .len() as u64;
    let states = playback_map(&state.db, &current.id).await?;
    let response_tracks = tracks
        .into_iter()
        .map(|track| with_playback(track, &states))
        .collect::<Vec<_>>();
    Ok(Json(MusicArtistDetailResponse {
        artist: MusicArtistResponse {
            id: artist.normalized_name,
            name: artist.display_name,
            track_count: response_tracks.len() as u64,
            album_count,
        },
        tracks: response_tracks,
    }))
}

#[utoipa::path(get, path = "/api/music/favorites", responses((status = 200, body = [MusicTrackResponse])), tag = "music")]
pub async fn list_favorites(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<MusicTrackResponse>>, ApiError> {
    let favorites = music_favorite::Entity::find()
        .filter(music_favorite::Column::UserId.eq(&current.id))
        .order_by_desc(music_favorite::Column::CreatedAt)
        .all(&state.db)
        .await?;
    let favorite_ids = favorites
        .iter()
        .map(|favorite| favorite.track_id.clone())
        .collect::<Vec<_>>();
    if favorite_ids.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let states = playback_map(&state.db, &current.id).await?;
    let mut tracks = music_track::Entity::find()
        .filter(music_track::Column::Id.is_in(favorite_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|track| {
            let mut response = with_playback(track, &states);
            response.is_favorite = true;
            response
        })
        .collect::<Vec<_>>();
    tracks.sort_by_key(|track| {
        favorites
            .iter()
            .position(|favorite| favorite.track_id == track.id)
            .unwrap_or(usize::MAX)
    });
    Ok(Json(tracks))
}

#[utoipa::path(get, path = "/api/music/recent", responses((status = 200, body = [MusicTrackResponse])), tag = "music")]
pub async fn list_recent(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<MusicTrackResponse>>, ApiError> {
    let recent = music_playback_state::Entity::find()
        .filter(music_playback_state::Column::UserId.eq(&current.id))
        .order_by_desc(music_playback_state::Column::LastPlayedAt)
        .limit(30)
        .all(&state.db)
        .await?;
    let ids = recent
        .iter()
        .map(|state| state.music_track_id.clone())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let states = playback_map(&state.db, &current.id).await?;
    let favorites = favorite_track_ids(&state.db, &current.id).await?;
    let map = music_track::Entity::find()
        .filter(music_track::Column::Id.is_in(ids.clone()))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|track| (track.id.clone(), track))
        .collect::<HashMap<_, _>>();
    let tracks = ids
        .into_iter()
        .filter_map(|id| map.get(&id).cloned())
        .filter(|track| current.can_access_library(&track.library_id))
        .map(|track| with_playback_and_favorite(track, &states, &favorites))
        .collect();
    Ok(Json(tracks))
}

#[utoipa::path(put, path = "/api/music/tracks/{id}/favorite", params(("id" = String, Path)), request_body = UpdateMusicFavoriteRequest, responses((status = 200, body = MusicFavoriteResponse)), tag = "music")]
pub async fn update_favorite(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateMusicFavoriteRequest>,
) -> Result<Json<MusicFavoriteResponse>, ApiError> {
    let track = music_track::Entity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music track"))?;
    if !current.can_access_library(&track.library_id) {
        return Err(ApiError::NotFound("music track"));
    }
    let existing = music_favorite::Entity::find()
        .filter(music_favorite::Column::UserId.eq(&current.id))
        .filter(music_favorite::Column::TrackId.eq(&id))
        .one(&state.db)
        .await?;
    if payload.favorite && existing.is_none() {
        music_favorite::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            user_id: Set(current.id),
            track_id: Set(id.clone()),
            created_at: Set(Utc::now()),
        }
        .insert(&state.db)
        .await?;
    } else if !payload.favorite
        && let Some(existing) = existing
    {
        music_favorite::Entity::delete_by_id(existing.id)
            .exec(&state.db)
            .await?;
    }
    Ok(Json(MusicFavoriteResponse {
        track_id: id,
        is_favorite: payload.favorite,
    }))
}

#[utoipa::path(get, path = "/api/music/playlists", responses((status = 200, body = [MusicPlaylistResponse])), tag = "music")]
pub async fn list_playlists(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<MusicPlaylistResponse>>, ApiError> {
    let playlists = music_playlist::Entity::find()
        .filter(music_playlist::Column::UserId.eq(&current.id))
        .order_by_desc(music_playlist::Column::UpdatedAt)
        .all(&state.db)
        .await?;
    let mut response = Vec::with_capacity(playlists.len());
    for playlist in playlists {
        response.push(playlist_response(&state.db, playlist).await?);
    }
    Ok(Json(response))
}

#[utoipa::path(post, path = "/api/music/playlists", request_body = CreateMusicPlaylistRequest, responses((status = 200, body = MusicPlaylistResponse)), tag = "music")]
pub async fn create_playlist(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateMusicPlaylistRequest>,
) -> Result<Json<MusicPlaylistResponse>, ApiError> {
    let name = payload.name.trim();
    if name.is_empty() || name.len() > 120 {
        return Err(ApiError::BadRequest(
            "playlist name must contain 1 to 120 characters".to_owned(),
        ));
    }
    let now = Utc::now();
    let playlist = music_playlist::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        user_id: Set(current.id),
        name: Set(name.to_owned()),
        description: Set(payload
            .description
            .map(|value| value.trim().chars().take(500).collect())),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await?;
    Ok(Json(playlist_response(&state.db, playlist).await?))
}

#[utoipa::path(get, path = "/api/music/playlists/{id}", params(("id" = String, Path)), responses((status = 200, body = MusicPlaylistDetailResponse)), tag = "music")]
pub async fn get_playlist(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<MusicPlaylistDetailResponse>, ApiError> {
    let playlist = owned_playlist(&state, &current.id, &id).await?;
    let links = music_playlist_track::Entity::find()
        .filter(music_playlist_track::Column::PlaylistId.eq(&id))
        .order_by_asc(music_playlist_track::Column::Position)
        .all(&state.db)
        .await?;
    let states = playback_map(&state.db, &current.id).await?;
    let track_ids = links
        .iter()
        .map(|link| link.track_id.clone())
        .collect::<Vec<_>>();
    let map = music_track::Entity::find()
        .filter(music_track::Column::Id.is_in(track_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|track| (track.id.clone(), track))
        .collect::<HashMap<_, _>>();
    let tracks = links
        .into_iter()
        .filter_map(|link| map.get(&link.track_id).cloned())
        .map(|track| with_playback(track, &states))
        .collect();
    Ok(Json(MusicPlaylistDetailResponse {
        playlist: playlist_response(&state.db, playlist).await?,
        tracks,
    }))
}

#[utoipa::path(delete, path = "/api/music/playlists/{id}", params(("id" = String, Path)), responses((status = 204)), tag = "music")]
pub async fn delete_playlist(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    owned_playlist(&state, &current.id, &id).await?;
    music_playlist_track::Entity::delete_many()
        .filter(music_playlist_track::Column::PlaylistId.eq(&id))
        .exec(&state.db)
        .await?;
    music_playlist::Entity::delete_by_id(id)
        .exec(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/music/playlists/{id}/tracks", params(("id" = String, Path)), request_body = AddMusicPlaylistTrackRequest, responses((status = 204)), tag = "music")]
pub async fn add_playlist_track(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AddMusicPlaylistTrackRequest>,
) -> Result<StatusCode, ApiError> {
    owned_playlist(&state, &current.id, &id).await?;
    let track = music_track::Entity::find_by_id(&payload.track_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music track"))?;
    if !current.can_access_library(&track.library_id) {
        return Err(ApiError::NotFound("music track"));
    }
    if music_playlist_track::Entity::find()
        .filter(music_playlist_track::Column::PlaylistId.eq(&id))
        .filter(music_playlist_track::Column::TrackId.eq(&payload.track_id))
        .one(&state.db)
        .await?
        .is_none()
    {
        let position = music_playlist_track::Entity::find()
            .filter(music_playlist_track::Column::PlaylistId.eq(&id))
            .count(&state.db)
            .await? as i32;
        music_playlist_track::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            playlist_id: Set(id.clone()),
            track_id: Set(payload.track_id),
            position: Set(position),
            added_at: Set(Utc::now()),
        }
        .insert(&state.db)
        .await?;
        let playlist = owned_playlist(&state, &current.id, &id).await?;
        let mut active: music_playlist::ActiveModel = playlist.into();
        active.updated_at = Set(Utc::now());
        active.update(&state.db).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/music/playlists/{id}/tracks/{track_id}", params(("id" = String, Path), ("track_id" = String, Path)), responses((status = 204)), tag = "music")]
pub async fn remove_playlist_track(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path((id, track_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    owned_playlist(&state, &current.id, &id).await?;
    music_playlist_track::Entity::delete_many()
        .filter(music_playlist_track::Column::PlaylistId.eq(&id))
        .filter(music_playlist_track::Column::TrackId.eq(&track_id))
        .exec(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(put, path = "/api/music/tracks/{id}/playback", params(("id" = String, Path)), request_body = UpdateMusicPlaybackRequest, responses((status = 200, body = MusicPlaybackResponse)), tag = "music")]
pub async fn update_playback(
    Extension(current): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateMusicPlaybackRequest>,
) -> Result<Json<MusicPlaybackResponse>, ApiError> {
    let track = music_track::Entity::find_by_id(&id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music track"))?;
    if !current.can_access_library(&track.library_id) {
        return Err(ApiError::NotFound("music track"));
    }
    let now = Utc::now();
    let mut active = music_playback_state::Entity::find()
        .filter(music_playback_state::Column::UserId.eq(&current.id))
        .filter(music_playback_state::Column::MusicTrackId.eq(&id))
        .one(&state.db)
        .await?
        .map(Into::into)
        .unwrap_or(music_playback_state::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            user_id: Set(current.id),
            music_track_id: Set(id.clone()),
            position_seconds: Set(0.0),
            completed: Set(false),
            last_played_at: Set(now),
            created_at: Set(now),
            updated_at: Set(now),
        });
    let position_seconds = payload.position_seconds.max(0.0);
    let completed = payload.completed.unwrap_or(false);
    active.position_seconds = Set(position_seconds);
    active.completed = Set(completed);
    active.last_played_at = Set(now);
    active.updated_at = Set(now);
    active.save(&state.db).await?;
    Ok(Json(MusicPlaybackResponse {
        track_id: id,
        position_seconds,
        completed,
        last_played_at: now,
    }))
}

async fn playback_map(
    db: &sea_orm::DatabaseConnection,
    user_id: &str,
) -> Result<HashMap<String, music_playback_state::Model>, ApiError> {
    Ok(music_playback_state::Entity::find()
        .filter(music_playback_state::Column::UserId.eq(user_id))
        .all(db)
        .await?
        .into_iter()
        .map(|value| (value.music_track_id.clone(), value))
        .collect())
}

async fn favorite_track_ids(
    db: &sea_orm::DatabaseConnection,
    user_id: &str,
) -> Result<std::collections::HashSet<String>, ApiError> {
    Ok(music_favorite::Entity::find()
        .filter(music_favorite::Column::UserId.eq(user_id))
        .all(db)
        .await?
        .into_iter()
        .map(|favorite| favorite.track_id)
        .collect())
}

async fn owned_playlist(
    state: &AppState,
    user_id: &str,
    playlist_id: &str,
) -> Result<music_playlist::Model, ApiError> {
    music_playlist::Entity::find_by_id(playlist_id)
        .filter(music_playlist::Column::UserId.eq(user_id))
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound("music playlist"))
}

async fn playlist_response(
    db: &sea_orm::DatabaseConnection,
    playlist: music_playlist::Model,
) -> Result<MusicPlaylistResponse, ApiError> {
    let track_count = music_playlist_track::Entity::find()
        .filter(music_playlist_track::Column::PlaylistId.eq(&playlist.id))
        .count(db)
        .await?;
    Ok(MusicPlaylistResponse {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        track_count,
        updated_at: playlist.updated_at,
    })
}

fn with_playback(
    track: music_track::Model,
    states: &HashMap<String, music_playback_state::Model>,
) -> MusicTrackResponse {
    let state = states.get(&track.id);
    let mut response = MusicTrackResponse::from(track);
    response.playback_position_seconds = state.map(|value| value.position_seconds).unwrap_or(0.0);
    response.playback_completed = state.is_some_and(|value| value.completed);
    response
}

fn with_playback_and_favorite(
    track: music_track::Model,
    states: &HashMap<String, music_playback_state::Model>,
    favorite_ids: &std::collections::HashSet<String>,
) -> MusicTrackResponse {
    let mut response = with_playback(track, states);
    response.is_favorite = favorite_ids.contains(&response.id);
    response
}
