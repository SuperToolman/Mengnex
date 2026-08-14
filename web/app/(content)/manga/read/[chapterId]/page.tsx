"use client";

import { Button, ButtonGroup, Slider } from "@heroui/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMangaReader, type MangaReaderResponse } from "@/src/api/client";
import { recordMangaProgress, recordMangaReading } from "../../utils/recentManga";

const clamp = (value: number, lower: number, upper: number) => Math.min(Math.max(value, lower), upper);

export default function MangaReader({ params }: { params: Promise<{ chapterId: string }> }) {
    const router = useRouter();
    const [data, setData] = useState<MangaReaderResponse>();
    const [pageIndex, setPageIndex] = useState(0);
    const [zoom, setZoom] = useState(100);
    const [continuous, setContinuous] = useState(true);
    const [showControls, setShowControls] = useState(true);
    const [showDirectory, setShowDirectory] = useState(false);
    const [error, setError] = useState<string>();
    const lastScrollRecord = useRef(0);

    useEffect(() => {
        let cancelled = false;
        void params.then(async ({ chapterId }) => {
            try {
                const result = await getMangaReader(chapterId);
                if (!cancelled) {
                    setData(result);
                    setPageIndex(0);
                }
            } catch (loadError) {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载章节失败");
            }
        });
        return () => { cancelled = true; };
    }, [params]);

    useEffect(() => { if (data) recordMangaReading(data.series_id); }, [data]);
    useEffect(() => { if (data) recordMangaProgress(data.series_id, data.chapter_id, pageIndex); }, [data, pageIndex]);

    const movePage = useCallback((delta: number) => {
        setPageIndex((value) => clamp(value + delta, 0, Math.max((data?.pages.length ?? 1) - 1, 0)));
    }, [data?.pages.length]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setShowDirectory(false);
                setShowControls(true);
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") movePage(-1);
            if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") {
                event.preventDefault();
                movePage(1);
            }
        };
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            setZoom((value) => clamp(value + (event.deltaY < 0 ? 10 : -10), 60, 180));
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("wheel", onWheel);
        };
    }, [movePage]);

    if (error) return <div className="grid h-full place-items-center bg-[#111] text-sm text-red-300">{error}</div>;
    if (!data) return <div className="grid h-full place-items-center bg-[#111] text-sm text-slate-400">正在打开阅读器...</div>;
    if (data.pages.length === 0) return <div className="grid h-full place-items-center bg-[#111] text-sm text-slate-400">本章节暂时没有可阅读的页面</div>;

    const page = data.pages[pageIndex];
    const pageCount = data.pages.length;
    const zoomScale = zoom / 100;

    return (
        <div className="relative h-full overflow-hidden bg-[#171717] text-white" onMouseMove={() => setShowControls(true)}>
            <header className={`absolute inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-black/80 px-4 backdrop-blur transition-transform duration-300 sm:px-6 ${showControls ? "translate-y-0" : "-translate-y-full"}`}>
                <div className="flex min-w-0 items-center gap-3">
                    <Button isIconOnly size="sm" variant="ghost" aria-label="返回漫画详情" onPress={() => router.push(`/manga/${data.series_id}`)} className="text-lg text-slate-200">&lt;</Button>
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{data.title}</p><p className="text-[11px] text-slate-400">第 {pageIndex + 1} / {pageCount} 页</p></div>
                </div>
                <div className="hidden items-center gap-3 sm:flex">
                    <ButtonGroup size="sm" variant="ghost">
                        <Button isIconOnly aria-label="缩小图片" onPress={() => setZoom((value) => clamp(value - 10, 60, 180))}>-</Button>
                        <Button isIconOnly aria-label="放大图片" onPress={() => setZoom((value) => clamp(value + 10, 60, 180))}>+</Button>
                    </ButtonGroup>
                    <span className="w-9 text-center text-xs text-slate-300">{zoom}%</span>
                    <Button size="sm" variant={continuous ? "primary" : "ghost"} onPress={() => setContinuous((value) => !value)}>{continuous ? "上下" : "单页"}</Button>
                    <Button size="sm" variant="ghost" onPress={() => setShowDirectory((value) => !value)}>目录</Button>
                </div>
            </header>

            <main
                className={`h-full overflow-auto pt-14 ${continuous ? "" : "grid place-items-center"}`}
                onScroll={(event) => {
                    if (!continuous) return;
                    const target = event.currentTarget;
                    const estimated = Math.round((target.scrollTop / Math.max(target.scrollHeight - target.clientHeight, 1)) * Math.max(pageCount - 1, 0));
                    if (Date.now() - lastScrollRecord.current > 250) {
                        lastScrollRecord.current = Date.now();
                        setPageIndex(clamp(estimated, 0, Math.max(pageCount - 1, 0)));
                    }
                }}
                onClick={() => setShowControls((value) => !value)}
            >
                {continuous ? (
                    <div className="mx-auto w-full max-w-[1100px] pb-20" style={{ width: `${Math.min(100, zoom)}%` }}>
                        {data.pages.map((item) => <Image key={item.id} src={item.src} alt={`${data.title} ${item.page_number}`} width={1600} height={2200} unoptimized className="block h-auto w-full" />)}
                    </div>
                ) : (
                    <div className="relative flex h-full w-full items-center justify-center overflow-auto px-12 py-8">
                        <div className="flex h-[calc(100dvh-7.5rem)] w-full items-center justify-center">
                            <Image
                                src={page.src}
                                alt={`${data.title} ${page.page_number}`}
                                width={1600}
                                height={2200}
                                priority
                                unoptimized
                                className="max-h-full max-w-[min(72vw,980px)] object-contain shadow-2xl transition-transform duration-150"
                                style={{ transform: `scale(${zoomScale})`, transformOrigin: "center center" }}
                            />
                        </div>
                        <Button isIconOnly aria-label="上一页" variant="ghost" onPress={() => movePage(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/45 text-2xl text-white/80 hover:bg-black/80">&lt;</Button>
                        <Button isIconOnly aria-label="下一页" variant="ghost" onPress={() => movePage(1)} className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/45 text-2xl text-white/80 hover:bg-black/80">&gt;</Button>
                    </div>
                )}
            </main>

            <div className={`absolute inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-xl items-center gap-3 bg-black/80 px-5 py-3 backdrop-blur transition-transform duration-300 ${showControls ? "translate-y-0" : "translate-y-full"}`}>
                <span className="shrink-0 text-xs text-slate-300">{pageIndex + 1} / {pageCount}</span>
                <Slider aria-label="阅读进度" className="flex-1" minValue={0} maxValue={Math.max(pageCount - 1, 0)} step={1} value={pageIndex} onChange={(value) => setPageIndex(Array.isArray(value) ? value[0] ?? pageIndex : value)}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider>
                <Button size="sm" variant="ghost" className="sm:hidden" onPress={() => setShowDirectory((value) => !value)}>目录</Button>
            </div>

            {showDirectory ? <aside className="absolute inset-y-0 right-0 z-40 w-[min(84vw,360px)] border-l border-white/10 bg-[#202020] pt-14 shadow-2xl"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><p className="text-sm font-semibold">本章目录</p><p className="mt-1 text-xs text-slate-400">{pageCount} 页</p></div><Button isIconOnly size="sm" variant="ghost" aria-label="关闭目录" onPress={() => setShowDirectory(false)} className="text-xl text-slate-400">x</Button></div><div className="grid max-h-[calc(100dvh-120px)] grid-cols-4 gap-2 overflow-auto p-4">{data.pages.map((item, index) => <Button key={item.id} isIconOnly variant="ghost" aria-label={`第 ${index + 1} 页`} onPress={() => { setPageIndex(index); setShowDirectory(false); }} className={`relative aspect-[2/3] size-auto overflow-hidden rounded-none border-2 p-0 ${index === pageIndex ? "border-sky-400" : "border-transparent opacity-70 hover:opacity-100"}`}><Image src={item.src} alt="" fill unoptimized className="object-cover" /><span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-[10px]">{index + 1}</span></Button>)}</div></aside> : null}
        </div>
    );
}
