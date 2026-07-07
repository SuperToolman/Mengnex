"use client";

import {
    ArrowsRotateRight,
    Camera,
    CircleInfo,
    EllipsisVertical,
    Folder,
    Gear,
    Play,
    Stop,
    TrashBin,
} from "@gravity-ui/icons";
import { Card, Popover } from "@heroui/react";
import Image from "next/image";
import { useState } from "react";
import type { ComponentType, SVGProps } from "react";
import type {
    LibraryResponse,
    PhotoAssetResponse,
    PreferencesResponse,
} from "@/src/api/client";

type LibrarieCardProps = {
    library: LibraryResponse;
    coverPhotos?: PhotoAssetResponse[];
    photoDisplaySource: PreferencesResponse["photo_display_source"];
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
    icon: string;
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
        icon: "PH",
        gradient: "from-sky-200 via-cyan-100 to-emerald-100",
        badge: "bg-sky-100/90 text-sky-800",
    },
    game: {
        label: "游戏",
        icon: "GM",
        gradient: "from-lime-200 via-emerald-100 to-teal-100",
        badge: "bg-emerald-100/90 text-emerald-800",
    },
    manga: {
        label: "漫画",
        icon: "MG",
        gradient: "from-amber-200 via-orange-100 to-rose-100",
        badge: "bg-orange-100/90 text-orange-800",
    },
    anime: {
        label: "动漫",
        icon: "AN",
        gradient: "from-fuchsia-200 via-pink-100 to-rose-100",
        badge: "bg-pink-100/90 text-pink-800",
    },
    movie: {
        label: "电影",
        icon: "MV",
        gradient: "from-zinc-300 via-slate-100 to-neutral-200",
        badge: "bg-zinc-100/90 text-zinc-800",
    },
    series: {
        label: "剧集",
        icon: "TV",
        gradient: "from-indigo-200 via-blue-100 to-sky-100",
        badge: "bg-indigo-100/90 text-indigo-800",
    },
    novel: {
        label: "小说",
        icon: "BK",
        gradient: "from-stone-200 via-amber-100 to-yellow-100",
        badge: "bg-amber-100/90 text-amber-800",
    },
    music: {
        label: "音乐",
        icon: "MU",
        gradient: "from-violet-200 via-purple-100 to-fuchsia-100",
        badge: "bg-violet-100/90 text-violet-800",
    },
};

function getMediaStyle(mediaType: string) {
    return mediaTypeStyles[mediaType] ?? {
        label: mediaType,
        icon: "MD",
        gradient: "from-slate-200 via-slate-100 to-slate-50",
        badge: "bg-slate-100/90 text-slate-800",
    };
}

function getPreferredPhotoSource(
    photo: PhotoAssetResponse,
    photoDisplaySource: PreferencesResponse["photo_display_source"],
) {
    if (photoDisplaySource === "thumbnail") {
        return photo.thumbnail_src ?? photo.preview_src ?? photo.original_src ?? photo.src;
    }

    return photo.original_src ?? photo.src;
}

function PhotoTile({
    photo,
    photoDisplaySource,
    priority = false,
    overlayLabel,
}: {
    photo: PhotoAssetResponse;
    photoDisplaySource: PreferencesResponse["photo_display_source"];
    priority?: boolean;
    overlayLabel?: string;
}) {
    return (
        <div className="relative h-full w-full overflow-hidden bg-slate-200">
            <Image
                fill
                alt={photo.title}
                className="object-cover"
                priority={priority}
                sizes="(max-width: 768px) 100vw, (max-width: 1600px) 25vw, 20vw"
                src={getPreferredPhotoSource(photo, photoDisplaySource)}
                unoptimized
            />
            {overlayLabel ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/42 text-lg font-semibold text-white">
                    {overlayLabel}
                </div>
            ) : null}
        </div>
    );
}

function PhotoCover({
    photos,
    photoDisplaySource,
}: {
    photos: PhotoAssetResponse[];
    photoDisplaySource: PreferencesResponse["photo_display_source"];
}) {
    const coverPhotos = photos.slice(0, 5);

    if (coverPhotos.length === 0) {
        return (
            <div className="flex h-full items-center justify-center rounded-[1.75rem] bg-white/55 text-sm font-medium text-slate-500">
                暂无照片
            </div>
        );
    }

    if (coverPhotos.length === 1) {
        return (
            <div className="h-full overflow-hidden rounded-[1.75rem]">
                <PhotoTile
                    photo={coverPhotos[0]}
                    photoDisplaySource={photoDisplaySource}
                    priority
                />
            </div>
        );
    }

    if (coverPhotos.length === 2) {
        return (
            <div className="grid h-full grid-cols-2 overflow-hidden rounded-[1.75rem]">
                {coverPhotos.map((photo, index) => (
                    <PhotoTile
                        key={photo.id}
                        photo={photo}
                        photoDisplaySource={photoDisplaySource}
                        priority={index === 0}
                    />
                ))}
            </div>
        );
    }

    if (coverPhotos.length === 3) {
        return (
            <div className="grid h-full grid-cols-3 grid-rows-2 overflow-hidden rounded-[1.75rem]">
                <div className="col-span-2 row-span-2">
                    <PhotoTile
                        photo={coverPhotos[0]}
                        photoDisplaySource={photoDisplaySource}
                        priority
                    />
                </div>
                <PhotoTile photo={coverPhotos[1]} photoDisplaySource={photoDisplaySource} />
                <PhotoTile photo={coverPhotos[2]} photoDisplaySource={photoDisplaySource} />
            </div>
        );
    }

    if (coverPhotos.length === 4) {
        return (
            <div className="grid h-full grid-cols-2 grid-rows-2 overflow-hidden rounded-[1.75rem]">
                {coverPhotos.map((photo, index) => (
                    <PhotoTile
                        key={photo.id}
                        photo={photo}
                        photoDisplaySource={photoDisplaySource}
                        priority={index === 0}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="grid h-full grid-cols-4 grid-rows-2 overflow-hidden rounded-[1.75rem]">
            <div className="col-span-2 row-span-2">
                <PhotoTile
                    photo={coverPhotos[0]}
                    photoDisplaySource={photoDisplaySource}
                    priority
                />
            </div>
            <PhotoTile photo={coverPhotos[1]} photoDisplaySource={photoDisplaySource} />
            <PhotoTile photo={coverPhotos[2]} photoDisplaySource={photoDisplaySource} />
            <PhotoTile photo={coverPhotos[3]} photoDisplaySource={photoDisplaySource} />
            <PhotoTile
                photo={coverPhotos[4]}
                overlayLabel={photos.length > 5 ? `+${photos.length - 5}` : undefined}
                photoDisplaySource={photoDisplaySource}
            />
        </div>
    );
}

function GenericCover({ style }: { style: MediaTypeStyle }) {
    return (
        <div className="flex h-full items-center justify-center rounded-[1.75rem] bg-white/55">
            <div className="flex size-24 items-center justify-center rounded-[2rem] bg-white/85 text-2xl font-black tracking-[0.2em] text-slate-700 shadow-sm">
                {style.icon}
            </div>
        </div>
    );
}

function StatusPill({ enabled }: { enabled: boolean }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                enabled
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-500"
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
                <button
                    type="button"
                    aria-label="更多"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-transparent text-slate-700 transition hover:bg-white/85 focus:bg-white/85 focus:outline-none"
                >
                    <EllipsisVertical className="h-4 w-4 shrink-0" />
                </button>
            </Popover.Trigger>
            <Popover.Content
                placement="bottom end"
                className="z-50 w-[280px] rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl"
            >
                <Popover.Dialog className="outline-none">
                    <div className="space-y-1">
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
                                              ? "hover:bg-red-50"
                                              : "hover:bg-slate-50"
                                    }`}
                                    disabled={action.disabled}
                                    onClick={() => handleAction(action)}
                                >
                                    <span
                                        className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                                            action.danger
                                                ? "bg-red-100 text-red-600"
                                                : "bg-slate-100 text-slate-700"
                                        }`}
                                    >
                                        <Icon className="h-4 w-4 shrink-0" />
                                    </span>
                                    <span className="min-w-0">
                                        <span
                                            className={`block text-sm font-semibold ${
                                                action.danger ? "text-red-700" : "text-slate-900"
                                            }`}
                                        >
                                            {action.title}
                                        </span>
                                        <span className="mt-1 block text-xs leading-5 text-slate-500">
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
    photoDisplaySource,
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
        <Card className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl">
            <div className={`relative h-52 bg-gradient-to-br p-3 ${style.gradient}`}>
                <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}>
                        {style.label}
                    </span>
                    <div className="flex items-center gap-2">
                        <StatusPill enabled={library.enabled} />
                        <LibraryMenu actions={menuActions} />
                    </div>
                </div>
                <div className="h-full pt-10">
                    {library.media_type === "photo" ? (
                        <PhotoCover
                            photos={coverPhotos}
                            photoDisplaySource={photoDisplaySource}
                        />
                    ) : (
                        <GenericCover style={style} />
                    )}
                </div>
            </div>

            <div className="space-y-5 p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-slate-950">
                            {library.name}
                        </h3>
                        <p className="mt-1 line-clamp-2 break-all text-xs leading-5 text-slate-500">
                            {library.root_path}
                        </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        {library.media_type}
                    </span>
                </div>

                <div className="flex gap-2">
                    <button
                        type="button"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isBusy || !library.enabled}
                        onClick={onRescan}
                    >
                        <ArrowsRotateRight className="h-4 w-4 shrink-0" />
                        <span>重新扫描</span>
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isBusy}
                        onClick={onOpenSettings}
                    >
                        <Gear className="h-4 w-4 shrink-0" />
                        <span>设置</span>
                    </button>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                        <Folder className="h-3.5 w-3.5 shrink-0" />
                        {hasActiveCacheTask ? "存在进行中的缓存任务" : "暂无进行中的缓存任务"}
                    </span>
                    <span>{library.enabled ? "当前可扫描" : "当前已停用"}</span>
                </div>
            </div>
        </Card>
    );
}
