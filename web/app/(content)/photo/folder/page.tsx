"use client";

import { Folder, Magnifier, Picture } from "@gravity-ui/icons";
import { Breadcrumbs, Card } from "@heroui/react";
import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    deletePhoto,
    getMediaLibraries,
    getPhotos,
    type LibraryResponse,
    type PhotoAssetResponse,
} from "@/src/api/client";
import type { GalleryItemData } from "../components/GalleryItem";
import PhotoViewer from "../components/PhotoViewer";
import { usePhotoShell } from "../components/PhotoShellContext";

type FolderTreeNode = {
    id: string;
    name: string;
    segments: string[];
    folders: FolderTreeNode[];
    items: GalleryItemData[];
    coverItems: GalleryItemData[];
    totalFolderCount: number;
    totalPhotoCount: number;
};

type MutableFolderTreeNode = {
    id: string;
    name: string;
    segments: string[];
    folders: Map<string, MutableFolderTreeNode>;
    items: GalleryItemData[];
};

type MixedEntry =
    | { type: "folder"; key: string; folder: FolderTreeNode }
    | { type: "photo"; key: string; item: GalleryItemData };

const COLUMN_LEVELS = [16, 13, 10, 7] as const;

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "object" && error && "message" in error) {
        return String(error.message);
    }

    return "照片数据加载失败，请确认 API 服务已启动";
}

function getGridSource(photo: PhotoAssetResponse) {
    return photo.thumbnail_src ?? photo.preview_src ?? photo.original_src ?? photo.src;
}

function getViewerSource(photo: PhotoAssetResponse) {
    return photo.preview_src ?? photo.thumbnail_src ?? photo.original_src ?? photo.src;
}

function toGalleryItem(photo: PhotoAssetResponse): GalleryItemData {
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

function normalizePath(path: string) {
    return path.replaceAll("\\", "/").replace(/\/+/g, "/").trim();
}

function toPathSegments(path: string) {
    return normalizePath(path)
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function isDriveLetterSegment(segment: string) {
    return /^[A-Za-z]:$/.test(segment);
}

function equalsPathSegment(left: string, right: string) {
    return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function startsWithSegments(source: string[], prefix: string[]) {
    if (prefix.length > source.length) {
        return false;
    }

    return prefix.every((segment, index) => equalsPathSegment(source[index] ?? "", segment));
}

function getLibraryRootName(library?: LibraryResponse) {
    if (!library) {
        return "未分类";
    }

    const rootSegments = toPathSegments(library.root_path);
    const rootName = rootSegments.at(-1);

    if (rootName && !isDriveLetterSegment(rootName)) {
        return rootName;
    }

    return library.name;
}

function getFolderSegments(
    photo: PhotoAssetResponse,
    libraryMap: Map<string, LibraryResponse>,
) {
    const library = libraryMap.get(photo.library_id);
    const sourceSegments = toPathSegments(photo.source_path);

    if (sourceSegments.length === 0) {
        return [getLibraryRootName(library)];
    }

    const filePathSegments = sourceSegments.slice(0, -1);

    if (library) {
        const rootSegments = toPathSegments(library.root_path);

        if (startsWithSegments(sourceSegments, rootSegments)) {
            const relativeSegments = filePathSegments.slice(rootSegments.length);
            return [getLibraryRootName(library), ...relativeSegments];
        }
    }

    const fallbackSegments = filePathSegments.filter((segment, index) => (
        !(index === 0 && isDriveLetterSegment(segment))
    ));

    return fallbackSegments.length > 0
        ? fallbackSegments
        : [getLibraryRootName(library)];
}

function compareFolderNodes(left: FolderTreeNode, right: FolderTreeNode) {
    return left.name.localeCompare(right.name, "zh-CN", {
        numeric: true,
        sensitivity: "base",
    });
}

function finalizeFolderNode(node: MutableFolderTreeNode): FolderTreeNode {
    const folders = Array.from(node.folders.values())
        .map(finalizeFolderNode)
        .sort(compareFolderNodes);
    const totalFolderCount = folders.length + folders.reduce(
        (total, folder) => total + folder.totalFolderCount,
        0,
    );
    const totalPhotoCount = node.items.length + folders.reduce(
        (total, folder) => total + folder.totalPhotoCount,
        0,
    );
    const coverItems = [
        ...node.items,
        ...folders.flatMap((folder) => folder.coverItems),
    ].slice(0, 5);

    return {
        id: node.id,
        name: node.name,
        segments: node.segments,
        folders,
        items: node.items,
        coverItems,
        totalFolderCount,
        totalPhotoCount,
    };
}

function buildFolderTree(
    photos: PhotoAssetResponse[],
    libraries: LibraryResponse[],
) {
    const root: MutableFolderTreeNode = {
        id: "root",
        name: "全部文件夹",
        segments: [],
        folders: new Map(),
        items: [],
    };
    const libraryMap = new Map(libraries.map((library) => [library.id, library]));

    for (const photo of photos) {
        const folderSegments = getFolderSegments(photo, libraryMap);
        const item = toGalleryItem(photo);
        let currentNode = root;

        folderSegments.forEach((segment, index) => {
            const pathSegments = folderSegments.slice(0, index + 1);
            const nodeId = pathSegments.join("/");
            const nextNode = currentNode.folders.get(segment) ?? {
                id: nodeId,
                name: segment,
                segments: pathSegments,
                folders: new Map(),
                items: [],
            };

            currentNode.folders.set(segment, nextNode);
            currentNode = nextNode;
        });

        currentNode.items.push(item);
    }

    return finalizeFolderNode(root);
}

function findFolderNode(root: FolderTreeNode, segments: string[]) {
    let currentNode: FolderTreeNode = root;

    for (const segment of segments) {
        const nextNode = currentNode.folders.find((folder) => folder.name === segment);

        if (!nextNode) {
            return null;
        }

        currentNode = nextNode;
    }

    return currentNode;
}

function getItemLabel(item: GalleryItemData) {
    if (item.fileName) {
        return item.fileName;
    }

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

function buildMixedEntries(folder: FolderTreeNode) {
    const folderEntries: MixedEntry[] = folder.folders.map((child) => ({
        type: "folder",
        key: child.id,
        folder: child,
    }));
    const photoEntries: MixedEntry[] = folder.items.map((item) => ({
        type: "photo",
        key: item.id,
        item,
    }));

    return [...folderEntries, ...photoEntries];
}

function filterFolderMatches(folders: FolderTreeNode[], keyword: string) {
    const normalizedKeyword = normalizeKeyword(keyword);

    if (!normalizedKeyword) {
        return folders;
    }

    return folders.filter((folder) => (
        folder.name.toLocaleLowerCase("zh-CN").includes(normalizedKeyword)
    ));
}

function filterPhotoMatches(items: GalleryItemData[], keyword: string) {
    const normalizedKeyword = normalizeKeyword(keyword);

    if (!normalizedKeyword) {
        return items;
    }

    return items.filter((item) => (
        getItemLabel(item).toLocaleLowerCase("zh-CN").includes(normalizedKeyword)
    ));
}

function FolderCollage({
    items,
    label,
}: {
    items: GalleryItemData[];
    label: string;
}) {
    if (items.length === 0) {
        return (
            <div className="flex h-full items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                <Folder className="h-6 w-6" />
            </div>
        );
    }

    if (items.length === 1) {
        return (
            <div className="relative h-full w-full overflow-hidden">
                <Image
                    src={items[0].src}
                    alt={label}
                    fill
                    sizes="20vw"
                    unoptimized
                    className="object-cover"
                />
            </div>
        );
    }

    if (items.length < 5) {
        return (
            <div className="grid h-full grid-cols-2 overflow-hidden">
                <div className="relative h-full">
                    <Image
                        src={items[0].src}
                        alt={label}
                        fill
                        sizes="20vw"
                        unoptimized
                        className="object-cover"
                    />
                </div>
                <div className="grid h-full grid-rows-3">
                    {items.slice(1).map((item) => (
                        <div key={item.id} className="relative h-full">
                            <Image
                                src={item.src}
                                alt={label}
                                fill
                                sizes="10vw"
                                unoptimized
                                className="object-cover"
                            />
                        </div>
                    ))}
                    {Array.from({ length: Math.max(0, 4 - items.length) }).map((_, index) => (
                        <div key={`placeholder-${index}`} className="bg-slate-100 dark:bg-slate-800" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="grid h-full grid-cols-2 overflow-hidden">
            <div className="grid h-full grid-rows-2">
                {items.slice(0, 2).map((item) => (
                    <div key={item.id} className="relative h-full">
                        <Image
                            src={item.src}
                            alt={label}
                            fill
                            sizes="10vw"
                            unoptimized
                            className="object-cover"
                        />
                    </div>
                ))}
            </div>
            <div className="grid h-full grid-rows-3">
                {items.slice(2, 5).map((item) => (
                    <div key={item.id} className="relative h-full">
                        <Image
                            src={item.src}
                            alt={label}
                            fill
                            sizes="10vw"
                            unoptimized
                            className="object-cover"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function EntryTitle({ title }: { title: string }) {
    return (
        <p className="mt-2 truncate px-1 text-[11px] font-medium text-slate-700 dark:text-slate-200">
            {title}
        </p>
    );
}

function FolderCard({
    folder,
    onOpen,
}: {
    folder: FolderTreeNode;
    onOpen: () => void;
}) {
    const totalChildren = folder.totalFolderCount + folder.totalPhotoCount;

    return (
        <button type="button" className="min-w-0 text-left" onClick={onOpen}>
            <Card className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-none transition-all hover:-translate-y-0.5 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-700">
                <Card.Content className="p-0">
                    <div className="relative aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                        <FolderCollage items={folder.coverItems} label={folder.name} />
                        <div className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                            {totalChildren}
                        </div>
                    </div>
                </Card.Content>
            </Card>
            <EntryTitle title={folder.name} />
        </button>
    );
}

function PhotoCard({
    item,
    onOpen,
}: {
    item: GalleryItemData;
    onOpen: () => void;
}) {
    return (
        <button type="button" className="min-w-0 text-left" onClick={onOpen}>
            <Card className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-none transition-all hover:-translate-y-0.5 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                <Card.Content className="p-0">
                    <div className="relative aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                        <Image
                            src={item.src}
                            alt={item.alt ?? getItemLabel(item)}
                            fill
                            sizes="20vw"
                            unoptimized
                            className="object-cover"
                        />
                    </div>
                </Card.Content>
            </Card>
            <EntryTitle title={getItemLabel(item)} />
        </button>
    );
}

function SearchSection({
    title,
    icon,
    count,
    children,
}: {
    title: string;
    icon: ReactNode;
    count: number;
    children: ReactNode;
}) {
    return (
        <section className="rounded-[28px] border border-slate-200/80 bg-white/96 p-5 shadow-[0_14px_36px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950/88 dark:shadow-none">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {icon}
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                            {title}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {count} 个结果
                        </p>
                    </div>
                </div>
            </div>
            {children}
        </section>
    );
}

async function getAllPhotos(pageSize = 500) {
    const allPhotos: PhotoAssetResponse[] = [];
    let offset = 0;

    while (true) {
        const batch = await getPhotos({
            limit: pageSize,
            offset,
        });

        allPhotos.push(...batch);

        if (batch.length < pageSize) {
            return allPhotos;
        }

        offset += batch.length;
    }
}

export default function FolderPage() {
    const { scaleLevel, searchQuery, setScaleMode } = usePhotoShell();
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [photos, setPhotos] = useState<PhotoAssetResponse[]>([]);
    const [activeSegments, setActiveSegments] = useState<string[]>([]);
    const [activeItemId, setActiveItemId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setScaleMode("folder-columns");

        return () => {
            setScaleMode("none");
        };
    }, [setScaleMode]);

    useEffect(() => {
        let cancelled = false;

        async function loadData() {
            try {
                setIsLoading(true);
                setError(null);
                const [libraryData, photoData] = await Promise.all([
                    getMediaLibraries(),
                    getAllPhotos(),
                ]);

                if (!cancelled) {
                    setLibraries(libraryData);
                    setPhotos(photoData);
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

        void loadData();

        return () => {
            cancelled = true;
        };
    }, []);

    const folderTree = useMemo(
        () => buildFolderTree(photos, libraries),
        [libraries, photos],
    );
    const activeFolder = useMemo(
        () => findFolderNode(folderTree, activeSegments) ?? folderTree,
        [activeSegments, folderTree],
    );
    const viewerItems = activeFolder.items;
    const activeIndex = activeItemId
        ? viewerItems.findIndex((item) => item.id === activeItemId)
        : -1;
    const mixedEntries = useMemo(
        () => buildMixedEntries(activeFolder),
        [activeFolder],
    );
    const matchedFolders = useMemo(
        () => filterFolderMatches(activeFolder.folders, searchQuery),
        [activeFolder.folders, searchQuery],
    );
    const matchedPhotos = useMemo(
        () => filterPhotoMatches(activeFolder.items, searchQuery),
        [activeFolder.items, searchQuery],
    );
    const isSearchActive = normalizeKeyword(searchQuery).length > 0;
    const gridColumns = COLUMN_LEVELS[scaleLevel] ?? COLUMN_LEVELS[1];

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                正在构建文件夹视图...
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

    if (folderTree.folders.length === 0) {
        return (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
                暂无照片。请先在设置的媒体库中添加照片目录并完成扫描。
            </div>
        );
    }

    return (
        <>
            <section className="mb-3">
                <div className="overflow-x-auto">
                    <Breadcrumbs
                        className="inline-block min-w-max whitespace-nowrap [&_nav]:whitespace-nowrap [&_ol]:inline-flex [&_ol]:min-w-max [&_ol]:flex-nowrap [&_ol]:items-center [&_ol]:gap-1 [&_li]:inline-flex [&_li]:shrink-0 [&_li]:whitespace-nowrap [&_a]:inline-flex [&_a]:shrink-0 [&_a]:whitespace-nowrap [&_span]:whitespace-nowrap"
                        separator={<span className="px-1 text-slate-300">/</span>}
                    >
                        <Breadcrumbs.Item
                            className="shrink-0 whitespace-nowrap"
                            onPress={() => setActiveSegments([])}
                        >
                            全部文件夹
                        </Breadcrumbs.Item>
                        {activeFolder.segments.map((segment, index) => {
                            const segmentPath = activeFolder.segments.slice(0, index + 1);

                            return (
                                <Breadcrumbs.Item
                                    key={segmentPath.join("/")}
                                    className="shrink-0 whitespace-nowrap"
                                    onPress={() => setActiveSegments(segmentPath)}
                                >
                                    {segment}
                                </Breadcrumbs.Item>
                            );
                        })}
                    </Breadcrumbs>
                </div>
            </section>

            {isSearchActive ? (
                <section className="pb-8">
                    <div className="mb-5 rounded-[32px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(17,24,39,0.92))] dark:shadow-none">
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500 text-white">
                                <Magnifier className="h-5 w-5" />
                            </div>
                            <div>
                                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                                    搜索结果
                                </h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    当前目录共匹配 {matchedFolders.length + matchedPhotos.length} 个结果
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-5">
                        <SearchSection
                            title="匹配的文件夹"
                            icon={<Folder className="h-5 w-5" />}
                            count={matchedFolders.length}
                        >
                            {matchedFolders.length > 0 ? (
                                <div
                                    className="grid gap-x-4 gap-y-5"
                                    style={{
                                        gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                                    }}
                                >
                                    {matchedFolders.map((folder) => (
                                        <FolderCard
                                            key={folder.id}
                                            folder={folder}
                                            onOpen={() => setActiveSegments(folder.segments)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                    没有匹配的文件夹。
                                </div>
                            )}
                        </SearchSection>

                        <SearchSection
                            title="匹配的照片"
                            icon={<Picture className="h-5 w-5" />}
                            count={matchedPhotos.length}
                        >
                            {matchedPhotos.length > 0 ? (
                                <div
                                    className="grid gap-x-4 gap-y-5"
                                    style={{
                                        gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                                    }}
                                >
                                    {matchedPhotos.map((item) => (
                                        <PhotoCard
                                            key={item.id}
                                            item={item}
                                            onOpen={() => setActiveItemId(item.id)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                    没有匹配的照片。
                                </div>
                            )}
                        </SearchSection>
                    </div>
                </section>
            ) : (
                <section className="pb-8">
                    {mixedEntries.length > 0 ? (
                        <div
                            className="grid gap-x-4 gap-y-5"
                            style={{
                                gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                            }}
                        >
                            {mixedEntries.map((entry) => (
                                entry.type === "folder" ? (
                                    <FolderCard
                                        key={entry.key}
                                        folder={entry.folder}
                                        onOpen={() => setActiveSegments(entry.folder.segments)}
                                    />
                                ) : (
                                    <PhotoCard
                                        key={entry.key}
                                        item={entry.item}
                                        onOpen={() => setActiveItemId(entry.item.id)}
                                    />
                                )
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            当前目录下没有文件夹或照片。
                        </div>
                    )}
                </section>
            )}

            <PhotoViewer
                items={viewerItems}
                activeIndex={activeIndex >= 0 ? activeIndex : null}
                onChange={(nextIndex) => {
                    setActiveItemId(viewerItems[nextIndex]?.id ?? null);
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
