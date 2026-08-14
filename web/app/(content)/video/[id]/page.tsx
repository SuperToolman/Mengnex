"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, CircleInfo } from "@gravity-ui/icons";
import { Button, Card, Chip } from "@heroui/react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVideo, updateVideoPlayback, type VideoAssetResponse, type VideoDetailResponse } from "@/src/api/client";

function formatDuration(seconds?: number | null) {
    if (!seconds) return "--:--";
    const value = Math.floor(seconds);
    const hours = Math.floor(value / 3600);
    return `${hours ? `${hours}:` : ""}${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function VideoPlayerPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const player = useRef<HTMLVideoElement>(null);
    const lastSavedPosition = useRef(0);
    const pendingSwitchTime = useRef<number | null>(null);
    const [detail, setDetail] = useState<VideoDetailResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [playbackError, setPlaybackError] = useState<string | null>(null);

    useEffect(() => {
        let canceled = false;
        setDetail(null);
        setError(null);
        setPlaybackError(null);
        void getVideo(params.id).then((value) => {
            if (!canceled) setDetail(value);
        }).catch((cause) => {
            if (!canceled) setError(cause instanceof Error ? cause.message : "视频详情加载失败");
        });
        return () => { canceled = true; };
    }, [params.id]);

    const saveProgress = useCallback((completed = false) => {
        const element = player.current;
        if (!element || !Number.isFinite(element.currentTime)) return;
        const position = element.currentTime;
        const duration = Number.isFinite(element.duration) ? element.duration : detail?.duration_seconds;
        if (!completed && Math.abs(position - lastSavedPosition.current) < 2) return;
        lastSavedPosition.current = position;
        void updateVideoPlayback(params.id, {
            position_seconds: position,
            duration_seconds: duration ?? undefined,
            completed,
        }).catch(() => undefined);
    }, [detail?.duration_seconds, params.id]);

    useEffect(() => {
        const interval = window.setInterval(() => saveProgress(false), 5000);
        const onVisibilityChange = () => { if (document.visibilityState === "hidden") saveProgress(false); };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            saveProgress(false);
        };
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
        if (detail.playback_completed) return;
        const saved = detail.playback_position_seconds;
        if (saved > 2 && saved < element.duration - 10) {
            element.currentTime = saved;
            lastSavedPosition.current = saved;
        }
    }

    function switchCollectionMember(member: VideoAssetResponse) {
        const element = player.current;
        pendingSwitchTime.current = element && Number.isFinite(element.currentTime)
            ? element.currentTime
            : detail?.playback_position_seconds ?? 0;
        saveProgress(false);
        router.replace(`/video/${member.id}`);
    }

    if (error) return <div className="flex h-full items-center justify-center p-6"><Card.Root className="max-w-lg"><Card.Content className="space-y-4 p-6"><p className="text-sm text-red-500">{error}</p><Button onPress={() => router.push("/video")}>返回视频库</Button></Card.Content></Card.Root></div>;
    if (!detail) return <div className="flex h-full items-center justify-center text-sm text-muted">正在加载视频...</div>;

    const codec = [detail.video_codec, detail.audio_codec].filter(Boolean).join(" / ") || "尚未分析";
    return <div className="h-full overflow-auto bg-[#08090b] text-white">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-white/10 bg-black/85 px-4 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3"><Button isIconOnly variant="ghost" aria-label="返回视频库" onPress={() => router.push("/video")}><ArrowLeft className="h-5 w-5" /></Button><div className="min-w-0"><p className="truncate text-sm font-medium">{detail.title}</p><p className="truncate text-xs text-white/55">{detail.library_name}</p></div></div>
            <div className="flex items-center gap-1"><Button isIconOnly variant="ghost" aria-label="上一个视频" isDisabled={!detail.previous_video_id} onPress={() => detail.previous_video_id && router.push(`/video/${detail.previous_video_id}`)}><ChevronLeft className="h-5 w-5" /></Button><Button isIconOnly variant="ghost" aria-label="下一个视频" isDisabled={!detail.next_video_id} onPress={() => detail.next_video_id && router.push(`/video/${detail.next_video_id}`)}><ChevronRight className="h-5 w-5" /></Button></div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-6">
            <section className="relative flex min-h-[240px] items-center justify-center overflow-hidden bg-black sm:min-h-[420px]">
                <video ref={player} key={detail.id} src={detail.stream_src} poster={detail.poster_src ?? undefined} controls autoPlay playsInline preload="metadata" className="max-h-[76vh] w-full bg-black object-contain" onLoadedMetadata={restoreProgress} onPause={() => saveProgress(false)} onEnded={() => saveProgress(true)} onError={() => setPlaybackError("当前浏览器无法播放此视频。可能是容器或音视频编码不受支持，也可能是源文件暂时不可访问。")} />
            </section>
            {playbackError || detail.source_missing ? <div className="mt-3 flex items-start gap-2 border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200"><CircleInfo className="mt-0.5 h-4 w-4 shrink-0" /><span>{detail.source_missing ? "源文件当前不可用，请重新扫描媒体库或检查远程连接。" : playbackError}</span></div> : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                <section className="min-w-0"><h1 className="break-words text-xl font-semibold sm:text-2xl">{detail.title}</h1><div className="mt-3 flex flex-wrap gap-2"><Chip size="sm" variant="soft">{detail.container?.toUpperCase() ?? "VIDEO"}</Chip><Chip size="sm" variant="soft">{formatDuration(detail.duration_seconds)}</Chip>{detail.width && detail.height ? <Chip size="sm" variant="soft">{detail.width} x {detail.height}</Chip> : null}{detail.playback_completed ? <Chip size="sm" color="success" variant="soft">已看完</Chip> : detail.playback_position_seconds > 0 ? <Chip size="sm" color="accent" variant="soft">续播至 {formatDuration(detail.playback_position_seconds)}</Chip> : null}</div><p className="mt-5 break-all text-sm leading-6 text-white/55">{detail.source_path}</p></section>
                <Card.Root className="border border-white/10 bg-white/5 shadow-none"><Card.Content className="space-y-3 p-4 text-sm"><div className="flex justify-between gap-4"><span className="text-white/50">文件</span><span className="truncate text-right">{detail.file_name}</span></div><div className="flex justify-between gap-4"><span className="text-white/50">大小</span><span>{formatBytes(detail.file_size)}</span></div><div className="flex justify-between gap-4"><span className="text-white/50">编码</span><span className="text-right">{codec}</span></div><div className="flex justify-between gap-4"><span className="text-white/50">分辨率</span><span>{detail.width && detail.height ? `${detail.width} x ${detail.height}` : "尚未分析"}</span></div>{detail.analysis_error ? <p className="border-t border-white/10 pt-3 text-xs leading-5 text-amber-300">分析失败：{detail.analysis_error}</p> : null}</Card.Content></Card.Root>
            </div>
            {detail.collection ? (
                <section className="mt-8 border-t border-white/10 pt-6">
                    <div className="flex items-end justify-between gap-4">
                        <div>
                            <h2 className="text-base font-semibold">{detail.collection.title}</h2>
                            <p className="mt-1 text-xs text-white/50">差异视频集合 · {detail.collection.members.length} 个视频</p>
                        </div>
                        <span className="text-xs text-white/45">切换时保持当前播放时间</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {detail.collection.members.map((member) => {
                            const active = member.id === detail.id;
                            return (
                                <button
                                    key={member.id}
                                    type="button"
                                    className={`overflow-hidden rounded-lg border text-left transition ${active ? "border-sky-400 bg-sky-400/10" : "border-white/10 bg-white/5 hover:border-white/25"}`}
                                    onClick={() => !active && switchCollectionMember(member)}
                                >
                                    <div className="relative aspect-video overflow-hidden bg-black">
                                        {member.poster_src ? <Image src={member.poster_src} alt={`${member.title} 封面`} fill sizes="240px" unoptimized className="object-cover" /> : <div className="grid h-full place-items-center text-xs text-white/35">暂无封面</div>}
                                        {active ? <Chip size="sm" color="accent" className="absolute left-2 top-2">正在播放</Chip> : null}
                                    </div>
                                    <div className="p-2.5">
                                        <p className="truncate text-sm font-medium">{member.title}</p>
                                        <p className="mt-1 text-xs text-white/45">{formatDuration(member.duration_seconds)}</p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>
            ) : null}
            <Link href="/video" className="mt-8 inline-flex text-sm text-sky-400 hover:text-sky-300">返回全部视频</Link>
        </main>
    </div>;
}
