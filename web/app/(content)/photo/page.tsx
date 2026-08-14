"use client";

import { Magnifier } from "@gravity-ui/icons";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    deletePhoto,
    getPhotos,
    type PhotoAssetResponse,
} from "@/src/api/client";
import { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import GalleryGroup, { type GalleryGroupData } from "./components/GalleryGroup";
import { usePhotoShell } from "./components/PhotoShellContext";

const PHOTO_HEIGHT_LEVELS = [128, 168, 220, 280, 340] as const;
const PAGE_SIZE = 200;
const AUTO_LOAD_LIMIT = 1_000;
const SEARCH_DEBOUNCE_MS = 180;

const PhotoViewer = dynamic(() => import("./components/PhotoViewer"), {
    ssr: false,
});

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
    return photo.preview_src ?? photo.original_src ?? photo.src;
}

function getViewerSource(photo: PhotoAssetResponse) {
    return photo.preview_src ?? photo.original_src ?? photo.src;
}

function toGalleryItem(photo: PhotoAssetResponse) {
    return {
        id: photo.id,
        src: getGridSource(photo),
        viewerSrc: getViewerSource(photo),
        originalSrc: photo.original_src ?? photo.src,
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
    const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
    const loadMoreRef = useRef<(manual?: boolean) => Promise<void>>(async () => {});
    const isLoadingMoreRef = useRef(false);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setScaleMode("photo-height");
        setBreadcrumbs([]);

        return () => {
            setScaleMode("none");
            setBreadcrumbs([]);
        };
    }, [setBreadcrumbs, setScaleMode]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, SEARCH_DEBOUNCE_MS);

        return () => window.clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        let cancelled = false;

        async function loadInitialPhotos() {
            try {
                setIsLoading(true);
                setError(null);
                const photoData = await getPhotos({
                    limit: PAGE_SIZE,
                });

                if (!cancelled) {
                    setPhotos(photoData);
                    setHasMore(photoData.length === PAGE_SIZE);
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(getErrorMessage(loadError));
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        void loadInitialPhotos();

        return () => {
            cancelled = true;
        };
    }, []);

    const loadMore = useCallback(async (manual = false) => {
        if (
            isLoadingMoreRef.current
            || !hasMore
            || (!manual && photos.length >= AUTO_LOAD_LIMIT)
        ) {
            return;
        }

        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
        setLoadMoreError(null);

        try {
            const nextPhotos = await getPhotos({
                limit: PAGE_SIZE,
                beforeId: photos.at(-1)?.id,
            });
            setPhotos((currentPhotos) => [...currentPhotos, ...nextPhotos]);
            setHasMore(nextPhotos.length === PAGE_SIZE);
        } catch (loadError) {
            setLoadMoreError(getErrorMessage(loadError));
        } finally {
            isLoadingMoreRef.current = false;
            setIsLoadingMore(false);
        }
    }, [hasMore, photos]);

    useEffect(() => {
        loadMoreRef.current = loadMore;
    }, [loadMore]);

    const normalizedSearchQuery = normalizeKeyword(debouncedSearchQuery);
    const isSearchActive = normalizedSearchQuery.length > 0;

    useEffect(() => {
        const sentinel = loadMoreSentinelRef.current;
        if (!sentinel || isSearchActive || !hasMore || photos.length >= AUTO_LOAD_LIMIT) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadMoreRef.current();
            }
        }, { rootMargin: "800px 0px" });

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, isSearchActive, photos.length]);

    const galleryGroups = useMemo(
        () => buildGalleryGroups(photos),
        [photos],
    );
    const galleryItems = useMemo(
        () => galleryGroups.flatMap((group) => group.items),
        [galleryGroups],
    );
    const searchResults = useMemo(
        () => photos.filter((photo) => matchesSearch(photo, normalizedSearchQuery)),
        [normalizedSearchQuery, photos],
    );
    const activeIndex = activeItemId
        ? galleryItems.findIndex((item) => item.id === activeItemId)
        : -1;
    const itemHeight = PHOTO_HEIGHT_LEVELS[scaleLevel] ?? PHOTO_HEIGHT_LEVELS[1];
    const handleOpen = useCallback((photoId: string) => setActiveItemId(photoId), []);
    const handleViewerChange = useCallback((nextIndex: number) => {
        setActiveItemId(galleryItems[nextIndex]?.id ?? null);
    }, [galleryItems]);
    const handleDelete = useCallback(async (photoId: string) => {
        await deletePhoto(photoId);
        setPhotos((currentPhotos) => currentPhotos.filter((photo) => photo.id !== photoId));
        setActiveItemId(null);
    }, []);
    const handleCloseViewer = useCallback(() => setActiveItemId(null), []);

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
        return <ContentPageEmptyState message="暂无照片。请先在设置的媒体库中添加照片目录并完成扫码。" />;
    }

    return (
        <>
            {isSearchActive ? (
                <SearchResults
                    photos={searchResults}
                    onOpen={handleOpen}
                />
            ) : (
                <>
                    <div className="flex flex-wrap items-start gap-x-10 gap-y-6 pb-8">
                        {galleryGroups.map((group) => (
                            <GalleryGroup
                                key={group.id}
                                group={group}
                                itemHeight={itemHeight}
                                titleDensity={scaleLevel === 0 ? "small" : scaleLevel === 1 ? "medium" : undefined}
                                onItemOpen={(item) => handleOpen(item.id)}
                            />
                        ))}
                    </div>
                    {hasMore ? (
                        <div className="flex justify-center pb-8">
                            <div ref={loadMoreSentinelRef} className="flex min-h-10 flex-col items-center gap-2">
                                {isLoadingMore ? <span className="text-sm text-slate-500 dark:text-slate-400">Loading...</span> : null}
                                {loadMoreError ? (
                                    <button
                                        type="button"
                                        className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                                        onClick={() => void loadMore(true)}
                                    >
                                        Retry loading photos
                                    </button>
                                ) : null}
                                {photos.length >= AUTO_LOAD_LIMIT && !isLoadingMore ? (
                                    <button
                                        type="button"
                                        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                                        onClick={() => void loadMore(true)}
                                    >
                                        Continue loading
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </>
            )}
            <PhotoViewer
                items={galleryItems}
                activeIndex={activeIndex >= 0 ? activeIndex : null}
                onChange={handleViewerChange}
                onDelete={handleDelete}
                onClose={handleCloseViewer}
            />
        </>
    );
}
