"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, ListUl } from "@gravity-ui/icons";
import { Button, Slider } from "@heroui/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    getNovel,
    getNovelChapter,
    getNovelReadingState,
    updateNovelReadingState,
    type NovelChapterContentResponse,
    type NovelDetailResponse,
} from "@/src/api/client";

export default function NovelReaderPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [book, setBook] = useState<NovelDetailResponse>();
    const [chapter, setChapter] = useState<NovelChapterContentResponse>();
    const [error, setError] = useState<string>();
    const [fontSize, setFontSize] = useState(18);
    const [showDirectory, setShowDirectory] = useState(false);
    const readerRef = useRef<HTMLElement>(null);
    const saveTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        void params.then(async ({ id }) => {
            try {
                const [detail, state] = await Promise.all([getNovel(id), getNovelReadingState(id)]);
                if (cancelled) return;
                setBook(detail);
                const chapterId = searchParams.get("chapter") ?? state?.chapter_id ?? detail.chapters[0]?.id;
                if (chapterId) setChapter(await getNovelChapter(id, chapterId));
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "章节加载失败");
            }
        });
        return () => { cancelled = true; };
    }, [params, searchParams]);

    const loadChapter = useCallback(async (chapterId: string) => {
        if (!book) return;
        try {
            setChapter(await getNovelChapter(book.id, chapterId));
            readerRef.current?.scrollTo({ top: 0 });
            router.replace(`/novel/read/${book.id}?chapter=${chapterId}`, { scroll: false });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "章节加载失败");
        }
    }, [book, router]);

    useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);
    useEffect(() => {
        if (!book || !chapter || !readerRef.current) return;
        const target = readerRef.current;
        const save = () => {
            const progress = Math.round((target.scrollTop / Math.max(target.scrollHeight - target.clientHeight, 1)) * 100);
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => {
                void updateNovelReadingState(book.id, { chapter_id: chapter.id, progress_percent: progress, locator: String(Math.round(target.scrollTop)) });
            }, 500);
        };
        target.addEventListener("scroll", save);
        return () => target.removeEventListener("scroll", save);
    }, [book, chapter]);

    if (error) return <div className="grid h-full place-items-center bg-background text-sm text-danger">{error}</div>;
    if (!book || !chapter) return <div className="grid h-full place-items-center bg-background text-sm text-muted">正在打开阅读器...</div>;

    const index = book.chapters.findIndex((item) => item.id === chapter.id);
    const previous = book.chapters[index - 1];
    const next = book.chapters[index + 1];

    return (
        <div className="flex h-full flex-col bg-background text-foreground">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-secondary px-4 sm:px-7">
                <div className="flex min-w-0 items-center gap-3">
                    <Button isIconOnly size="sm" variant="ghost" aria-label="返回小说详情" onPress={() => router.push(`/novel/${book.id}`)}><ArrowLeft /></Button>
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{book.title}</p><p className="text-[11px] text-muted">{chapter.title} · {index + 1} / {book.chapters.length}</p></div>
                </div>
                <div className="flex items-center gap-2">
                    <Button isIconOnly size="sm" variant="ghost" aria-label="上一章" isDisabled={!previous} onPress={() => previous && void loadChapter(previous.id)}><ChevronLeft /></Button>
                    <Button isIconOnly size="sm" variant="ghost" aria-label="下一章" isDisabled={!next} onPress={() => next && void loadChapter(next.id)}><ChevronRight /></Button>
                    <Button isIconOnly size="sm" variant="ghost" aria-label="打开目录" onPress={() => setShowDirectory((value) => !value)}><ListUl /></Button>
                </div>
            </header>
            <main ref={readerRef} className="relative flex-1 overflow-auto">
                <article className="mx-auto max-w-3xl px-6 py-12 sm:px-10" style={{ fontSize: `${fontSize}px`, lineHeight: 1.95 }}>
                    <h1 className="mb-10 text-center text-2xl font-semibold">{chapter.title}</h1>
                    <div className="whitespace-pre-wrap break-words text-foreground">{chapter.content}</div>
                    <div className="mt-16 flex justify-between gap-3 border-t border-border pt-6"><Button variant="ghost" isDisabled={!previous} onPress={() => previous && void loadChapter(previous.id)}>上一章</Button><Button variant="primary" isDisabled={!next} onPress={() => next && void loadChapter(next.id)}>下一章</Button></div>
                </article>
            </main>
            <footer className="flex h-12 shrink-0 items-center gap-4 border-t border-border bg-surface-secondary px-5"><span className="text-xs text-muted">字号</span><Slider aria-label="字号" className="w-36" minValue={14} maxValue={26} step={1} value={fontSize} onChange={(value) => setFontSize(Array.isArray(value) ? value[0] ?? fontSize : value)}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><span className="w-7 text-xs text-muted">{fontSize}</span></footer>
            {showDirectory ? <aside className="absolute inset-y-14 right-0 z-20 w-[min(88vw,360px)] overflow-auto border-l border-border bg-surface-secondary p-4 shadow-lg"><p className="mb-3 text-sm font-semibold">章节目录</p>{book.chapters.map((item) => <Link key={item.id} href={`/novel/read/${book.id}?chapter=${item.id}`} onClick={(event) => { event.preventDefault(); setShowDirectory(false); void loadChapter(item.id); }} className={`block truncate border-b border-border px-2 py-3 text-sm ${item.id === chapter.id ? "text-accent" : "text-muted hover:text-foreground"}`}>{item.sequence + 1}. {item.title}</Link>)}</aside> : null}
        </div>
    );
}
