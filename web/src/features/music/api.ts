import {
    addPlaylistTrack,
    createPlaylist,
    getAlbum,
    getArtist,
    getLyrics,
    getPlaylist,
    getStats,
    listAlbums,
    listArtists,
    listFavorites,
    listFolders,
    listPlaylists,
    listRecent,
    listTracks,
    removePlaylistTrack,
    updateFavorite,
    updatePlayback,
} from "@/src/api/generated/sdk.gen";
import type {
    CreateMusicPlaylistRequest,
    MusicFolderResponse,
    MusicLibraryStatsResponse,
    MusicLyricsResponse,
    UpdateMusicFavoriteRequest,
    UpdateMusicPlaybackRequest,
} from "@/src/api/generated/types.gen";
import { API_BASE_URL, execute, sdkOptions, toAbsoluteUrl } from "@/src/api/transport";

export type ListMusicParams = { libraryId?: string; search?: string; limit?: number; offset?: number };
export type MusicBrowseParams = ListMusicParams & { genre?: string; year?: number; albumArtist?: string; sort?: "title" | "artist" | "year" | "duration" };
export type MusicLibraryStats = MusicLibraryStatsResponse;
export type MusicFolder = MusicFolderResponse;
export type MusicLyrics = MusicLyricsResponse;

export async function getMusicAlbums(params?: ListMusicParams) {
    const albums = await execute(listAlbums({ ...sdkOptions, query: { library_id: params?.libraryId, search: params?.search, limit: params?.limit, offset: params?.offset } }));
    return albums.map((album) => ({ ...album, cover_src: toAbsoluteUrl(album.cover_src) }));
}

export async function getMusicAlbum(id: string) {
    const detail = await execute(getAlbum({ ...sdkOptions, path: { id } }));
    return { ...detail, album: { ...detail.album, cover_src: toAbsoluteUrl(detail.album.cover_src) } };
}

export async function getMusicArtists(params?: Pick<ListMusicParams, "libraryId">) { return execute(listArtists({ ...sdkOptions, query: { library_id: params?.libraryId } })); }
export async function getMusicArtist(id: string) { return execute(getArtist({ ...sdkOptions, path: { id } })); }
export async function getMusicTracks(params?: ListMusicParams) { return execute(listTracks({ ...sdkOptions, query: { library_id: params?.libraryId, search: params?.search, limit: params?.limit, offset: params?.offset } })); }
export async function browseMusicTracks(params?: MusicBrowseParams) {
    const query = new URLSearchParams(Object.entries({ library_id: params?.libraryId, search: params?.search, limit: params?.limit, offset: params?.offset, genre: params?.genre, year: params?.year, album_artist: params?.albumArtist, sort: params?.sort }).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)])).toString();
    const response = await fetch(`${API_BASE_URL}/api/music/tracks${query ? `?${query}` : ""}`, { credentials: "include" });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "音乐数据加载失败");
    return response.json() as Promise<import("@/src/api/generated/types.gen").MusicTrackResponse[]>;
}
export async function getMusicStats(libraryId?: string) { return execute(getStats({ ...sdkOptions, query: { library_id: libraryId } })); }
export async function getMusicFolders(libraryId?: string) { return execute(listFolders({ ...sdkOptions, query: { library_id: libraryId } })); }
export async function getMusicLyrics(trackId: string) { return execute(getLyrics({ ...sdkOptions, path: { id: trackId } })); }
export async function updateMusicPlayback(trackId: string, payload: UpdateMusicPlaybackRequest) { return execute(updatePlayback({ ...sdkOptions, path: { id: trackId }, body: payload })); }
export async function getMusicFavorites() { return execute(listFavorites(sdkOptions)); }
export async function getMusicRecent() { return execute(listRecent(sdkOptions)); }
export async function updateMusicFavorite(trackId: string, payload: UpdateMusicFavoriteRequest) { return execute(updateFavorite({ ...sdkOptions, path: { id: trackId }, body: payload })); }
export async function getMusicPlaylists() { return execute(listPlaylists(sdkOptions)); }
export async function createMusicPlaylist(payload: CreateMusicPlaylistRequest) { return execute(createPlaylist({ ...sdkOptions, body: payload })); }
export async function getMusicPlaylist(id: string) { return execute(getPlaylist({ ...sdkOptions, path: { id } })); }
export async function addMusicPlaylistTrack(playlistId: string, trackId: string) { return execute(addPlaylistTrack({ ...sdkOptions, path: { id: playlistId }, body: { track_id: trackId } })); }
export async function removeMusicPlaylistTrack(playlistId: string, trackId: string) { return execute(removePlaylistTrack({ ...sdkOptions, path: { id: playlistId, track_id: trackId } })); }
