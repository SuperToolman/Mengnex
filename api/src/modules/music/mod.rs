use axum::{
    Router,
    routing::{delete, get, post, put},
};

use crate::core::app::AppState;

pub mod dto;
pub mod handlers;
pub mod service;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/music/albums", get(handlers::list_albums))
        .route("/api/music/albums/{id}", get(handlers::get_album))
        .route(
            "/api/music/albums/{id}/cover",
            get(handlers::get_album_cover),
        )
        .route("/api/music/artists", get(handlers::list_artists))
        .route("/api/music/artists/{id}", get(handlers::get_artist))
        .route("/api/music/tracks", get(handlers::list_tracks))
        .route("/api/music/tracks/{id}/stream", get(handlers::stream_track))
        .route(
            "/api/music/tracks/{id}/metadata-candidates",
            get(handlers::metadata_candidates),
        )
        .route("/api/music/tracks/{id}/lyrics", get(handlers::get_lyrics))
        .route("/api/music/stats", get(handlers::get_stats))
        .route("/api/music/folders", get(handlers::list_folders))
        .route(
            "/api/music/tracks/{id}/playback",
            put(handlers::update_playback),
        )
        .route(
            "/api/music/tracks/{id}/favorite",
            put(handlers::update_favorite),
        )
        .route("/api/music/favorites", get(handlers::list_favorites))
        .route("/api/music/recent", get(handlers::list_recent))
        .route(
            "/api/music/playlists",
            get(handlers::list_playlists).post(handlers::create_playlist),
        )
        .route(
            "/api/music/playlists/{id}",
            get(handlers::get_playlist).delete(handlers::delete_playlist),
        )
        .route(
            "/api/music/playlists/{id}/tracks",
            post(handlers::add_playlist_track),
        )
        .route(
            "/api/music/playlists/{id}/tracks/{track_id}",
            delete(handlers::remove_playlist_track),
        )
}
