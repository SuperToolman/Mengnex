"use client";

import { Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import MediaLibraryLayout, { MediaLibraryEmptyState } from "@/app/components/MediaLibraryLayout";
import ContentZoomSlider from "@/app/components/ContentZoomSlider";
import { getMangaSeries, type MangaSeriesResponse } from "@/src/api/client";
import MangaCard from "./components/MangaCard";
import { getRecentMangaSeries } from "./utils/recentManga";

type MangaGroupProps = {
    title: string;
    series: MangaSeriesResponse[];
    maxRows?: number;
    gridClassName: string;
    columnCount: number;
};

const MANGA_ZOOM_LEVELS = [
    { label: "小", columnCount: 12, gridClassName: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12" },
    { label: "较小", columnCount: 10, gridClassName: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-10" },
    { label: "正常", columnCount: 8, gridClassName: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8" },
    { label: "较大", columnCount: 6, gridClassName: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" },
    { label: "大", columnCount: 4, gridClassName: "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4" },
] as const;

function MangaGroup({ title, series, maxRows = 2, gridClassName, columnCount }: MangaGroupProps) {
    const visibleSeries = series.slice(0, columnCount * maxRows);

    return (
        <section>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-foreground">{title}</h2>
                <Button size="sm" variant="ghost">查看更多</Button>
            </div>
            <div className={`grid gap-4 ${gridClassName}`}>
                {visibleSeries.map((item) => <MangaCard key={`${title}-${item.id}`} manga={item} />)}
            </div>
        </section>
    );
}

export default function MangaPage() {
    const [series, setSeries] = useState<MangaSeriesResponse[]>([]);
    const [error, setError] = useState<string>();
    const [zoomLevel, setZoomLevel] = useState(2);

    useEffect(() => {
        void getMangaSeries().then(setSeries).catch((loadError: Error) => setError(loadError.message));
    }, []);

    const recentSeries = useMemo(() => getRecentMangaSeries(series), [series]);
    const zoom = MANGA_ZOOM_LEVELS[zoomLevel] ?? MANGA_ZOOM_LEVELS[2];

    return (
        <MediaLibraryLayout
            title="漫画"
            description="浏览已扫描的漫画作品。"
            actions={(
                <ContentZoomSlider value={zoomLevel} labels={MANGA_ZOOM_LEVELS.map((level) => level.label)} onChange={setZoomLevel} ariaLabel="漫画卡片缩放" label="缩放" className="w-36" />
            )}
        >
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
            {!error && series.length === 0 ? <MediaLibraryEmptyState message="暂无漫画。创建漫画媒体库并完成扫描后会显示在这里。" /> : null}
            {!error && series.length > 0 ? (
                <div className="space-y-10 pb-8">
                    {recentSeries.length > 0 ? <MangaGroup title="最近阅读" series={recentSeries} gridClassName={zoom.gridClassName} columnCount={zoom.columnCount} /> : null}
                    <MangaGroup title="最新漫画" series={series} gridClassName={zoom.gridClassName} columnCount={zoom.columnCount} />
                    <MangaGroup title="向你推荐" series={series} gridClassName={zoom.gridClassName} columnCount={zoom.columnCount} />
                    <MangaGroup title="全部漫画" series={series} maxRows={4} gridClassName={zoom.gridClassName} columnCount={zoom.columnCount} />
                </div>
            ) : null}
        </MediaLibraryLayout>
    );
}
