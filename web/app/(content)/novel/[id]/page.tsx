"use client";

import { Button, Card, Chip, Input, TextField } from "@heroui/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getNovel, getNovelReadingState, type NovelDetailResponse, type NovelReadingStateResponse } from "@/src/api/client";

export default function NovelDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const [detail, setDetail] = useState<NovelDetailResponse>();
    const [readingState, setReadingState] = useState<NovelReadingStateResponse | null>();
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string>();

    useEffect(() => {
        let cancelled = false;
        void params.then(async ({ id }) => {
            try {
                const [book, state] = await Promise.all([getNovel(id), getNovelReadingState(id)]);
                if (!cancelled) { setDetail(book); setReadingState(state); }
            } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "小说加载失败"); }
        });
        return () => { cancelled = true; };
    }, [params]);

    const chapters = useMemo(() => detail?.chapters.filter((chapter) => chapter.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [], [detail, query]);
    if (error) return <div className="p-8 text-sm text-danger">{error}</div>;
    if (!detail) return <div className="grid min-h-[70vh] place-items-center text-sm text-muted">正在加载小说...</div>;
    const current = readingState?.chapter_id ? detail.chapters.find((chapter) => chapter.id === readingState.chapter_id) : undefined;
    const first = current ?? detail.chapters[0];

    return <div className="min-h-full px-4 py-6 text-foreground sm:px-8"><div className="mx-auto max-w-6xl">
        <nav className="mb-5 flex gap-2 text-xs text-muted"><Link href="/novel" className="hover:text-accent">小说库</Link><span>/</span><span className="truncate">{detail.title}</span></nav>
        <Card.Root className="overflow-hidden border border-border bg-surface-secondary"><Card.Content className="grid gap-7 p-5 sm:p-8 lg:grid-cols-[190px_minmax(0,1fr)_230px]">
            <div className="relative mx-auto aspect-[2/3] w-40 overflow-hidden bg-surface-tertiary lg:w-full">{detail.cover_src ? <Image src={detail.cover_src} alt={detail.title} fill unoptimized className="object-cover" /> : <div className="grid h-full place-items-center text-muted">暂无封面</div>}</div>
            <div className="min-w-0"><div className="flex flex-wrap gap-2"><Chip size="sm" variant="soft">{detail.format.toUpperCase()}</Chip>{detail.parse_status !== "ready" ? <Chip size="sm" color="warning">{detail.parse_status}</Chip> : null}</div><h1 className="mt-3 text-3xl font-semibold">{detail.title}</h1><p className="mt-2 text-sm text-muted">{detail.author ?? "未知作者"}{detail.language ? ` · ${detail.language}` : ""}</p><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-muted">{detail.description ?? "暂无简介。"}</p><div className="mt-6 flex flex-wrap gap-3">{first ? <Button variant="primary" onPress={() => router.push(`/novel/read/${detail.id}?chapter=${first.id}`)}>{current ? "继续阅读" : "开始阅读"}</Button> : null}<Button variant="secondary" onPress={() => document.getElementById("novel-chapters")?.scrollIntoView({ behavior: "smooth" })}>查看目录</Button></div></div>
            <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0"><p className="text-xs text-muted">阅读进度</p><p className="mt-2 text-lg font-semibold">{current?.title ?? "尚未开始"}</p><div className="mt-4 h-1.5 bg-surface-tertiary"><div className="h-full bg-accent" style={{ width: `${readingState?.progress_percent ?? 0}%` }} /></div><p className="mt-2 text-xs text-muted">{readingState ? `${readingState.progress_percent}%` : "从第一章开始"}</p><div className="mt-8 grid grid-cols-2 gap-3 text-center"><div><p className="text-xl font-semibold">{detail.chapter_count}</p><p className="text-xs text-muted">章节</p></div><div><p className="text-xl font-semibold">{detail.format.toUpperCase()}</p><p className="text-xs text-muted">格式</p></div></div></div>
        </Card.Content></Card.Root>
        <Card.Root id="novel-chapters" className="mt-6 border border-border bg-surface-secondary"><Card.Content className="p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5"><div><h2 className="text-xl font-semibold">章节目录</h2><p className="mt-1 text-xs text-muted">{detail.chapter_count} 个章节 · {detail.parse_status === "ready" ? "已完成解析" : "等待解析"}</p></div><TextField.Root value={query} onChange={setQuery} className="w-full sm:w-48"><Input placeholder="搜索章节" className="h-9" /></TextField.Root></div><div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{chapters.map((chapter) => <Link key={chapter.id} href={`/novel/read/${detail.id}?chapter=${chapter.id}`} className="flex min-w-0 items-center gap-3 border border-border p-3 transition hover:border-accent"><span className="grid size-7 shrink-0 place-items-center bg-surface-tertiary text-xs text-muted">{chapter.sequence + 1}</span><span className="min-w-0 flex-1 truncate text-sm">{chapter.title}</span><span className="text-xs text-muted">{chapter.word_count} 字</span></Link>)}</div>{chapters.length === 0 ? <p className="py-10 text-center text-sm text-muted">没有匹配章节</p> : null}</Card.Content></Card.Root>
    </div></div>;
}
