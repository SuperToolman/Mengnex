"use client";

import {
    ArrowsRotateRight,
    BookOpen,
    Books,
    Camera,
    CloudGear,
    CircleInfo,
    EllipsisVertical,
    Filmstrip,
    Folder,
    Gear,
    MusicNote,
    Play,
    Picture,
    Puzzle,
    Stop,
    TrashBin,
    Video,
} from "@gravity-ui/icons";
import { Badge, Button, Card, Chip, Popover } from "@heroui/react";
import Image from "next/image";
import { useState } from "react";
import type { ComponentType, SVGProps } from "react";
import type {
    LibraryResponse,
    MangaSeriesResponse,
    PhotoAssetResponse,
    VideoAssetResponse,
} from "@/src/api/client";

type LibrarieCardProps = {
    library: LibraryResponse;
    coverPhotos?: PhotoAssetResponse[];
    coverManga?: MangaSeriesResponse[];
    coverVideos?: VideoAssetResponse[];
    isBusy?: boolean;
    hasActiveCacheTask?: boolean;
    onRescan?: () => void;
    onGeneratePreviews?: () => void;
    onDeletePreviews?: () => void;
    onAnalyzeVideos?: () => void;
    onRegenerateVideoCovers?: () => void;
    onOpenSettings?: () => void;
    onOpenInfo?: () => void;
    onToggleEnabled?: () => void;
    onDeleteLibrary?: () => void;
};

type MediaTypeStyle = {
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    gradient: string;
    color: "accent" | "success" | "warning" | "danger" | "default";
};

type LibrarySourceStyle = {
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    color: "accent" | "success" | "default";
};

type MenuAction = {
    key: string;
    title: string;
    description: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    disabled?: boolean;
    danger?: boolean;
    onPress?: () => void;
};

const mediaTypeStyles: Record<string, MediaTypeStyle> = {
    photo: {
        label: "照片",
        icon: Picture,
        gradient: "from-sky-200 via-cyan-100 to-emerald-100",
        color: "accent",
    },
    game: {
        label: "游戏",
        icon: Puzzle,
        gradient: "from-lime-200 via-emerald-100 to-teal-100",
        color: "success",
    },
    manga: {
        label: "漫画",
        icon: Books,
        gradient: "from-amber-200 via-orange-100 to-rose-100",
        color: "warning",
    },
    anime: {
        label: "动漫",
        icon: Filmstrip,
        gradient: "from-fuchsia-200 via-pink-100 to-rose-100",
        color: "danger",
    },
    movie: {
        label: "视频",
        icon: Video,
        gradient: "from-zinc-300 via-slate-100 to-neutral-200",
        color: "default",
    },
    video: {
        label: "视频",
        icon: Video,
        gradient: "from-slate-300 via-sky-100 to-cyan-100",
        color: "accent",
    },
    mixed_video: {
        label: "混合视频",
        icon: Filmstrip,
        gradient: "from-violet-200 via-fuchsia-100 to-sky-100",
        color: "accent",
    },
    series: {
        label: "剧集",
        icon: Filmstrip,
        gradient: "from-indigo-200 via-blue-100 to-sky-100",
        color: "accent",
    },
    novel: {
        label: "小说",
        icon: BookOpen,
        gradient: "from-stone-200 via-amber-100 to-yellow-100",
        color: "warning",
    },
    music: {
        label: "音乐",
        icon: MusicNote,
        gradient: "from-violet-200 via-purple-100 to-fuchsia-100",
        color: "accent",
    },
    other: {
        label: "其他",
        icon: Folder,
        gradient: "from-slate-200 via-slate-100 to-slate-50",
        color: "default",
    },
};

const librarySourceStyles: Record<string, LibrarySourceStyle> = {
    local: {
        label: "Local",
        icon: Folder,
        color: "success",
    },
    webdav: {
        label: "WebDAV",
        icon: CloudGear,
        color: "accent",
    },
};

function getMediaStyle(mediaType: string) {
    return mediaTypeStyles[mediaType] ?? {
        label: mediaType,
        icon: Folder,
        gradient: "from-slate-200 via-slate-100 to-slate-50",
        color: "default",
    };
}

function getLibrarySourceStyle(sourceType: string) {
    return librarySourceStyles[sourceType] ?? librarySourceStyles.local;
}

function getPreferredPhotoSource(
    photo: PhotoAssetResponse,
) {
    return photo.preview_src ?? photo.original_src ?? photo.src;
}

function getStableOrder(photos: PhotoAssetResponse[]) {
    return [...photos].sort((left, right) => {
        const leftSeed = `${left.id}:${left.file_id}:${left.title}`;
        const rightSeed = `${right.id}:${right.file_id}:${right.title}`;
        return leftSeed.localeCompare(rightSeed);
    });
}

function PhotoTile({
    photo,
    priority = false,
    overlayLabel,
}: {
    photo: PhotoAssetResponse;
    priority?: boolean;
    overlayLabel?: string;
}) {
    return (
        <div className="relative h-full w-full overflow-hidden bg-black/10">
            <Image
                fill
                alt={photo.title}
                className="object-cover"
                priority={priority}
                sizes="(max-width: 768px) 100vw, (max-width: 1600px) 25vw, 20vw"
                src={getPreferredPhotoSource(photo)}
                unoptimized
            />
            {overlayLabel ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-lg font-semibold text-white">
                    {overlayLabel}
                </div>
            ) : null}
        </div>
    );
}

function PhotoCover({
    photos,
}: {
    photos: PhotoAssetResponse[];
}) {
    const shuffledPhotos = getStableOrder(photos);
    const coverPhotos = shuffledPhotos.slice(0, 5);

    if (coverPhotos.length === 0) {
        return (
            <div className="flex h-full items-center justify-center bg-black/10 text-sm font-medium text-muted">
                暂无照片
            </div>
        );
    }

    if (coverPhotos.length === 1) {
        return (
            <div className="h-full overflow-hidden p-1.5">
                <div className="h-full overflow-hidden rounded-2xl shadow-md">
                    <PhotoTile
                        photo={coverPhotos[0]}
                        priority
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="grid h-full grid-cols-[1.15fr_0.85fr] gap-1.5 overflow-hidden p-1.5">
            <div className="relative min-h-0 overflow-hidden rounded-2xl shadow-md">
                <PhotoTile
                    photo={coverPhotos[0]}
                    priority
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
            </div>
            <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-1.5">
                {coverPhotos.slice(1).map((photo) => (
                    <div key={photo.id} className="min-h-0 overflow-hidden rounded-xl shadow-sm">
                        <PhotoTile photo={photo} />
                    </div>
                ))}
                {Array.from({ length: Math.max(0, 5 - coverPhotos.length) }).map((_, index) => (
                    <div
                        key={`placeholder-${index}`}
                        className="rounded-xl bg-white/18 shadow-inner"
                    />
                ))}
            </div>
        </div>
    );
}

function GenericCover({ style }: { style: MediaTypeStyle }) {
    const Icon = style.icon;

    return (
        <div className="flex h-full items-center justify-center bg-black/10">
            <div className="flex size-24 items-center justify-center rounded-[2rem] bg-white/22 text-foreground shadow-sm backdrop-blur-md">
                <Icon className="h-9 w-9" />
            </div>
        </div>
    );
}

function MangaCover({ series }: { series: MangaSeriesResponse[] }) {
    const covers = [...series]
        .filter((item) => item.cover_src)
        .sort((left, right) => `${left.id}:${left.title}`.localeCompare(`${right.id}:${right.title}`))
        .slice(0, 5);

    if (covers.length === 0) {
        return <GenericCover style={getMediaStyle("manga")} />;
    }

    return (
        <div className="relative h-full overflow-hidden bg-gradient-to-b from-[#f5d9ad] via-[#d6a46e] to-[#8a4f32] px-3 pt-3">
            <div className="relative flex h-[calc(100%_-_14px)] items-end justify-center gap-1.5 pb-1">
                {covers.map((item, index) => {
                    const heights = ["h-[84%]", "h-[94%]", "h-[88%]", "h-[98%]", "h-[82%]"];
                    const rotations = ["-rotate-3", "rotate-1", "-rotate-1", "rotate-2", "-rotate-2"];

                    return (
                        <div
                            key={item.id}
                            className={`relative min-w-0 flex-1 ${heights[index]} ${rotations[index]} origin-bottom overflow-hidden rounded-t-sm border border-black/20 bg-[#ead0aa] shadow-[3px_4px_7px_rgba(47,22,10,0.32)] transition-transform duration-300 group-hover:-translate-y-1`}
                            style={{ zIndex: index + 1 }}
                        >
                            <Image
                                fill
                                alt={item.title}
                                className="object-cover"
                                priority={index === 0}
                                sizes="(max-width: 768px) 20vw, 8vw"
                                src={item.cover_src!}
                                unoptimized
                            />
                        </div>
                    );
                })}
            </div>
            <div className="absolute inset-x-3 bottom-2 h-3 rounded-sm border border-black/20 bg-[#63351f] shadow-[0_3px_5px_rgba(34,14,5,0.4)]" />
            <div className="absolute inset-x-5 bottom-0 h-2 rounded-t-sm bg-[#a8663d]" />
        </div>
    );
}

function VideoCover({ videos }: { videos: VideoAssetResponse[] }) {
    const covers = videos.filter((video) => video.poster_src).slice(0, 3);

    if (covers.length === 0) {
        return (
            <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#17222b] text-white">
                <div className="absolute inset-x-0 top-3 flex justify-around opacity-55">
                    {Array.from({ length: 9 }).map((_, index) => (
                        <span key={`top-${index}`} className="h-2.5 w-4 rounded-sm bg-white/40" />
                    ))}
                </div>
                <div className="absolute inset-x-0 bottom-3 flex justify-around opacity-55">
                    {Array.from({ length: 9 }).map((_, index) => (
                        <span key={`bottom-${index}`} className="h-2.5 w-4 rounded-sm bg-white/40" />
                    ))}
                </div>
                <div className="flex size-20 items-center justify-center rounded-full border border-white/20 bg-white/12 shadow-xl backdrop-blur-md">
                    <Play className="ml-1 h-8 w-8" />
                </div>
            </div>
        );
    }

    const primary = covers[0];

    return (
        <div className="relative h-full overflow-hidden bg-[#111a20] p-3">
            <div className="absolute inset-x-0 top-1.5 flex justify-around opacity-70">
                {Array.from({ length: 9 }).map((_, index) => (
                    <span key={`top-${index}`} className="h-2 w-4 rounded-[2px] bg-white/55" />
                ))}
            </div>
            <div className="absolute inset-x-0 bottom-1.5 flex justify-around opacity-70">
                {Array.from({ length: 9 }).map((_, index) => (
                    <span key={`bottom-${index}`} className="h-2 w-4 rounded-[2px] bg-white/55" />
                ))}
            </div>
            <div className="grid h-full grid-cols-[1.7fr_0.8fr] gap-1.5 overflow-hidden rounded-lg border border-white/15 bg-black shadow-lg">
                <div className="relative min-w-0 overflow-hidden">
                    <Image
                        fill
                        alt={primary.title}
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        priority
                        sizes="(max-width: 768px) 70vw, 20vw"
                        src={primary.poster_src!}
                        unoptimized
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    <span className="absolute bottom-2 left-2 flex size-9 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white backdrop-blur-sm">
                        <Play className="ml-0.5 h-4 w-4" />
                    </span>
                </div>
                <div className="grid min-h-0 grid-rows-2 gap-1.5">
                    {[covers[1], covers[2]].map((video, index) => (
                        <div key={video?.id ?? `video-placeholder-${index}`} className="relative min-h-0 overflow-hidden bg-white/8">
                            {video?.poster_src ? (
                                <Image
                                    fill
                                    alt={video.title}
                                    className="object-cover"
                                    sizes="(max-width: 768px) 30vw, 9vw"
                                    src={video.poster_src}
                                    unoptimized
                                />
                            ) : (
                                <Filmstrip className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/35" />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function StatusPill({ enabled }: { enabled: boolean }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                enabled
                    ? "bg-emerald-500/14 text-emerald-800 dark:bg-emerald-400/18 dark:text-emerald-200"
                    : "bg-black/6 text-muted dark:bg-white/14"
            }`}
        >
            {enabled ? "已启用" : "已停用"}
        </span>
    );
}

function LibraryMenu({ actions }: { actions: MenuAction[] }) {
    const [isOpen, setIsOpen] = useState(false);

    function handleAction(action: MenuAction) {
        setIsOpen(false);
        if (action.onPress) {
            window.setTimeout(() => {
                action.onPress?.();
            }, 0);
        }
    }

    return (
        <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
            <Popover.Trigger>
                <Button
                    type="button"
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label="更多"
                    className="inline-flex h-5 w-5 min-w-5 items-center justify-center rounded-md bg-transparent text-foreground transition hover:bg-white/14 focus:bg-white/14 focus:outline-none"
                >
                    <EllipsisVertical className="h-3 w-3 shrink-0" />
                </Button>
            </Popover.Trigger>
            <Popover.Content
                placement="bottom end"
                className="z-50 max-h-[min(360px,calc(100vh-96px))] w-[220px] overflow-hidden p-2"
            >
                <Popover.Arrow />
                <Popover.Dialog className="outline-none">
                    <div className="max-h-[min(344px,calc(100vh-112px))] space-y-1 overflow-y-auto pr-1">
                        {actions.map((action) => {
                            const Icon = action.icon;

                            return (
                                <button
                                    key={action.key}
                                    type="button"
                                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                                        action.disabled
                                            ? "cursor-not-allowed opacity-45"
                                            : action.danger
                                              ? "hover:bg-red-500/12"
                                              : "hover:bg-white/10"
                                    }`}
                                    disabled={action.disabled}
                                    onClick={() => handleAction(action)}
                                >
                                    <span
                                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                                            action.danger
                                                ? "bg-red-500/14 text-red-200"
                                                : "bg-white/10 text-foreground"
                                        }`}
                                    >
                                        <Icon className="h-4 w-4 shrink-0" />
                                    </span>
                                    <span className="min-w-0 truncate">
                                        <span
                                            className={`block text-sm font-semibold ${
                                                action.danger
                                                    ? "text-red-100 dark:text-red-200"
                                                    : "text-foreground"
                                            }`}
                                        >
                                            {action.title}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </Popover.Dialog>
            </Popover.Content>
        </Popover>
    );
}

export default function LibrarieCard({
    library,
    coverPhotos = [],
    coverManga = [],
    coverVideos = [],
    isBusy = false,
    hasActiveCacheTask = false,
    onRescan,
    onGeneratePreviews,
    onDeletePreviews,
    onAnalyzeVideos,
    onRegenerateVideoCovers,
    onOpenSettings,
    onOpenInfo,
    onToggleEnabled,
    onDeleteLibrary,
}: LibrarieCardProps) {
    const style = getMediaStyle(library.media_type);
    const MediaTypeIcon = style.icon;
    const sourceStyle = getLibrarySourceStyle(library.source_type);
    const SourceIcon = sourceStyle.icon;
    const isVideoLibrary = ["video", "mixed_video"].includes(library.media_type);
    const menuActions: MenuAction[] = [
        {
            key: "rescan",
            title: "重新扫描",
            description: "",
            icon: ArrowsRotateRight,
            disabled: isBusy || !library.enabled,
            onPress: onRescan,
        },
        {
            key: "generate",
            title: hasActiveCacheTask ? "缓存任务进行中" : "生成浏览缓存",
            description: hasActiveCacheTask
                ? "当前媒体库已有生成任务，请到任务页查看进度。"
                : isVideoLibrary
                  ? "为缺少封面的视频抽取并缓存画面。"
                  : "补齐缺失或过期的预览图缓存。",
            icon: Camera,
            disabled: isBusy || hasActiveCacheTask,
            onPress: onGeneratePreviews,
        },
        {
            key: "delete-preview",
            title: "删除浏览缓存",
            description: "清空当前媒体库的缓存文件并释放占用空间。",
            icon: TrashBin,
            disabled: isBusy || hasActiveCacheTask,
            onPress: onDeletePreviews,
        },
        ...(isVideoLibrary
            ? [{
                key: "analyze-video",
                title: "分析视频媒体",
                description: "读取时长、分辨率与音视频编码信息。",
                icon: Filmstrip,
                disabled: isBusy || !library.enabled,
                onPress: onAnalyzeVideos,
            }, {
                key: "regenerate-video-covers",
                title: "重新生成视频封面",
                description: "覆盖当前媒体库已有的封面缓存。",
                icon: ArrowsRotateRight,
                disabled: isBusy || hasActiveCacheTask || !library.enabled,
                onPress: onRegenerateVideoCovers,
            }]
            : []),
        {
            key: "settings",
            title: "媒体库设置",
            description: "修改名称、路径，以及扫描后自动生成缓存的选项。",
            icon: Gear,
            onPress: onOpenSettings,
        },
        {
            key: "info",
            title: "信息",
            description: "查看资源总数、缓存占用、生成状态和最近更新时间。",
            icon: CircleInfo,
            onPress: onOpenInfo,
        },
        {
            key: "toggle-enabled",
            title: library.enabled ? "停用媒体库" : "启用媒体库",
            description: library.enabled
                ? "停用后不会继续扫描，也不会允许手动重新扫描。"
                : "重新启用该媒体库，恢复扫描和展示能力。",
            icon: library.enabled ? Stop : Play,
            disabled: isBusy,
            onPress: onToggleEnabled,
        },
        {
            key: "delete-library",
            title: "删除媒体库",
            description: "删除媒体库记录、扫描索引和预览图缓存，不会删除原始文件。",
            icon: TrashBin,
            danger: true,
            disabled: isBusy || hasActiveCacheTask,
            onPress: onDeleteLibrary,
        },
    ];

    return (
        <Card className="group overflow-hidden transition-shadow duration-300 hover:shadow-xl">
            <div className={`relative h-52 bg-gradient-to-br overflow-hidden rounded-2xl ${style.gradient}`}>
                {library.media_type === "photo" ? (
                    <PhotoCover
                        photos={coverPhotos}
                    />
                ) : library.media_type === "manga" ? (
                    <MangaCover series={coverManga} />
                ) : library.media_type === "video" ? (
                    <VideoCover videos={coverVideos} />
                ) : (
                    <GenericCover style={style} />
                )}
                <Badge.Anchor className="absolute right-3 top-3 size-3">
                    <span aria-hidden="true" className="size-3" />
                    <Badge
                aria-label={library.enabled ? "媒体库已启用" : "媒体库已停用"}
                className="ring-2 ring-white/80 shadow-sm"
                color={library.enabled ? "success" : "danger"}
                placement="top-right"
                size="sm"
                    />
                </Badge.Anchor>
            </div>

            <div className="">
                <div className="">
                    <div className="flex min-w-0 items-center gap-2">
                        <Badge.Anchor className="hidden">
                            <span aria-hidden="true" className="size-3" />
                        <Badge
                            aria-label={library.enabled ? "媒体库已启用" : "媒体库已停用"}
                            color={library.enabled ? "success" : "danger"}
                            size="sm"
                        />
                        </Badge.Anchor>
                        <h3 className="max-w-[46%] shrink-0 truncate text-base font-semibold text-foreground">
                            {library.name}
                        </h3>
                        <p className="min-w-0 flex-1 truncate text-xs leading-5 text-muted">
                            {library.source_type === "webdav" ? `远程目录: ${library.root_path || "/"}` : library.root_path}
                        </p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            {false && (
                            <Badge
                                aria-label={library.enabled ? "媒体库已启用" : "媒体库已停用"}
                                color={library.enabled ? "success" : "danger"}
                                size="sm"
                            />
                            )}
                            <Chip className="gap-1 px-1.5" color={style.color} size="sm" variant="soft">
                                <MediaTypeIcon className="h-3.5 w-3.5" />
                                <span>{style.label}</span>
                            </Chip>
                            <Chip className="gap-1 px-1.5" color={sourceStyle.color} size="sm" variant="soft">
                                <SourceIcon className="h-3.5 w-3.5" />
                                <span>{sourceStyle.label}</span>
                            </Chip>
                        </div>
                        <LibraryMenu actions={menuActions} />
                    </div>
                </div>

                <div className="hidden">
                    <button
                        type="button"
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isBusy || !library.enabled}
                        onClick={onRescan}
                    >
                        <ArrowsRotateRight className="h-4 w-4 shrink-0" />
                        <span>重新扫描</span>
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-border bg-white/8 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isBusy}
                        onClick={onOpenSettings}
                    >
                        <Gear className="h-4 w-4 shrink-0" />
                        <span>设置</span>
                    </button>
                </div>
            </div>
        </Card>
    );
}
