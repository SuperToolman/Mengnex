"use client";

import { Check, PlayFill, Video } from "@gravity-ui/icons";
import { Button, Card, Chip, Tooltip } from "@heroui/react";
import Image from "next/image";
import type { VideoAssetResponse } from "@/src/api/client";

function formatDuration(seconds?: number | null) {
    if (!seconds) return "--:--";
    const value = Math.floor(seconds);
    const minutes = Math.floor(value / 60);
    return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}:` : ""}${String(minutes % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export default function VideoCard({ video, onOpen }: { video: VideoAssetResponse; onOpen: () => void }) {
    const progress = video.duration_seconds && video.duration_seconds > 0
        ? Math.min(100, Math.max(0, (video.playback_position_seconds / video.duration_seconds) * 100))
        : 0;

    return (
        <div className="group overflow-hidden transition-transform duration-200 hover:-translate-y-0.5">
            <Card className="relative aspect-video overflow-hidden bg-black">
                {video.poster_src ? (
                    <Image fill unoptimized alt={`${video.title} 封面`} src={video.poster_src} sizes="(min-width: 2560px) 14vw, (min-width: 1920px) 17vw, (min-width: 1536px) 20vw, (min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                ) : null}
                {!video.poster_src ? (
                    <div className="absolute inset-0 grid place-items-center bg-surface-secondary text-muted"><Video className="h-8 w-8" /></div>
                ) : null}
                <div className="absolute bottom-2 right-2">
                    <Chip size="sm" className="bg-black/75 text-white">{formatDuration(video.duration_seconds)}</Chip>
                </div>
                {video.playback_completed && !video.collection_id ? (
                    <Chip size="sm" color="success" className="absolute left-2 top-2 gap-1"><Check className="h-3 w-3" />已看完</Chip>
                ) : null}
                {video.collection_id ? (
                    <Chip size="sm" color="accent" className="absolute left-2 top-2">
                        集合 · {video.collection_member_count ?? 0} 个视频
                    </Chip>
                ) : null}
                {progress > 0 && !video.playback_completed ? (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25"><div className="h-full bg-accent" style={{ width: `${progress}%` }} /></div>
                ) : null}
            </Card>

            <div className="min-w-0 space-y-2 py-3">
                <h3 className="line-clamp-2 min-h-10 text-sm leading-5">{video.title}</h3>
                <p className="flex min-w-0 items-center gap-2">
                    <Chip size="sm" variant="soft">{video.container?.toUpperCase() ?? "VIDEO"}</Chip>
                    <span className="truncate text-xs text-muted">{video.video_codec ?? (video.analysis_status === "ready" ? "未知编码" : "等待分析")}</span>
                    {video.width && video.height ? <span className="ml-auto shrink-0 text-xs text-muted">{video.width}×{video.height}</span> : null}
                </p>
            </div>

            <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs text-muted">
                    {progress > 0 && !video.playback_completed ? `已观看 ${Math.round(progress)}%` : video.playback_completed ? "播放完成" : "尚未观看"}
                </span>
                <Tooltip>
                    <Tooltip.Trigger>
                        <Button size="sm" variant="primary" isIconOnly aria-label={progress > 0 ? "继续播放" : "播放视频"} onPress={onOpen}>
                            <PlayFill className="h-4 w-4" />
                        </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>{progress > 0 ? "继续播放" : "播放视频"}</Tooltip.Content>
                </Tooltip>
            </div>
        </div>
    );
}
