"use client";

import { Magnifier } from "@gravity-ui/icons";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
    deletePhoto,
    getPhotos,
    type ListPhotosParams,
    type PhotoAssetResponse,
} from "@/src/api/client";
import GalleryGroup, { type GalleryGroupData } from "./components/GalleryGroup";
import PhotoViewer from "./components/PhotoViewer";
import { usePhotoShell } from "./components/PhotoShellContext";

const PHOTO_HEIGHT_LEVELS = [128, 168, 220, 280] as const;

function getBatchKey(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getGridSource(photo: PhotoAssetResponse) {
    return photo.thumbnail_src ?? photo.preview_src ?? photo.original_src ?? photo.src;
}

function getViewerSource(photo: PhotoAssetResponse) {
    return photo.preview_src ?? photo.thumbnail_src ?? photo.original_src ?? photo.src;
}

function toGalleryItem(photo: PhotoAssetResponse) {
    return {
        id: photo.id,
        src: getGridSource(photo),
        viewerSrc: getViewerSource(photo),
        originalSrc: photo.original_src ?? photo.src,
        thumbnailSrc: photo.thumbnail_src ?? undefined,
        previewSrc: photo.preview_src ?? undefined,
        alt: photo.title,
        width: photo.width ?? undefined,
        height: photo.height ?? undefined,
        fileName: photo.file_name,
        fileSize: photo.file_size,
        mimeType: photo.mime_type ?? undefined,
        takenAt: photo.taken_at ?? photo.batch_time,
        sourcePath: photo.source_path,
    };
}

function buildGalleryGroups(
    photos: PhotoAssetResponse[],
): GalleryGroupData[] {
    const groupMap = new Map<string, GalleryGroupData>();

    for (const photo of photos) {
        const batchTime = photo.batch_time ?? photo.taken_at ?? new Date().toISOString();
        const batchKey = getBatchKey(batchTime);
        const group = groupMap.get(batchKey) ?? {
            id: batchKey,
            batchTime,
            items: [],
        };

        group.items.push(toGalleryItem(photo));
        groupMap.set(batchKey, group);
    }

    return Array.from(groupMap.values()).sort(
        (left, right) =>
            new Date(right.batchTime).getTime() - new Date(left.batchTime).getTime(),
    );
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "object" && error && "message" in error) {
        return String(error.message);
    }

    return "照片数据加载失败，请确认 API 服务已启动";
}

function normalizeKeyword(value: string) {
    return value.trim().toLocaleLowerCase("zh-CN");
}

function matchesSearch(photo: PhotoAssetResponse, keyword: string) {
    const normalizedKeyword = normalizeKeyword(keyword);

    if (!normalizedKeyword) {
        return true;
    }

    return [
        photo.file_name,
        photo.title,
        photo.mime_type ?? "",
    ].some((field) => field.toLocaleLowerCase("zh-CN").includes(normalizedKeyword));
}

function formatSearchTimestamp(value?: string | null) {
    if (!value) {
        return "未知时间";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function SearchResults({
    photos,
    onOpen,
}: {
    photos: PhotoAssetResponse[];
    onOpen: (photoId: string) => void;
}) {
    return (
        <section className="pb-8">
            <div className="rounded-[32px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(17,24,39,0.92))] dark:shadow-none">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500 text-white">
                        <Magnifier className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                            搜索结果
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            共找到 {photos.length} 张匹配照片
                        </p>
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
                    {photos.map((photo) => (
                        <button
                            key={photo.id}
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => onOpen(photo.id)}
                        >
                            <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white transition-all hover:-translate-y-0.5 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-700">
                                <div className="relative aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                                    <Image
                                        src={getGridSource(photo)}
                                        alt={photo.title}
                                        fill
                                        sizes="25vw"
                                        unoptimized
                                        className="object-cover"
                                    />
                                </div>
                            </div>
                            <p className="mt-2 truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                                {photo.file_name}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-slate-400 dark:text-slate-500">
                                {formatSearchTimestamp(photo.taken_at ?? photo.batch_time)}
                            </p>
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default function PhotoPage() {
    const pageSize = 200;
    const {
        scaleLevel,
        searchQuery,
        setBreadcrumbs,
        setScaleMode,
    } = usePhotoShell();
    const [photos, setPhotos] = useState<PhotoAssetResponse[]>([]);
    const [activeItemId, setActiveItemId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setScaleMode("photo-height");
        setBreadcrumbs([]);

        return () => {
            setScaleMode("none");
            setBreadcrumbs([]);
        };
    }, [setBreadcrumbs, setScaleMode]);

    useEffect(() => {
        let cancelled = false;

        async function loadPhotos(params?: ListPhotosParams) {
            const offset = params?.offset ?? 0;
            const limit = params?.limit ?? pageSize;

            try {
                if (offset === 0) {
                    setIsLoading(true);
                } else {
                    setIsLoadingMore(true);
                }
                setError(null);
                const photoData = await getPhotos({
                    limit,
                    offset,
                });

                if (!cancelled) {
                    setPhotos((currentPhotos) => (
                        offset === 0 ? photoData : [...currentPhotos, ...photoData]
                    ));
                    setHasMore(photoData.length === limit);
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(getErrorMessage(loadError));
                }
            } finally {
                if (!cancelled) {
                    if (offset === 0) {
                        setIsLoading(false);
                    } else {
                        setIsLoadingMore(false);
                    }
                }
            }
        }

        void loadPhotos();

        return () => {
            cancelled = true;
        };
    }, []);

    const galleryGroups = useMemo(
        () => buildGalleryGroups(photos),
        [photos],
    );
    const galleryItems = useMemo(
        () => galleryGroups.flatMap((group) => group.items),
        [galleryGroups],
    );
    const searchResults = useMemo(
        () => photos.filter((photo) => matchesSearch(photo, searchQuery)),
        [photos, searchQuery],
    );
    const activeIndex = activeItemId
        ? galleryItems.findIndex((item) => item.id === activeItemId)
        : -1;
    const itemHeight = PHOTO_HEIGHT_LEVELS[scaleLevel] ?? PHOTO_HEIGHT_LEVELS[1];
    const isSearchActive = normalizeKeyword(searchQuery).length > 0;

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                正在加载照片...
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-400">
                {error}
            </div>
        );
    }

    if (galleryGroups.length === 0) {
        return (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
                暂无照片。请先在设置的媒体库中添加照片目录并完成扫码。
            </div>
        );
    }

    return (
        <>
            {isSearchActive ? (
                <SearchResults
                    photos={searchResults}
                    onOpen={(photoId) => setActiveItemId(photoId)}
                />
            ) : (
                <>
                    <div className="flex flex-wrap items-start gap-x-10 gap-y-6 pb-8">
                        {galleryGroups.map((group) => (
                            <GalleryGroup
                                key={group.id}
                                group={group}
                                itemHeight={itemHeight}
                                onItemOpen={(item) => setActiveItemId(item.id)}
                            />
                        ))}
                    </div>
                    {hasMore ? (
                        <div className="flex justify-center pb-8">
                            <button
                                type="button"
                                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                                disabled={isLoadingMore}
                                onClick={async () => {
                                    try {
                                        setIsLoadingMore(true);
                                        setError(null);
                                        const nextPhotos = await getPhotos({
                                            limit: pageSize,
                                            offset: photos.length,
                                        });
                                        setPhotos((currentPhotos) => [...currentPhotos, ...nextPhotos]);
                                        setHasMore(nextPhotos.length === pageSize);
                                    } catch (loadError) {
                                        setError(getErrorMessage(loadError));
                                    } finally {
                                        setIsLoadingMore(false);
                                    }
                                }}
                            >
                                {isLoadingMore ? "Loading..." : "Load More"}
                            </button>
                        </div>
                    ) : null}
                </>
            )}
            <PhotoViewer
                items={galleryItems}
                activeIndex={activeIndex >= 0 ? activeIndex : null}
                onChange={(nextIndex) => {
                    setActiveItemId(galleryItems[nextIndex]?.id ?? null);
                }}
                onDelete={async (photoId) => {
                    await deletePhoto(photoId);
                    setPhotos((currentPhotos) => currentPhotos.filter((photo) => photo.id !== photoId));
                    setActiveItemId(null);
                }}
                onClose={() => setActiveItemId(null)}
            />
        </>
    );
}
