"use client";

import { SearchField } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import ContentPageLayout, { ContentPageEmptyState } from "@/app/components/ContentPageLayout";
import ContentZoomSlider from "@/app/components/ContentZoomSlider";
import { getMangaSeries, type MangaSeriesResponse } from "@/src/api/client";
import MangaCard from "../components/MangaCard";
import MangaNavigationTabs from "../components/MangaNavigationTabs";

const mangaGridClasses = [
    "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12",
    "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-10",
    "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8",
    "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4",
] as const;
const mangaZoomLabels = ["小", "较小", "正常", "较大", "大"] as const;

export default function MangaLibraryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlQuery = searchParams.get("query") ?? "";
    const [query, setQuery] = useState(urlQuery);
    const [series, setSeries] = useState<MangaSeriesResponse[]>([]);
    const [error, setError] = useState<string>();
    const [zoomLevel, setZoomLevel] = useState(2);

    useEffect(() => {
        setQuery(urlQuery);
    }, [urlQuery]);

    useEffect(() => {
        void getMangaSeries().then(setSeries).catch((loadError: Error) => setError(loadError.message));
    }, []);

    const filteredSeries = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) return series;

        return series.filter((item) => [item.title, item.author_name ?? "", ...item.tags]
            .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
    }, [query, series]);

    function updateQuery(value: string) {
        setQuery(value);
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) params.set("query", value.trim());
        else params.delete("query");
        router.replace(`/manga/library${params.size > 0 ? `?${params}` : ""}`);
    }

    const search = (
        <SearchField value={query} onChange={updateQuery} aria-label="搜索漫画库" className="w-full">
            <SearchField.Group className="h-9">
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="搜索漫画" />
                <SearchField.ClearButton />
            </SearchField.Group>
        </SearchField>
    );

    return (
        <ContentPageLayout
            title="漫画"
            description={query.trim() ? `找到 ${filteredSeries.length} 部漫画` : `${series.length} 部漫画`}
            center={search}
            header={<MangaNavigationTabs />}
            actions={<ContentZoomSlider value={zoomLevel} labels={mangaZoomLabels} onChange={setZoomLevel} ariaLabel="漫画卡片缩放" label="缩放" className="w-36" />}
        >
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
            {!error && filteredSeries.length === 0 ? <ContentPageEmptyState message={query.trim() ? "没有匹配的漫画。" : "暂无漫画。创建漫画媒体库并完成扫描后会显示在这里。"} /> : null}
            {!error && filteredSeries.length > 0 ? <div className={`grid gap-4 pb-8 ${mangaGridClasses[zoomLevel] ?? mangaGridClasses[2]}`}>{filteredSeries.map((item) => <MangaCard key={item.id} manga={item} />)}</div> : null}
        </ContentPageLayout>
    );
}
