"use client";

import { useEffect, useMemo, useState } from "react";
import {
    getPhotos,
    getPreferences,
    type ListPhotosParams,
    type PhotoAssetResponse,
    type PreferencesResponse,
} from "@/src/api/client";
import GalleryGroup, { type GalleryGroupData } from "./components/GalleryGroup";
import PhotoViewer from "./components/PhotoViewer";

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

function getGridSource(
    photo: PhotoAssetResponse,
    photoDisplaySource: PreferencesResponse["photo_display_source"],
) {
    if (photoDisplaySource === "thumbnail") {
        return photo.thumbnail_src ?? photo.preview_src ?? photo.original_src ?? photo.src;
    }

    return photo.original_src ?? photo.src;
}

function getViewerSource(
    photo: PhotoAssetResponse,
    photoDisplaySource: PreferencesResponse["photo_display_source"],
) {
    if (photoDisplaySource === "thumbnail") {
        return photo.preview_src ?? photo.original_src ?? photo.src;
    }

    return photo.original_src ?? photo.src;
}

function buildGalleryGroups(
    photos: PhotoAssetResponse[],
    photoDisplaySource: PreferencesResponse["photo_display_source"],
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

        group.items.push({
            id: photo.id,
            src: getGridSource(photo, photoDisplaySource),
            viewerSrc: getViewerSource(photo, photoDisplaySource),
            originalSrc: photo.original_src ?? photo.src,
            alt: photo.title,
            width: photo.width ?? undefined,
            height: photo.height ?? undefined,
            fileName: photo.file_name,
            fileSize: photo.file_size,
            mimeType: photo.mime_type ?? undefined,
            takenAt: photo.taken_at ?? photo.batch_time,
        });

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

export default function PhotoPage() {
    const pageSize = 200;
    const [photos, setPhotos] = useState<PhotoAssetResponse[]>([]);
    const [preferences, setPreferences] = useState<PreferencesResponse | null>(null);
    const [activeItemId, setActiveItemId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
                const [photoData, preferenceData] = await Promise.all([
                    getPhotos({
                        limit,
                        offset,
                    }),
                    getPreferences(),
                ]);

                if (!cancelled) {
                    setPhotos((currentPhotos) => (
                        offset === 0 ? photoData : [...currentPhotos, ...photoData]
                    ));
                    setPreferences(preferenceData);
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

    const photoDisplaySource = preferences?.photo_display_source ?? "thumbnail";
    const galleryGroups = useMemo(
        () => buildGalleryGroups(photos, photoDisplaySource),
        [photoDisplaySource, photos],
    );
    const galleryItems = useMemo(
        () => galleryGroups.flatMap((group) => group.items),
        [galleryGroups],
    );
    const activeIndex = activeItemId
        ? galleryItems.findIndex((item) => item.id === activeItemId)
        : -1;

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
                正在加载照片...
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                {error}
            </div>
        );
    }

    if (galleryGroups.length === 0) {
        return (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 text-sm text-slate-500">
                暂无照片。请先在设置的媒体库中添加照片目录并完成扫码。
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-wrap items-start gap-x-10 gap-y-6 pb-8">
                {galleryGroups.map((group) => (
                    <GalleryGroup
                        key={group.id}
                        group={group}
                        onItemOpen={(item) => setActiveItemId(item.id)}
                    />
                ))}
            </div>
            {hasMore ? (
                <div className="flex justify-center pb-8">
                    <button
                        type="button"
                        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
            <PhotoViewer
                items={galleryItems}
                activeIndex={activeIndex >= 0 ? activeIndex : null}
                onChange={(nextIndex) => {
                    setActiveItemId(galleryItems[nextIndex]?.id ?? null);
                }}
                onClose={() => setActiveItemId(null)}
            />
        </>
    );
}
