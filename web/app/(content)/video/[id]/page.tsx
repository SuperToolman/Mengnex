"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, CircleInfo } from "@gravity-ui/icons";
import { Alert, Avatar, Button, Card, Chip, Spinner } from "@heroui/react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthor, getVideo, updateVideoPlayback, type AuthorDetailResponse, type VideoAssetResponse, type VideoDetailResponse } from "@/src/api/client";
import VideoPlayer from "../components/VideoPlayer";

function formatDuration(seconds?: number | null) {
    if (!seconds || seconds < 0) return "--:--";
    const value = Math.floor(seconds);
    const hours = Math.floor(value / 3600);
    return `${hours ? `${hours}:` : ""}${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(value: string) {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function VideoCollectionList({
    collection,
    activeId,
    isSwitching,
    onSelect,
}: {
    collection: NonNullable<VideoDetailResponse["collection"]>;
    activeId: string;
    isSwitching: boolean;
    onSelect: (member: VideoAssetResponse) => void | Promise<void>;
}) {
    return (
        <section className="mt-7 border-t border-divider pt-5">
            <div className="flex items-end justify-between gap-3"><div><h2 className="text-sm font-semibold">{collection.title}</h2><p className="mt-1 text-xs text-muted">{collection.members.length} 个视频</p></div><span className="text-xs text-muted">集合</span></div>
            <div className="mt-3 space-y-1" aria-label={`${collection.title} 视频列表`}>
                {collection.members.map((member) => {
                    const active = member.id === activeId;
                    return <Button key={member.id} type="button" variant="ghost" isDisabled={active || isSwitching} aria-current={active ? "true" : undefined} onPress={() => void onSelect(member)} className={`h-auto w-full justify-start gap-3 rounded-lg border p-2 text-left transition ${active ? "border-accent bg-accent/10" : "border-divider hover:border-foreground/30"}`}><div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded bg-black">{member.poster_src ? <Image src={member.poster_src} alt={`${member.title} 封面`} fill sizes="112px" unoptimized className="object-cover" /> : <div className="grid h-full place-items-center text-xs text-muted">无封面</div>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm">{member.title}</p><p className="mt-1 text-xs text-muted">{formatDuration(member.duration_seconds)}{active ? " · 正在播放" : ""}</p></div></Button>;
                })}
            </div>
        </section>
    );
}

export default function VideoPlayerPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const player = useRef<HTMLVideoElement>(null);
    const lastSavedPosition = useRef(0);
    const pendingSwitchTime = useRef<number | null>(null);
    const [detail, setDetail] = useState<VideoDetailResponse | null>(null);
    const [author, setAuthor] = useState<AuthorDetailResponse | null>(null);
    const [isAuthorLoading, setIsAuthorLoading] = useState(false);
    const [isSwitchingVideo, setIsSwitchingVideo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [playbackError, setPlaybackError] = useState<string | null>(null);

    useEffect(() => {
        let canceled = false;
        setDetail(null);
        setError(null);
        setPlaybackError(null);
        void getVideo(params.id).then((value) => { if (!canceled) setDetail(value); }).catch((cause) => {
            if (!canceled) setError(cause instanceof Error ? cause.message : "视频详情加载失败");
        });
        return () => { canceled = true; };
    }, [params.id]);

    useEffect(() => {
        let canceled = false;
        setAuthor(null);
        setIsAuthorLoading(Boolean(detail?.author_id));
        if (!detail?.author_id) return;
        void getAuthor(detail.author_id).then((value) => { if (!canceled) setAuthor(value); }).catch(() => undefined).finally(() => { if (!canceled) setIsAuthorLoading(false); });
        return () => { canceled = true; };
    }, [detail?.author_id]);

    const saveProgress = useCallback((completed = false) => {
        const element = player.current;
        if (!element || !Number.isFinite(element.currentTime)) return;
        const position = element.currentTime;
        const duration = Number.isFinite(element.duration) ? element.duration : detail?.duration_seconds;
        if (!completed && Math.abs(position - lastSavedPosition.current) < 2) return;
        lastSavedPosition.current = position;
        void updateVideoPlayback(params.id, { position_seconds: position, duration_seconds: duration ?? undefined, completed }).catch(() => undefined);
    }, [detail?.duration_seconds, params.id]);

    useEffect(() => {
        const interval = window.setInterval(() => saveProgress(false), 5000);
        const onVisibilityChange = () => { if (document.visibilityState === "hidden") saveProgress(false); };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibilityChange); saveProgress(false); };
    }, [saveProgress]);

    function restoreProgress() {
        const element = player.current;
        if (!element || !detail) return;
        if (pendingSwitchTime.current !== null) {
            element.currentTime = Math.min(pendingSwitchTime.current, Math.max(0, element.duration - 0.1));
            lastSavedPosition.current = element.currentTime;
            pendingSwitchTime.current = null;
            void element.play().catch(() => undefined);
            return;
        }
        if (!detail.playback_completed && detail.playback_position_seconds > 2 && detail.playback_position_seconds < element.duration - 10) {
            element.currentTime = detail.playback_position_seconds;
            lastSavedPosition.current = detail.playback_position_seconds;
        }
    }

    async function switchCollectionMember(member: VideoAssetResponse) {
        if (!detail || member.id === detail.id || isSwitchingVideo) return;
        const element = player.current;
        pendingSwitchTime.current = element && Number.isFinite(element.currentTime) ? element.currentTime : detail?.playback_position_seconds ?? 0;
        saveProgress(false);
        setIsSwitchingVideo(true);
        try {
            const nextDetail = await getVideo(member.id);
            window.history.replaceState(null, "", `/video/${member.id}`);
            setPlaybackError(null);
            setDetail(nextDetail);
        } catch {
            pendingSwitchTime.current = null;
        } finally {
            setIsSwitchingVideo(false);
        }
    }

    if (error) return <div className="flex h-screen items-center justify-center p-6"><Card.Root className="max-w-lg"><Card.Content className="space-y-4 p-6"><Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert><Button onPress={() => router.push("/video")}>返回视频库</Button></Card.Content></Card.Root></div>;
    if (!detail) return <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted"><Spinner size="sm" />正在加载视频...</div>;

    const codec = [detail.video_codec, detail.audio_codec].filter(Boolean).join(" / ") || "尚未分析";
    const resolution = detail.width && detail.height ? `${detail.width} × ${detail.height}` : "尚未分析";
    return (
        <div className="flex h-[100dvh] w-full flex-col gap-3 overflow-hidden p-3 lg:flex-row">
            <Card className="min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
                <VideoPlayer ref={player} src={detail.stream_src} poster={detail.poster_src} autoPlay onLoadedMetadata={restoreProgress} onPause={() => saveProgress(false)} onEnded={() => saveProgress(true)} onError={() => setPlaybackError("当前浏览器无法播放此视频，可能是编码或源文件不可用。")} />
            </Card>

            <Card className="min-h-0 w-full overflow-hidden lg:w-[500px] lg:shrink-0">
                <div className="flex h-full min-h-0 flex-col">
                    <div className="flex items-center justify-between gap-3 border-b border-divider p-4">
                        <Button size="sm" variant="ghost" onPress={() => router.push("/video")}><ArrowLeft className="h-4 w-4" />返回视频库</Button>
                        <div className="flex gap-1">
                            <Button size="sm" variant="ghost" isIconOnly aria-label="上一个视频" isDisabled={!detail.previous_video_id} onPress={() => detail.previous_video_id && router.replace(`/video/${detail.previous_video_id}`)}><ChevronLeft /></Button>
                            <Button size="sm" variant="ghost" isIconOnly aria-label="下一个视频" isDisabled={!detail.next_video_id} onPress={() => detail.next_video_id && router.replace(`/video/${detail.next_video_id}`)}><ChevronRight /></Button>
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                        <h1 className="break-words text-xl font-semibold leading-7">{detail.title}</h1>
                        <div className="mt-3 flex flex-wrap gap-2"><Chip size="sm" variant="soft">{detail.container?.toUpperCase() ?? "VIDEO"}</Chip><Chip size="sm" variant="soft">{formatDuration(detail.duration_seconds)}</Chip><Chip size="sm" variant="soft">{resolution}</Chip>{detail.playback_completed ? <Chip size="sm" color="success" variant="soft">已看完</Chip> : detail.playback_position_seconds > 0 ? <Chip size="sm" color="accent" variant="soft">继续播放 {formatDuration(detail.playback_position_seconds)}</Chip> : null}</div>
                        {playbackError || detail.source_missing ? <Alert className="mt-5" status="danger"><Alert.Indicator><CircleInfo /></Alert.Indicator><Alert.Content><Alert.Description>{detail.source_missing ? "源文件当前不可用，请重新扫描媒体库或检查远程连接。" : playbackError}</Alert.Description></Alert.Content></Alert> : null}
                        <section className="mt-6 space-y-3"><h2 className="text-sm font-semibold">作者</h2><Card.Root variant="secondary"><Card.Content className="flex items-center gap-3 p-4"><Avatar size="lg">{author?.avatar_src ? <Avatar.Image src={author.avatar_src} alt={author.name} /> : null}<Avatar.Fallback>{author?.name.slice(0, 2) ?? "未知"}</Avatar.Fallback></Avatar><div className="min-w-0"><p className="truncate text-sm font-medium">{author?.name ?? (isAuthorLoading ? "正在加载作者..." : "未知作者")}</p><p className="mt-1 text-xs text-muted">{author ? `${author.resource_count} 个关联资源` : isAuthorLoading ? "来自作者库" : "未关联作者"}</p></div></Card.Content></Card.Root></section>
                        <section className="mt-6 space-y-3"><h2 className="text-sm font-semibold">文件信息</h2><Card.Root variant="secondary"><Card.Content className="p-4 text-sm"><div className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-3"><span className="text-muted">创建时间</span><span className="text-right">{formatDate(detail.created_at)}</span><span className="text-muted">文件名</span><span className="break-all text-right">{detail.file_name}</span><span className="text-muted">大小</span><span className="text-right">{formatBytes(detail.file_size)}</span><span className="text-muted">编码</span><span className="break-words text-right">{codec}</span><span className="text-muted">分辨率</span><span className="text-right">{resolution}</span><span className="text-muted">媒体库</span><span className="truncate text-right">{detail.library_name}</span></div>{detail.analysis_error ? <p className="mt-3 border-t border-divider pt-3 text-xs leading-5 text-warning">分析失败：{detail.analysis_error}</p> : null}</Card.Content></Card.Root><p className="break-all text-xs leading-5 text-muted">{detail.source_path}</p></section>
                        {detail.collection ? <VideoCollectionList collection={detail.collection} activeId={detail.id} isSwitching={isSwitchingVideo} onSelect={switchCollectionMember} /> : null}
                    </div>
                </div>
            </Card>
        </div>
    );
}
