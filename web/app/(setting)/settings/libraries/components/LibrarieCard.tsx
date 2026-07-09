"use client";

import {
    ArrowsRotateRight,
    BookOpen,
    Books,
    Camera,
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
import { Card, Popover } from "@heroui/react";
import Image from "next/image";
import { useState } from "react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import type {
    LibraryResponse,
    PhotoAssetResponse,
} from "@/src/api/client";

type LibrarieCardProps = {
    library: LibraryResponse;
    coverPhotos?: PhotoAssetResponse[];
    isBusy?: boolean;
    hasActiveCacheTask?: boolean;
    onRescan?: () => void;
    onGenerateThumbnails?: () => void;
    onDeleteThumbnails?: () => void;
    onOpenSettings?: () => void;
    onOpenInfo?: () => void;
    onToggleEnabled?: () => void;
    onDeleteLibrary?: () => void;
};

type MediaTypeStyle = {
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    gradient: string;
    badge: string;
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
        badge: "bg-sky-100/90 text-sky-800",
    },
    game: {
        label: "游戏",
        icon: Puzzle,
        gradient: "from-lime-200 via-emerald-100 to-teal-100",
        badge: "bg-emerald-100/90 text-emerald-800",
    },
    manga: {
        label: "漫画",
        icon: Books,
        gradient: "from-amber-200 via-orange-100 to-rose-100",
        badge: "bg-orange-100/90 text-orange-800",
    },
    anime: {
        label: "动漫",
        icon: Filmstrip,
        gradient: "from-fuchsia-200 via-pink-100 to-rose-100",
        badge: "bg-pink-100/90 text-pink-800",
    },
    movie: {
        label: "视频",
        icon: Video,
        gradient: "from-zinc-300 via-slate-100 to-neutral-200",
        badge: "bg-zinc-100/90 text-zinc-800",
    },
    series: {
        label: "剧集",
        icon: Filmstrip,
        gradient: "from-indigo-200 via-blue-100 to-sky-100",
        badge: "bg-indigo-100/90 text-indigo-800",
    },
    novel: {
        label: "小说",
        icon: BookOpen,
        gradient: "from-stone-200 via-amber-100 to-yellow-100",
        badge: "bg-amber-100/90 text-amber-800",
    },
    music: {
        label: "音乐",
        icon: MusicNote,
        gradient: "from-violet-200 via-purple-100 to-fuchsia-100",
        badge: "bg-violet-100/90 text-violet-800",
    },
    other: {
        label: "其他",
        icon: Folder,
        gradient: "from-slate-200 via-slate-100 to-slate-50",
        badge: "bg-slate-100/90 text-slate-800",
    },
};

function getMediaStyle(mediaType: string) {
    return mediaTypeStyles[mediaType] ?? {
        label: mediaType,
        icon: Folder,
        gradient: "from-slate-200 via-slate-100 to-slate-50",
        badge: "bg-slate-100/90 text-slate-800",
    };
}

function getLibrarySourceLabel() {
    return "Local";
}

function getPreferredPhotoSource(
    photo: PhotoAssetResponse,
) {
    return photo.thumbnail_src ?? photo.preview_src ?? photo.original_src ?? photo.src;
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
            <div className="flex h-full items-center justify-center bg-black/10 text-sm font-medium text-[var(--theme-text-secondary)]">
                暂无照片
            </div>
        );
    }

    if (coverPhotos.length === 1) {
        return (
            <div className="h-full overflow-hidden">
                <PhotoTile
                    photo={coverPhotos[0]}
                    priority
                />
            </div>
        );
    }

    if (coverPhotos.length < 5) {
        return (
            <div className="grid h-full grid-cols-2 overflow-hidden">
                <div className="h-full">
                    <PhotoTile
                        photo={coverPhotos[0]}
                        priority
                    />
                </div>
                <div className="grid h-full grid-rows-3">
                    {coverPhotos.slice(1).map((photo) => (
                        <PhotoTile
                            key={photo.id}
                            photo={photo}
                        />
                    ))}
                    {Array.from({ length: Math.max(0, 4 - coverPhotos.length) }).map((_, index) => (
                        <div
                            key={`placeholder-${index}`}
                            className="bg-black/8"
                        />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
            <div className="grid h-full grid-rows-2">
                <PhotoTile
                    photo={coverPhotos[0]}
                    priority
                />
                <PhotoTile photo={coverPhotos[1]} />
            </div>
            <div className="grid h-full grid-rows-3">
                <PhotoTile photo={coverPhotos[2]} />
                <PhotoTile photo={coverPhotos[3]} />
                <PhotoTile
                    photo={coverPhotos[4]}
                    overlayLabel={photos.length > 5 ? `+${photos.length - 5}` : undefined}
                />
            </div>
        </div>
    );
}

function GenericCover({ style }: { style: MediaTypeStyle }) {
    const Icon = style.icon;

    return (
        <div className="flex h-full items-center justify-center bg-black/10">
            <div className="flex size-24 items-center justify-center rounded-[2rem] bg-white/22 text-[var(--theme-text-primary)] shadow-sm backdrop-blur-md">
                <Icon className="h-9 w-9" />
            </div>
        </div>
    );
}

function StatusPill({ enabled }: { enabled: boolean }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                enabled
                    ? "bg-emerald-500/14 text-emerald-800 dark:bg-emerald-400/18 dark:text-emerald-200"
                    : "bg-black/6 text-[var(--theme-text-secondary)] dark:bg-white/14"
            }`}
        >
            {enabled ? "已启用" : "已停用"}
        </span>
    );
}

function MetaPill({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <span className="inline-flex items-center rounded-full bg-black/6 px-3 py-1 text-xs font-medium text-[var(--theme-text-secondary)] dark:bg-white/10">
            {children}
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
                <button
                    type="button"
                    aria-label="更多"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-transparent text-[var(--theme-text-primary)] transition hover:bg-white/14 focus:bg-white/14 focus:outline-none"
                >
                    <EllipsisVertical className="h-4 w-4 shrink-0" />
                </button>
            </Popover.Trigger>
            <Popover.Content
                placement="bottom end"
                className="z-50 max-h-[min(360px,calc(100vh-96px))] w-[280px] overflow-hidden rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-bg-overlay-heavy)] p-2 text-[var(--theme-text-primary)] shadow-2xl backdrop-blur-2xl"
            >
                <Popover.Dialog className="outline-none">
                    <div className="max-h-[min(344px,calc(100vh-112px))] space-y-1 overflow-y-auto pr-1">
                        {actions.map((action) => {
                            const Icon = action.icon;

                            return (
                                <button
                                    key={action.key}
                                    type="button"
                                    className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${
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
                                        className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                                            action.danger
                                                ? "bg-red-500/14 text-red-200"
                                                : "bg-white/10 text-[var(--theme-text-primary)]"
                                        }`}
                                    >
                                        <Icon className="h-4 w-4 shrink-0" />
                                    </span>
                                    <span className="min-w-0">
                                        <span
                                            className={`block text-sm font-semibold ${
                                                action.danger
                                                    ? "text-red-100 dark:text-red-200"
                                                    : "text-[var(--theme-text-primary)]"
                                            }`}
                                        >
                                            {action.title}
                                        </span>
                                        <span className="mt-1 block text-xs leading-5 text-[var(--theme-text-secondary)]">
                                            {action.description}
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
    isBusy = false,
    hasActiveCacheTask = false,
    onRescan,
    onGenerateThumbnails,
    onDeleteThumbnails,
    onOpenSettings,
    onOpenInfo,
    onToggleEnabled,
    onDeleteLibrary,
}: LibrarieCardProps) {
    const style = getMediaStyle(library.media_type);
    const menuActions: MenuAction[] = [
        {
            key: "generate",
            title: hasActiveCacheTask ? "缓存任务进行中" : "生成缩略图和预览图",
            description: hasActiveCacheTask
                ? "当前媒体库已有生成任务，请到任务页查看进度。"
                : "补齐缺失或过期的 thumb / preview 缓存。",
            icon: Camera,
            disabled: isBusy || hasActiveCacheTask,
            onPress: onGenerateThumbnails,
        },
        {
            key: "delete-thumb",
            title: "删除缩略图和预览图",
            description: "清空当前媒体库的缓存文件并释放占用空间。",
            icon: TrashBin,
            disabled: isBusy || hasActiveCacheTask,
            onPress: onDeleteThumbnails,
        },
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
            description: "删除媒体库记录、扫描索引和缩略图缓存，不会删除原始文件。",
            icon: TrashBin,
            danger: true,
            disabled: isBusy || hasActiveCacheTask,
            onPress: onDeleteLibrary,
        },
    ];

    return (
        <Card className="group overflow-hidden rounded-[2rem] border border-[var(--theme-border)] bg-[var(--theme-bg-overlay-heavy)] shadow-sm backdrop-blur-2xl transition-shadow duration-300 hover:shadow-xl">
            <div className={`relative h-52 bg-gradient-to-br ${style.gradient}`}>
                {library.media_type === "photo" ? (
                    <PhotoCover
                        photos={coverPhotos}
                    />
                ) : (
                    <GenericCover style={style} />
                )}
            </div>

            <div className="space-y-4 p-4">
                <div className="space-y-3">
                    <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-[var(--theme-text-primary)]">
                            {library.name}
                        </h3>
                        <p className="mt-1 truncate text-xs leading-5 text-[var(--theme-text-secondary)]">
                            {library.root_path}
                        </p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <StatusPill enabled={library.enabled} />
                            <MetaPill>{style.label}</MetaPill>
                            <MetaPill>{getLibrarySourceLabel()}</MetaPill>
                        </div>
                        <LibraryMenu actions={menuActions} />
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        type="button"
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--theme-text-primary)] px-4 py-2 text-sm font-medium text-[var(--theme-bg-card)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isBusy || !library.enabled}
                        onClick={onRescan}
                    >
                        <ArrowsRotateRight className="h-4 w-4 shrink-0" />
                        <span>重新扫描</span>
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[var(--theme-border)] bg-white/8 px-4 py-2 text-sm font-medium text-[var(--theme-text-primary)] transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
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
