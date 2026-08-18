"use client";

import { Heart, HeartFill, MusicNote, PlayFill, Xmark } from "@gravity-ui/icons";
import { Alert, Button, Card, Chip, SearchField, Skeleton, Tabs, Tooltip } from "@heroui/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import ContentZoomSlider from "@/app/components/ContentZoomSlider";
import { getMediaLibraries, type LibraryResponse } from "@/src/api/client";
import { browseMusicTracks, getMusicAlbum, getMusicAlbums, getMusicArtists, getMusicFolders, getMusicFavorites, getMusicPlaylists, getMusicRecent, getMusicStats, updateMusicFavorite, type MusicFolder, type MusicLibraryStats } from "@/src/features/music/api";
import type { MusicAlbumDetailResponse, MusicAlbumResponse, MusicArtistResponse, MusicPlaylistResponse, MusicTrackResponse } from "@/src/api/generated/types.gen";
import { useMusicPlayer } from "@/app/components/MusicPlayerProvider";

export default function MusicPage() {
    const player = useMusicPlayer();
    const [albums, setAlbums] = useState<MusicAlbumResponse[]>([]);
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [libraryId, setLibraryId] = useState("all");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<MusicAlbumDetailResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<"home" | "albums" | "tracks" | "artists" | "favorites" | "recent" | "playlists" | "folders">("home");
    const [tracks, setTracks] = useState<MusicTrackResponse[]>([]);
    const [artists, setArtists] = useState<MusicArtistResponse[]>([]);
    const [playlists, setPlaylists] = useState<MusicPlaylistResponse[]>([]);
    const [zoom, setZoom] = useState(1);
    const [stats, setStats] = useState<MusicLibraryStats | null>(null);
    const [folders, setFolders] = useState<MusicFolder[]>([]);
    const [genre, setGenre] = useState<string | undefined>();
    const [year, setYear] = useState<number | undefined>();
    const [sort, setSort] = useState<"title" | "artist" | "year" | "duration" | undefined>();
    const [albumOffset, setAlbumOffset] = useState(0);
    const [trackOffset, setTrackOffset] = useState(0);

    useEffect(() => {
        void getMediaLibraries().then((items) => setLibraries(items.filter((item) => item.media_type === "music"))).catch((cause) => setError(cause instanceof Error ? cause.message : "媒体库加载失败"));
    }, []);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void getMusicAlbums({ libraryId: libraryId === "all" ? undefined : libraryId, search: query.trim() || undefined, limit: 48, offset: albumOffset }).then((items) => { if (!cancelled) setAlbums(items); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "音乐加载失败"); }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [libraryId, query, albumOffset]);
    useEffect(() => { void getMusicStats(libraryId === "all" ? undefined : libraryId).then(setStats).catch(() => undefined); }, [libraryId]);
    useEffect(() => {
        if (view === "albums") return;
        if (view === "home") {
            void getMusicRecent().then((items) => setTracks(items)).catch((cause) => setError(cause instanceof Error ? cause.message : "最近播放加载失败"));
            return;
        }
        if (view === "folders") { void getMusicFolders(libraryId === "all" ? undefined : libraryId).then(setFolders).catch((cause) => setError(cause instanceof Error ? cause.message : "文件夹加载失败")); return; }
        const request = view === "tracks" ? browseMusicTracks({ libraryId: libraryId === "all" ? undefined : libraryId, search: query.trim() || undefined, genre, year, sort, limit: 50, offset: trackOffset })
            : view === "favorites" ? getMusicFavorites() : view === "recent" ? getMusicRecent() : view === "artists" ? getMusicArtists({ libraryId: libraryId === "all" ? undefined : libraryId }) : getMusicPlaylists();
        void request.then((items) => {
            if (view === "artists") setArtists(items as MusicArtistResponse[]);
            else if (view === "playlists") setPlaylists(items as MusicPlaylistResponse[]);
            else setTracks(items as MusicTrackResponse[]);
        }).catch((cause) => setError(cause instanceof Error ? cause.message : "音乐内容加载失败"));
    }, [view, libraryId, query, genre, year, sort, trackOffset]);

    async function openAlbum(id: string) {
        try { setSelected(await getMusicAlbum(id)); } catch (cause) { setError(cause instanceof Error ? cause.message : "专辑加载失败"); }
    }

    const search = <SearchField value={query} onChange={setQuery} aria-label="搜索音乐" className="w-full"><SearchField.Group className="h-9"><SearchField.SearchIcon /><SearchField.Input placeholder="搜索歌曲、专辑" /><SearchField.ClearButton /></SearchField.Group></SearchField>;
    const libraryOptions = [{ id: "all", label: "全部媒体库" }, ...libraries.map((item) => ({ id: item.id, label: item.name }))];

    const tabs = [["home", "首页"], ["albums", "专辑"], ["tracks", "歌曲"], ["artists", "艺人"], ["folders", "文件夹"], ["favorites", "收藏"], ["recent", "最近播放"], ["playlists", "歌单"]] as const;
    const gridClassName = ["grid-cols-2 sm:grid-cols-3 lg:grid-cols-4", "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6", "grid-cols-3 sm:grid-cols-5 lg:grid-cols-8"][zoom];
    return <ContentPageLayout title="音乐" description={`${albums.length} 张专辑`} center={search} actions={<select aria-label="选择音乐媒体库" value={libraryId} onChange={(event) => setLibraryId(event.target.value)} className="max-w-44">{libraryOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>} footer={<ContentZoomSlider value={zoom} labels={["舒适", "标准", "紧凑"]} onChange={setZoom} ariaLabel="调整专辑网格密度" label="密度" />}>
        <Tabs.Root aria-label="音乐视图" selectedKey={view} onSelectionChange={(key) => { setSelected(null); setView(key as typeof view); }} className="px-4 pt-1"><Tabs.ListContainer><Tabs.List>{tabs.map(([id, label]) => <Tabs.Tab key={id} id={id}>{label}<Tabs.Indicator /></Tabs.Tab>)}</Tabs.List></Tabs.ListContainer></Tabs.Root>
        {error ? <Alert status="danger" className="m-4"><Alert.Indicator /><Alert.Content><Alert.Title>音乐加载失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
        {selected ? <AlbumDetail detail={selected} onClose={() => setSelected(null)} onPlay={(track) => player.play(track, selected.tracks)} /> : null}
        {!selected && loading ? <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 12 }).map((_, index) => <div key={index} className="space-y-2"><Skeleton className="aspect-square w-full rounded-lg" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-3/5" /></div>)}</div> : null}
        {!selected && !loading && albums.length === 0 ? <ContentPageEmptyState message={query ? "没有匹配的音乐。" : "创建音乐媒体库并扫描后，专辑会显示在这里。"} /> : null}
        {!selected && view === "home" ? <HomeSections albums={albums} recent={tracks} stats={stats} gridClassName={gridClassName} onAlbum={openAlbum} onPlay={(track) => player.play(track, tracks)} /> : null}
        {!selected && view === "albums" && !loading && albums.length > 0 ? <><div className={`grid gap-4 p-4 ${gridClassName}`}>{albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={openAlbum} />)}</div><Pagination offset={albumOffset} pageSize={48} hasNext={albums.length === 48} onChange={setAlbumOffset} /></> : null}
        {!selected && view === "tracks" ? <><FilterBar stats={stats} genre={genre} year={year} sort={sort} onGenre={(value) => { setGenre(value); setTrackOffset(0); }} onYear={(value) => { setYear(value); setTrackOffset(0); }} onSort={(value) => { setSort(value); setTrackOffset(0); }} /><TrackList tracks={tracks} onPlay={(track) => player.play(track, tracks)} /><Pagination offset={trackOffset} pageSize={50} hasNext={tracks.length === 50} onChange={setTrackOffset} /></> : null}
        {!selected && ["favorites", "recent"].includes(view) ? <TrackList tracks={tracks} onPlay={(track) => player.play(track, tracks)} /> : null}
        {!selected && view === "artists" ? <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{artists.map((artist) => <Card.Root key={artist.id}><Link href={`/music/artist/${encodeURIComponent(artist.id)}`}><Card.Content><Card.Title>{artist.name}</Card.Title><Card.Description>{artist.album_count} 张专辑 · {artist.track_count} 首歌曲</Card.Description></Card.Content></Link></Card.Root>)}</div> : null}
        {!selected && view === "playlists" ? <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{playlists.map((playlist) => <Card.Root key={playlist.id}><Card.Content><Card.Title>{playlist.name}</Card.Title><Card.Description>{playlist.track_count} 首歌曲</Card.Description></Card.Content></Card.Root>)}</div> : null}
        {!selected && view === "folders" ? <Card.Root className="m-4"><Card.Content className="divide-y divide-divider p-0">{folders.map((folder) => <Card.Root key={folder.path} variant="secondary"><Card.Content><Card.Title className="break-all text-sm">{folder.path || "媒体库根目录"}</Card.Title><Card.Description>{folder.track_count} 首歌曲</Card.Description></Card.Content></Card.Root>)}</Card.Content></Card.Root> : null}
    </ContentPageLayout>;
}

function AlbumCard({ album, onOpen }: { album: MusicAlbumResponse; onOpen: (id: string) => void }) {
    return <Button variant="secondary" className="h-auto min-w-0 overflow-hidden p-0 text-left" onPress={() => void onOpen(album.id)}><span className="w-full"><span className="relative block aspect-square bg-surface-secondary">{album.cover_src ? <Image src={album.cover_src} alt="" fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw" className="object-cover" /> : <span className="flex h-full items-center justify-center text-muted"><MusicNote className="h-10 w-10" /></span>}</span><span className="block space-y-1 p-3"><span className="block truncate text-sm font-medium">{album.title}</span><span className="block truncate text-xs text-muted">{album.artist ?? "未知艺人"} · {album.track_count} 首</span></span></span></Button>;
}

function TrackList({ tracks, onPlay }: { tracks: MusicTrackResponse[]; onPlay: (track: MusicTrackResponse) => void }) {
    if (tracks.length === 0) return <ContentPageEmptyState message="暂无歌曲。" />;
    return <Card.Root className="m-4 overflow-hidden"><Card.Content className="divide-y divide-divider p-0">{tracks.map((track, index) => <Button key={track.id} variant="ghost" fullWidth className="h-auto justify-start gap-3 rounded-none px-3 py-3 text-left" onPress={() => onPlay(track)}><span className="w-6 text-right text-xs text-muted">{track.track_number ?? index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{track.title}</span><span className="block truncate text-xs text-muted">{track.artist ?? track.album_title ?? "未知艺人"}</span></span><span className="text-xs text-muted">{formatDuration(track.duration_seconds)}</span><PlayFill className="h-4 w-4 text-accent" /></Button>)}</Card.Content></Card.Root>;
}

function HomeSections({ albums, recent, stats, gridClassName, onAlbum, onPlay }: { albums: MusicAlbumResponse[]; recent: MusicTrackResponse[]; stats: MusicLibraryStats | null; gridClassName: string; onAlbum: (id: string) => void; onPlay: (track: MusicTrackResponse) => void }) {
    return <div className="space-y-6 p-4">{stats ? <div className="flex flex-wrap gap-2"><Chip variant="soft">{stats.track_count} 首歌曲</Chip><Chip variant="soft">{stats.album_count} 张专辑</Chip><Chip variant="soft">{stats.artist_count} 位艺人</Chip><Chip variant="soft">{formatDuration(stats.total_duration_seconds)}</Chip></div> : null}<section><h3 className="mb-3 text-base font-semibold">最近添加</h3><div className={`grid gap-4 ${gridClassName}`}>{albums.slice(0, 6).map((album) => <AlbumCard key={album.id} album={album} onOpen={onAlbum} />)}</div></section>{recent.length > 0 ? <section><h3 className="mb-3 text-base font-semibold">最近播放</h3><TrackList tracks={recent.slice(0, 8)} onPlay={onPlay} /></section> : null}</div>;
}

function FilterBar({ stats, genre, year, sort, onGenre, onYear, onSort }: { stats: MusicLibraryStats | null; genre?: string; year?: number; sort?: "title" | "artist" | "year" | "duration"; onGenre: (value: string | undefined) => void; onYear: (value: number | undefined) => void; onSort: (value: "title" | "artist" | "year" | "duration" | undefined) => void }) {
    return <div className="flex flex-wrap items-center gap-2 px-4 pt-4"><Button size="sm" variant={genre ? "secondary" : "primary"} onPress={() => onGenre(undefined)}>全部流派</Button>{stats?.genres.slice(0, 8).map((value) => <Button key={value} size="sm" variant={genre === value ? "primary" : "secondary"} onPress={() => onGenre(genre === value ? undefined : value)}>{value}</Button>)}<Button size="sm" variant={year ? "secondary" : "primary"} onPress={() => onYear(undefined)}>全部年份</Button>{stats?.years.slice(-8).reverse().map((value) => <Button key={value} size="sm" variant={year === value ? "primary" : "secondary"} onPress={() => onYear(year === value ? undefined : value)}>{value}</Button>)}<Button size="sm" variant="ghost" onPress={() => onSort(sort === "title" ? undefined : "title")}>按标题</Button><Button size="sm" variant="ghost" onPress={() => onSort(sort === "year" ? undefined : "year")}>按年份</Button><Button size="sm" variant="ghost" onPress={() => onSort(sort === "duration" ? undefined : "duration")}>按时长</Button></div>;
}

function Pagination({ offset, pageSize, hasNext, onChange }: { offset: number; pageSize: number; hasNext: boolean; onChange: (offset: number) => void }) {
    return <div className="flex justify-end gap-2 px-4 pb-4"><Button size="sm" variant="secondary" isDisabled={offset === 0} onPress={() => onChange(Math.max(0, offset - pageSize))}>上一页</Button><Button size="sm" variant="secondary" isDisabled={!hasNext} onPress={() => onChange(offset + pageSize)}>下一页</Button></div>;
}

function AlbumDetail({ detail, onClose, onPlay }: { detail: MusicAlbumDetailResponse; onClose: () => void; onPlay: (track: MusicTrackResponse) => void }) {
    const [favorites, setFavorites] = useState(() => new Set(detail.tracks.filter((track) => track.is_favorite).map((track) => track.id)));
    async function toggleFavorite(track: MusicTrackResponse) {
        const next = !favorites.has(track.id);
        setFavorites((value) => { const result = new Set(value); if (next) result.add(track.id); else result.delete(track.id); return result; });
        try { await updateMusicFavorite(track.id, { favorite: next }); } catch { setFavorites((value) => { const result = new Set(value); if (next) result.delete(track.id); else result.add(track.id); return result; }); }
    }
    const artistName = detail.album.artist ?? "未知艺人";
    const artistHref = `/music/artist/${encodeURIComponent(artistName.trim().toLowerCase())}`;
    return <section className="absolute inset-0 z-10 overflow-auto bg-background p-4 pb-24"><div className="mb-5 flex items-center justify-between"><div><Button size="sm" variant="ghost" onPress={onClose}>返回专辑</Button><h2 className="mt-2 text-2xl font-semibold">{detail.album.title}</h2><p className="text-sm text-muted"><Link href={artistHref}>{artistName}</Link>{detail.album.year ? ` · ${detail.album.year}` : ""}</p></div><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label="关闭专辑详情" onPress={onClose}><Xmark /></Button></Tooltip.Trigger><Tooltip.Content>关闭</Tooltip.Content></Tooltip></div><Card.Root><Card.Content className="divide-y divide-divider p-0">{detail.tracks.map((track, index) => <div key={track.id} className="flex items-center gap-1"><Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-none px-3 py-3 text-left" onPress={() => onPlay(track)}><span className="w-6 text-right text-xs text-muted">{track.track_number ?? index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{track.title}</span><span className="block truncate text-xs text-muted">{track.artist ?? detail.album.artist ?? "未知艺人"}</span><span className="block truncate text-xs text-muted">{formatQuality(track)}</span></span><span className="text-xs text-muted">{formatDuration(track.duration_seconds)}</span><PlayFill className="h-4 w-4 shrink-0 text-accent" /></Button><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={favorites.has(track.id) ? "取消收藏" : "收藏歌曲"} onPress={() => void toggleFavorite(track)}>{favorites.has(track.id) ? <HeartFill className="text-danger" /> : <Heart />}</Button></Tooltip.Trigger><Tooltip.Content>{favorites.has(track.id) ? "取消收藏" : "收藏歌曲"}</Tooltip.Content></Tooltip></div>)}</Card.Content></Card.Root></section>;
}

function formatDuration(value?: number | null) { if (!value) return "--:--"; return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`; }
function formatQuality(track: MusicTrackResponse) { return [track.codec?.toUpperCase(), track.bitrate_kbps ? `${track.bitrate_kbps} kbps` : undefined, track.sample_rate_hz ? `${Math.round(track.sample_rate_hz / 100) / 10} kHz` : undefined, track.bit_depth ? `${track.bit_depth} bit` : undefined].filter(Boolean).join(" · "); }
