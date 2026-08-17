"use client";

import { ChevronDown } from "@gravity-ui/icons";
import { Alert, Card, ListBox, Pagination, SearchField, Select, Skeleton } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import ContentZoomSlider from "@/app/components/ContentZoomSlider";
import { getMediaLibraries, getVideoCatalog, type LibraryResponse, type VideoAssetResponse } from "@/src/api/client";
import VideoCard from "./components/VideoCard";
import styles from "./video-grid-skeleton.module.css";

const PAGE_SIZE = 48;
const VIDEO_ZOOM_LABELS = ["小", "较小", "正常", "较大", "大"] as const;
const videoZoomGridClasses = [styles.zoom0, styles.zoom1, styles.zoom2, styles.zoom3, styles.zoom4] as const;

type SortValue = "created" | "title" | "duration" | "updated";
type WatchedValue = "all" | "unwatched" | "in_progress" | "completed";

const watchedOptions: Array<{ id: WatchedValue; label: string }> = [
    { id: "all", label: "全部状态" },
    { id: "unwatched", label: "未观看" },
    { id: "in_progress", label: "继续观看" },
    { id: "completed", label: "已看完" },
];

const sortOptions: Array<{ id: SortValue; label: string }> = [
    { id: "created", label: "最近添加" },
    { id: "updated", label: "最近更新" },
    { id: "title", label: "名称" },
    { id: "duration", label: "时长" },
];

function FilterSelect<T extends string>({
    label,
    value,
    options,
    onChange,
    className,
}: {
    label: string;
    value: T;
    options: Array<{ id: T; label: string }>;
    onChange: (value: T) => void;
    className: string;
}) {
    return (
        <Select.Root aria-label={label} selectedKey={value} onSelectionChange={(key) => key && onChange(String(key) as T)}>
            <Select.Trigger aria-label={label} className={`h-9 ${className}`}>
                <Select.Value className="truncate" />
                <Select.Indicator><ChevronDown className="h-4 w-4" /></Select.Indicator>
            </Select.Trigger>
            <Select.Popover placement="bottom end">
                <ListBox>
                    {options.map((option) => <ListBox.Item key={option.id} id={option.id} textValue={option.label}>{option.label}</ListBox.Item>)}
                </ListBox>
            </Select.Popover>
        </Select.Root>
    );
}

function VideoGridSkeleton({ gridClassName }: { gridClassName: string }) {
    return (
        <div className={`${styles.grid} ${gridClassName}`} aria-label="正在加载视频">
            {Array.from({ length: 10 }).map((_, index) => (
                <Card.Root key={index}>
                    <Skeleton className={styles.thumbnail} />
                    <Card.Content className={styles.content}>
                        <Skeleton className={styles.title} />
                        <Skeleton className={styles.metadata} />
                    </Card.Content>
                </Card.Root>
            ))}
        </div>
    );
}

export default function VideoPage() {
    const router = useRouter();
    const [videos, setVideos] = useState<VideoAssetResponse[]>([]);
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [libraryId, setLibraryId] = useState("all");
    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [sort, setSort] = useState<SortValue>("created");
    const [watched, setWatched] = useState<WatchedValue>("all");
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [zoomLevel, setZoomLevel] = useState(2);

    useEffect(() => {
        void getMediaLibraries()
            .then((items) => setLibraries(items.filter((item) => ["video", "mixed_video"].includes(item.media_type))))
            .catch((cause) => setError(cause instanceof Error ? cause.message : "媒体库加载失败"));
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedQuery(query.trim());
            setPage(0);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        let canceled = false;
        setIsLoading(true);
        setError(null);
        void getVideoCatalog({
            libraryId: libraryId === "all" ? undefined : libraryId,
            search: debouncedQuery || undefined,
            sort,
            watched,
            order: sort === "title" ? "asc" : "desc",
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        }).then((catalog) => {
            if (canceled) return;
            setVideos(catalog.items);
            setTotal(catalog.total);
        }).catch((cause) => {
            if (!canceled) setError(cause instanceof Error ? cause.message : "视频加载失败");
        }).finally(() => {
            if (!canceled) setIsLoading(false);
        });
        return () => { canceled = true; };
    }, [debouncedQuery, libraryId, page, sort, watched]);

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const videoGridClassName = videoZoomGridClasses[zoomLevel] ?? videoZoomGridClasses[2];
    const libraryOptions = [
        { id: "all", label: "全部媒体库" },
        ...libraries.map((library) => ({ id: library.id, label: library.name })),
    ];

    const search = (
        <SearchField value={query} onChange={setQuery} aria-label="搜索视频" className="w-full">
            <SearchField.Group className="h-9">
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="搜索视频" />
                <SearchField.ClearButton />
            </SearchField.Group>
        </SearchField>
    );

    const filters = (
        <div className="flex items-center gap-2">
            <FilterSelect label="选择媒体库" value={libraryId} options={libraryOptions} className="w-40" onChange={(value) => { setLibraryId(value); setPage(0); }} />
            <FilterSelect label="观看状态" value={watched} options={watchedOptions} className="w-32" onChange={(value) => { setWatched(value); setPage(0); }} />
            <FilterSelect label="排序方式" value={sort} options={sortOptions} className="w-32" onChange={(value) => { setSort(value); setPage(0); }} />
        </div>
    );

    return (
        <ContentPageLayout
            title="视频"
            description={`${total} 个视频`}
            center={search}
            actions={<>{filters}<ContentZoomSlider value={zoomLevel} labels={VIDEO_ZOOM_LABELS} onChange={setZoomLevel} ariaLabel="视频卡片缩放" label="缩放" className="w-28" /></>}
            footer={!error && !isLoading && videos.length > 0 ? (
                <div className="mx-auto w-fit bg-surface-secondary p-2">
                    <Pagination size="sm">
                        <Pagination.Summary>第 {page + 1} / {pageCount} 页</Pagination.Summary>
                        <Pagination.Content>
                            <Pagination.Item>
                                <Pagination.Previous aria-label="上一页" isDisabled={page === 0} onPress={() => setPage((value) => Math.max(0, value - 1))}><Pagination.PreviousIcon /></Pagination.Previous>
                            </Pagination.Item>
                            <Pagination.Item><Pagination.Link isActive>{page + 1}</Pagination.Link></Pagination.Item>
                            <Pagination.Item>
                                <Pagination.Next aria-label="下一页" isDisabled={page + 1 >= pageCount} onPress={() => setPage((value) => value + 1)}><Pagination.NextIcon /></Pagination.Next>
                            </Pagination.Item>
                        </Pagination.Content>
                    </Pagination>
                </div>
            ) : null}
        >
            {error ? (
                <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                        <Alert.Title>无法加载视频</Alert.Title>
                        <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                </Alert>
            ) : null}
            {!error && isLoading ? <VideoGridSkeleton gridClassName={videoGridClassName} /> : null}
            {!error && !isLoading && total === 0 ? (
                <ContentPageEmptyState message={debouncedQuery || watched !== "all" ? "没有匹配的视频。" : "创建视频媒体库并扫描后，视频会显示在这里。"} />
            ) : null}
            {!error && !isLoading && videos.length > 0 ? (
                <div className={`${styles.grid} ${videoGridClassName}`}>
                    {videos.map((video) => <VideoCard key={video.id} video={video} onOpen={() => router.push(`/video/${video.id}`)} />)}
                </div>
            ) : null}
        </ContentPageLayout>
    );
}
