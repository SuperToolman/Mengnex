"use client";

import { ArrowLeft, PlayFill } from "@gravity-ui/icons";
import { Alert, Button, Card, Skeleton, Tooltip } from "@heroui/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import { useMusicPlayer } from "@/app/components/MusicPlayerProvider";
import { getMusicArtist } from "@/src/api/client";
import type { MusicArtistDetailResponse, MusicTrackResponse } from "@/src/api/generated/types.gen";

export default function MusicArtistPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const player = useMusicPlayer();
    const [detail, setDetail] = useState<MusicArtistDetailResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getMusicArtist(decodeURIComponent(params.id)).then((value) => { if (!cancelled) setDetail(value); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "艺人加载失败"); });
        return () => { cancelled = true; };
    }, [params.id]);

    return <ContentPageLayout title={detail?.artist.name ?? "艺人"} description={detail ? `${detail.artist.album_count} 张专辑 · ${detail.artist.track_count} 首歌曲` : undefined} actions={<Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label="返回音乐" onPress={() => router.push("/music")}><ArrowLeft /></Button></Tooltip.Trigger><Tooltip.Content>返回音乐</Tooltip.Content></Tooltip>}>
        {error ? <Alert status="danger" className="m-4"><Alert.Indicator /><Alert.Content><Alert.Title>无法加载艺人</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
        {!detail && !error ? <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-md" />)}</div> : null}
        {detail && detail.tracks.length === 0 ? <ContentPageEmptyState message="这个艺人还没有可播放的歌曲。" /> : null}
        {detail && detail.tracks.length > 0 ? <Card.Root className="m-4 overflow-hidden"><Card.Content className="divide-y divide-divider p-0">{detail.tracks.map((track, index) => <TrackRow key={track.id} track={track} index={index} onPlay={() => player.play(track, detail.tracks)} />)}</Card.Content></Card.Root> : null}
    </ContentPageLayout>;
}

function TrackRow({ track, index, onPlay }: { track: MusicTrackResponse; index: number; onPlay: () => void }) {
    return <Button variant="ghost" fullWidth className="h-auto justify-start gap-3 rounded-none px-3 py-3 text-left" onPress={onPlay}><span className="w-6 text-right text-xs text-muted">{track.track_number ?? index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{track.title}</span><span className="block truncate text-xs text-muted">{track.album_title ?? "未知专辑"}</span></span><span className="text-xs text-muted">{formatDuration(track.duration_seconds)}</span><PlayFill className="h-4 w-4 text-accent" /></Button>;
}

function formatDuration(value?: number | null) { return value ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}` : "--:--"; }
