"use client";

import { ChevronDown } from "@gravity-ui/icons";
import { Alert, ListBox, Pagination, SearchField, Select, Skeleton } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import { getMediaLibraries, getVideoCatalog, type LibraryResponse, type VideoAssetResponse } from "@/src/api/client";
import VideoCard from "./components/VideoCard";

const PAGE_SIZE = 48;

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

function VideoGridSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="overflow-hidden border border-border">
                    <Skeleton className="aspect-video w-full rounded-none" />
                    <div className="space-y-3 p-3">
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="h-3 w-2/5" />
                    </div>
                </div>
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
    const libraryOptions = [
        { id: "all", label: "全部媒体库" },
        ...libraries.map((library) => ({ id: library.id, label: library.name })),
    ];

    const controls = (
        <div className="flex items-center gap-2">
            <SearchField value={query} onChange={setQuery} aria-label="搜索视频" className="w-48">
                <SearchField.Group className="h-9">
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="搜索视频" />
                    <SearchField.ClearButton />
                </SearchField.Group>
            </SearchField>
            <FilterSelect label="选择媒体库" value={libraryId} options={libraryOptions} className="w-40" onChange={(value) => { setLibraryId(value); setPage(0); }} />
            <FilterSelect label="观看状态" value={watched} options={watchedOptions} className="w-32" onChange={(value) => { setWatched(value); setPage(0); }} />
            <FilterSelect label="排序方式" value={sort} options={sortOptions} className="w-32" onChange={(value) => { setSort(value); setPage(0); }} />
        </div>
    );

    return (
        <ContentPageLayout title="视频" description={`${total} 个视频`} header={controls}>
            {error ? (
                <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                        <Alert.Title>无法加载视频</Alert.Title>
                        <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                </Alert>
            ) : null}
            {!error && isLoading ? <VideoGridSkeleton /> : null}
            {!error && !isLoading && total === 0 ? (
                <ContentPageEmptyState message={debouncedQuery || watched !== "all" ? "没有匹配的视频。" : "创建视频媒体库并扫描后，视频会显示在这里。"} />
            ) : null}
            {!error && !isLoading && videos.length > 0 ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                        {videos.map((video) => <VideoCard key={video.id} video={video} onOpen={() => router.push(`/video/${video.id}`)} />)}
                    </div>
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
                </div>
            ) : null}
        </ContentPageLayout>
    );
}
