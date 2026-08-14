"use client";

import { Folder, Magnifier, Picture } from "@gravity-ui/icons";
import { Breadcrumbs, Card } from "@heroui/react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    deletePhoto,
    getMediaLibraries,
    getPhotoFolderContents,
    type LibraryResponse,
    type PhotoAssetResponse,
    type PhotoFolderContentsResponse,
    type PhotoFolderResponse,
} from "@/src/api/client";
import type { GalleryItemData } from "../components/GalleryItem";
import PhotoViewer from "../components/PhotoViewer";
import { usePhotoShell } from "../components/PhotoShellContext";

type FolderEntry = {
    id: string;
    name: string;
    path: string;
    photoCount: number | null;
    coverItems: GalleryItemData[];
};

type MixedEntry =
    | { type: "folder"; key: string; folder: FolderEntry }
    | { type: "photo"; key: string; item: GalleryItemData };

const COLUMN_LEVELS = [16, 13, 10, 7] as const;
const PHOTO_PAGE_SIZE = 100;

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error && "message" in error) {
        return String(error.message);
    }
    return "照片数据加载失败，请确认 API 服务已启动。";
}

function getGridSource(photo: PhotoAssetResponse) {
    return photo.preview_src ?? photo.original_src ?? photo.src;
}

function getViewerSource(photo: PhotoAssetResponse) {
    return photo.preview_src ?? photo.original_src ?? photo.src;
}

function toGalleryItem(photo: PhotoAssetResponse): GalleryItemData {
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

function toFolderEntry(folder: PhotoFolderResponse): FolderEntry {
    return {
        id: folder.path,
        name: folder.name,
        path: folder.path,
        photoCount: folder.photo_count,
        coverItems: folder.cover ? [toGalleryItem(folder.cover)] : [],
    };
}

function getItemLabel(item: GalleryItemData) {
    if (item.fileName) return item.fileName;
    try {
        const url = new URL(item.src, "http://localhost");
        return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? item.id);
    } catch {
        return item.id;
    }
}

function normalizeKeyword(value: string) {
    return value.trim().toLocaleLowerCase("zh-CN");
}

function decodePathSegment(segment: string) {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function FolderCollage({ items, label }: { items: GalleryItemData[]; label: string }) {
    const cover = items[0];
    if (!cover) {
        return (
            <div className="flex h-full items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                <Folder className="h-6 w-6" />
            </div>
        );
    }

    return (
        <div className="relative h-full w-full overflow-hidden">
            <Image
                src={cover.src}
                alt={label}
                fill
                sizes="20vw"
                unoptimized
                className="object-cover"
            />
        </div>
    );
}

function EntryTitle({ title }: { title: string }) {
    return <p className="mt-2 truncate px-1 text-[11px] font-medium text-slate-700 dark:text-slate-200">{title}</p>;
}

function FolderCard({ folder, onOpen }: { folder: FolderEntry; onOpen: () => void }) {
    return (
        <button type="button" className="min-w-0 text-left" onClick={onOpen}>
            <Card className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-none transition-all hover:-translate-y-0.5 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-700">
                <Card.Content className="p-0">
                    <div className="relative aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                        <FolderCollage items={folder.coverItems} label={folder.name} />
                        {folder.photoCount !== null && (
                            <div className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                                {folder.photoCount}
                            </div>
                        )}
                    </div>
                </Card.Content>
            </Card>
            <EntryTitle title={folder.name} />
        </button>
    );
}

function PhotoCard({ item, onOpen }: { item: GalleryItemData; onOpen: () => void }) {
    return (
        <button type="button" className="min-w-0 text-left" onClick={onOpen}>
            <Card className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-none transition-all hover:-translate-y-0.5 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                <Card.Content className="p-0">
                    <div className="relative aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                        <Image src={item.src} alt={item.alt ?? getItemLabel(item)} fill sizes="20vw" unoptimized className="object-cover" />
                    </div>
                </Card.Content>
            </Card>
            <EntryTitle title={getItemLabel(item)} />
        </button>
    );
}

function SearchSection({ title, icon, count, children }: { title: string; icon: ReactNode; count: number; children: ReactNode }) {
    return (
        <section className="rounded-[28px] border border-slate-200/80 bg-white/96 p-5 shadow-[0_14px_36px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/88 dark:shadow-none">
            <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{icon}</div>
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{count} 个结果</p>
                </div>
            </div>
            {children}
        </section>
    );
}

export default function FolderPage() {
    const { scaleLevel, searchQuery, setScaleMode } = usePhotoShell();
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
    const [activePath, setActivePath] = useState("");
    const [contents, setContents] = useState<PhotoFolderContentsResponse | null>(null);
    const [activeItemId, setActiveItemId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestId = useRef(0);

    useEffect(() => {
        setScaleMode("folder-columns");
        return () => setScaleMode("none");
    }, [setScaleMode]);

    useEffect(() => {
        let cancelled = false;
        void getMediaLibraries()
            .then((data) => {
                if (!cancelled) setLibraries(data.filter((library) => library.media_type === "photo"));
            })
            .catch((loadError) => {
                if (!cancelled) setError(getErrorMessage(loadError));
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    const loadFolder = useCallback(async (libraryId: string, path: string, offset = 0) => {
        const currentRequest = ++requestId.current;
        setError(null);
        if (offset === 0) setIsLoading(true);
        else setIsLoadingMore(true);

        try {
            const nextContents = await getPhotoFolderContents(libraryId, {
                path: path || undefined,
                limit: PHOTO_PAGE_SIZE,
                offset,
            });
            if (currentRequest !== requestId.current) return;
            setActiveLibraryId(libraryId);
            setActivePath(nextContents.path);
            setContents((current) => offset > 0 && current
                ? { ...nextContents, photos: [...current.photos, ...nextContents.photos] }
                : nextContents);
            setActiveItemId(null);
        } catch (loadError) {
            if (currentRequest === requestId.current) setError(getErrorMessage(loadError));
        } finally {
            if (currentRequest === requestId.current) {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        }
    }, []);

    const activeLibrary = libraries.find((library) => library.id === activeLibraryId) ?? null;
    const folders = useMemo(() => {
        if (!activeLibraryId) {
            return libraries.map((library) => ({
                id: library.id,
                name: library.name,
                path: "",
                photoCount: null,
                coverItems: [],
            }));
        }
        return (contents?.folders ?? []).map(toFolderEntry);
    }, [activeLibraryId, contents?.folders, libraries]);
    const photos = useMemo(() => (contents?.photos ?? []).map(toGalleryItem), [contents?.photos]);
    const keyword = normalizeKeyword(searchQuery);
    const matchedFolders = useMemo(() => keyword ? folders.filter((folder) => folder.name.toLocaleLowerCase("zh-CN").includes(keyword)) : folders, [folders, keyword]);
    const matchedPhotos = useMemo(() => keyword ? photos.filter((item) => getItemLabel(item).toLocaleLowerCase("zh-CN").includes(keyword)) : photos, [keyword, photos]);
    const mixedEntries = useMemo<MixedEntry[]>(() => [
        ...folders.map((folder) => ({ type: "folder" as const, key: folder.id, folder })),
        ...photos.map((item) => ({ type: "photo" as const, key: item.id, item })),
    ], [folders, photos]);
    const activeIndex = activeItemId ? photos.findIndex((item) => item.id === activeItemId) : -1;
    const gridColumns = COLUMN_LEVELS[scaleLevel] ?? COLUMN_LEVELS[1];
    const gridStyle = { gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` };

    const openFolder = (folder: FolderEntry) => {
        if (!activeLibraryId) void loadFolder(folder.id, "");
        else void loadFolder(activeLibraryId, folder.path);
    };

    if (isLoading && !contents && activeLibraryId) {
        return <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">正在加载文件夹...</div>;
    }
    if (isLoading && !activeLibraryId) {
        return <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">正在加载媒体库...</div>;
    }
    if (error && !contents) {
        return <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-400">{error}</div>;
    }

    const breadcrumbSegments = activePath.split("/").filter(Boolean);

    return (
        <>
            <section className="mb-3">
                <div className="overflow-x-auto">
                    <Breadcrumbs className="inline-block min-w-max whitespace-nowrap [&_nav]:whitespace-nowrap [&_ol]:inline-flex [&_ol]:min-w-max [&_ol]:flex-nowrap [&_ol]:items-center [&_ol]:gap-1 [&_li]:inline-flex [&_li]:shrink-0 [&_li]:whitespace-nowrap [&_a]:inline-flex [&_a]:shrink-0 [&_a]:whitespace-nowrap [&_span]:whitespace-nowrap" separator={<span className="px-1 text-slate-300">/</span>}>
                        <Breadcrumbs.Item className="shrink-0 whitespace-nowrap" onPress={() => { setActiveLibraryId(null); setActivePath(""); setContents(null); setActiveItemId(null); setError(null); }}>
                            全部媒体库
                        </Breadcrumbs.Item>
                        {activeLibrary && <Breadcrumbs.Item className="shrink-0 whitespace-nowrap" onPress={() => void loadFolder(activeLibrary.id, "")}>{activeLibrary.name}</Breadcrumbs.Item>}
                        {breadcrumbSegments.map((segment, index) => {
                            const path = breadcrumbSegments.slice(0, index + 1).join("/");
                            return <Breadcrumbs.Item key={path} className="shrink-0 whitespace-nowrap" onPress={() => activeLibraryId && void loadFolder(activeLibraryId, path)}>{decodePathSegment(segment)}</Breadcrumbs.Item>;
                        })}
                    </Breadcrumbs>
                </div>
            </section>

            {error && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-400">{error}</div>}

            {keyword ? (
                <section className="space-y-5 pb-8">
                    <div className="flex items-center gap-3 rounded-[28px] border border-slate-200/80 bg-white/96 p-5 dark:border-slate-800 dark:bg-slate-950/88">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500 text-white"><Magnifier className="h-5 w-5" /></div>
                        <div><h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">搜索结果</h1><p className="text-sm text-slate-500 dark:text-slate-400">仅搜索当前目录已加载的内容</p></div>
                    </div>
                    <SearchSection title="匹配的文件夹" icon={<Folder className="h-5 w-5" />} count={matchedFolders.length}>
                        <div className="grid gap-x-4 gap-y-5" style={gridStyle}>{matchedFolders.map((folder) => <FolderCard key={folder.id} folder={folder} onOpen={() => openFolder(folder)} />)}</div>
                    </SearchSection>
                    <SearchSection title="匹配的照片" icon={<Picture className="h-5 w-5" />} count={matchedPhotos.length}>
                        <div className="grid gap-x-4 gap-y-5" style={gridStyle}>{matchedPhotos.map((item) => <PhotoCard key={item.id} item={item} onOpen={() => setActiveItemId(item.id)} />)}</div>
                    </SearchSection>
                </section>
            ) : (
                <section className="pb-8">
                    {mixedEntries.length > 0 ? <div className="grid gap-x-4 gap-y-5" style={gridStyle}>{mixedEntries.map((entry) => entry.type === "folder" ? <FolderCard key={entry.key} folder={entry.folder} onOpen={() => openFolder(entry.folder)} /> : <PhotoCard key={entry.key} item={entry.item} onOpen={() => setActiveItemId(entry.item.id)} />)}</div> : <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">当前目录下没有文件夹或照片。</div>}
                    {contents?.next_offset !== null && contents?.next_offset !== undefined && <div className="mt-6 flex justify-center"><button type="button" disabled={isLoadingMore} onClick={() => activeLibraryId && void loadFolder(activeLibraryId, activePath, contents.next_offset ?? 0)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200">{isLoadingMore ? "加载中..." : "加载更多照片"}</button></div>}
                </section>
            )}

            <PhotoViewer
                items={photos}
                activeIndex={activeIndex >= 0 ? activeIndex : null}
                onChange={(nextIndex) => setActiveItemId(photos[nextIndex]?.id ?? null)}
                onDelete={async (photoId) => {
                    await deletePhoto(photoId);
                    setContents((current) => current ? { ...current, photos: current.photos.filter((photo) => photo.id !== photoId), total_photos: Math.max(0, current.total_photos - 1) } : current);
                    setActiveItemId(null);
                }}
                onClose={() => setActiveItemId(null)}
            />
        </>
    );
}
