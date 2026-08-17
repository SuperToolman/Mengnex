"use client";

import { SearchField } from "@heroui/react";
import { useEffect, useState } from "react";
import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import ContentZoomSlider from "@/app/components/ContentZoomSlider";
import { getNovels, type NovelBookResponse } from "@/src/api/client";
import NovelCard from "./components/NovelCard";

export default function NovelPage() {
    const [books, setBooks] = useState<NovelBookResponse[]>([]);
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [zoomLevel, setZoomLevel] = useState(2);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setLoading(true);
            void getNovels({ search: query.trim() || undefined, limit: 200 })
                .then(setBooks)
                .catch((cause) => setError(cause instanceof Error ? cause.message : "小说加载失败"))
                .finally(() => setLoading(false));
        }, 250);
        return () => window.clearTimeout(timer);
    }, [query]);

    const search = (
        <SearchField value={query} onChange={setQuery} aria-label="搜索小说" className="w-full"><SearchField.Group className="h-9"><SearchField.SearchIcon /><SearchField.Input placeholder="搜索小说标题" /><SearchField.ClearButton /></SearchField.Group></SearchField>
    );

    return (
        <ContentPageLayout
            title="小说"
            description={`${books.length} 本小说`}
            center={search}
            actions={<ContentZoomSlider value={zoomLevel} labels={["小", "较小", "正常", "较大", "大"]} onChange={setZoomLevel} ariaLabel="小说卡片缩放" label="缩放" className="w-28" />}
        >
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {!error && loading ? <p className="text-sm text-muted">正在加载小说...</p> : null}
            {!error && !loading && books.length === 0 ? <ContentPageEmptyState message={query ? "没有匹配的小说。" : "创建小说媒体库并扫描后，小说会显示在这里。"} /> : null}
            {!error && books.length > 0 ? (
                <div className={["grid gap-4", "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10", "grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9", "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8", "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6", "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"][zoomLevel] ?? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"}>
                    {books.map((book) => <NovelCard key={book.id} book={book} />)}
                </div>
            ) : null}
        </ContentPageLayout>
    );
}
