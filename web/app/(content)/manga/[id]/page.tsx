"use client";

import { Button, Card, Chip, Input, TextField } from "@heroui/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createTag, getMangaDetail, getMangaSeries, getResourceTags, getTags, replaceTagsForResource, type MangaDetailResponse, type MangaSeriesResponse, type TagResponse } from "@/src/api/client";
import { getMangaProgress } from "../utils/recentManga";

type LoadState = { detail: MangaDetailResponse; catalog: MangaSeriesResponse[] };

const TAG_COLOR_CLASSES = [
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200",
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200",
    "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200",
] as const;

function tagColorClass(tagName: string) {
    let hash = 0;
    for (const character of tagName) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return TAG_COLOR_CLASSES[hash % TAG_COLOR_CLASSES.length];
}

function ChapterButton({ chapter, index, active }: { chapter: MangaDetailResponse["chapters"][number]; index: number; active?: boolean }) {
    return (
        <Link
            href={`/manga/read/${chapter.id}`}
            className={`group flex min-w-0 items-center gap-3 border px-3 py-3 text-left transition ${active
                ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400/70 dark:bg-sky-400/10 dark:text-sky-200"
                : "border-slate-200 bg-white hover:border-sky-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-sky-500/60"}`}
        >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 group-hover:bg-sky-100 group-hover:text-sky-700 dark:bg-slate-800 dark:text-slate-400">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{chapter.title}</span>
            <span className="shrink-0 text-xs text-slate-400">{chapter.page_count} P</span>
        </Link>
    );
}

export default function MangaDetail({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const [state, setState] = useState<LoadState>();
    const [error, setError] = useState<string>();
    const [isFollowing, setIsFollowing] = useState(false);
    const [chapterQuery, setChapterQuery] = useState("");
    const [showAll, setShowAll] = useState(false);
    const [resourceTags, setResourceTags] = useState<TagResponse[]>([]);
    const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [tagError, setTagError] = useState<string>();
    const [isSavingTag, setIsSavingTag] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void params.then(async ({ id }) => {
            try {
                const [detail, catalog, tags] = await Promise.all([getMangaDetail(id), getMangaSeries(), getResourceTags("manga_series", id)]);
                if (!cancelled) {
                    setState({ detail, catalog });
                    setResourceTags(tags);
                }
            } catch (loadError) {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载作品失败");
            }
        });
        return () => { cancelled = true; };
    }, [params]);

    const matchingSeries = useMemo(() => state?.catalog.find((series) => series.id === state.detail.id), [state]);
    const progress = state ? getMangaProgress(state.detail.id) : undefined;
    const filteredChapters = useMemo(() => state?.detail.chapters.filter((chapter) => chapter.title.toLocaleLowerCase().includes(chapterQuery.trim().toLocaleLowerCase())) ?? [], [chapterQuery, state]);
    const chapters = showAll ? filteredChapters : filteredChapters.slice(0, 24);
    const recommendations = useMemo(() => state?.catalog.filter((series) => series.id !== state.detail.id).slice(0, 5) ?? [], [state]);

    async function addTag() {
        const name = newTagName.trim();
        if (!name || !state || isSavingTag) return;

        setTagError(undefined);
        setIsSavingTag(true);
        try {
            const normalizedName = name.toLocaleLowerCase();
            let tag = (await getTags(name)).find((item) => item.normalized_name === normalizedName);
            if (!tag) {
                try {
                    tag = await createTag(name);
                } catch {
                    tag = (await getTags(name)).find((item) => item.normalized_name === normalizedName);
                    if (!tag) throw new Error("创建标签失败，请稍后重试");
                }
            }
            const nextTagIds = Array.from(new Set([...resourceTags.map((item) => item.id), tag.id]));
            const updated = await replaceTagsForResource("manga_series", state.detail.id, nextTagIds);
            setResourceTags(updated);
            setNewTagName("");
            setIsTagEditorOpen(false);
        } catch (saveError) {
            setTagError(saveError instanceof Error ? saveError.message : "标签保存失败");
        } finally {
            setIsSavingTag(false);
        }
    }

    if (error) return <div className="p-8 text-sm text-red-500">{error}</div>;
    if (!state) return <div className="grid min-h-[70vh] place-items-center text-sm text-muted">正在加载作品...</div>;

    const { detail } = state;
    const firstChapter = detail.chapters[0];
    const resumeChapter = progress ? detail.chapters.find((chapter) => chapter.id === progress.chapterId) : undefined;
    const primaryChapter = resumeChapter ?? firstChapter;
    const primaryText = resumeChapter ? `继续阅读 · 第 ${progress!.pageIndex + 1} 页` : "开始阅读";

    return (
        <div className="min-h-full bg-[#f6f7fb] px-4 py-5 text-slate-900 dark:bg-[#10141d] dark:text-slate-100 sm:px-7 lg:px-10">
            <div className="mx-auto max-w-[1440px]">
                <nav className="mb-5 flex items-center gap-2 text-xs text-slate-400"><Link href="/manga" className="hover:text-sky-600">漫画库</Link><span>/</span><span className="truncate text-slate-500 dark:text-slate-300">{detail.title}</span></nav>
                <Card.Root className="relative !overflow-hidden !rounded-none border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.06)] dark:border-slate-800 dark:bg-[#171c27]">
                    <Card.Content className="!p-0">
                    <div className="absolute inset-x-0 top-0 h-1 bg-sky-500" />
                    <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[210px_minmax(0,1fr)_260px] lg:gap-9">
                        <div className="relative mx-auto aspect-[2/3] w-40 overflow-hidden bg-slate-200 shadow-xl sm:w-48 lg:w-full">
                            {detail.cover_src ? <Image src={detail.cover_src} alt={detail.title} fill priority unoptimized className="object-cover" /> : <div className="grid h-full place-items-center text-sm text-slate-400">暂无封面</div>}
                            <span className="absolute bottom-0 left-0 bg-slate-950/75 px-3 py-1.5 text-xs font-medium text-white">{detail.layout === "chapter" ? "连载作品" : "单行本"}</span>
                        </div>
                        <div className="min-w-0">

                            {isTagEditorOpen ? <div className="mb-4 flex flex-wrap items-start gap-2"><TextField.Root value={newTagName} onChange={setNewTagName} className="w-48"><Input autoFocus placeholder="输入标签名称" className="h-9 border border-slate-200 bg-white px-3 text-sm shadow-none dark:border-slate-700 dark:bg-slate-900" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addTag(); } }} /></TextField.Root><Button size="sm" variant="primary" isPending={isSavingTag} onPress={() => void addTag()}>添加</Button><Button size="sm" variant="ghost" onPress={() => { setIsTagEditorOpen(false); setTagError(undefined); }}>取消</Button>{tagError ? <p className="basis-full text-xs text-red-500">{tagError}</p> : null}</div> : null}
                            <h1 className="text-2xl font-bold tracking-normal sm:text-3xl">{detail.title}</h1>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{matchingSeries?.author_name ?? "本地收藏"} <span className="mx-2 text-slate-300">|</span> 共 {detail.chapter_count} 话 <span className="mx-2 text-slate-300">|</span> {detail.page_count} 页</p>
                            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">由本地媒体库自动整理的漫画作品。章节、页序和封面均来自扫描结果，可从上次阅读位置继续阅读，并在阅读器中切换阅读方式。</p>
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                {resourceTags.map((tag) => <Chip key={tag.id} size="sm" variant="soft" className={tagColorClass(tag.name)}>{tag.name}</Chip>)}
                                {resourceTags.length === 0 ?
                                    <span className="text-xs text-slate-400">暂无标签，添加标签便于筛选和归档</span> : null}
                                <Button isIconOnly size="sm" variant="secondary" aria-label="添加标签" onPress={() => setIsTagEditorOpen((value) => !value)}>+</Button>
                            </div>
                            <div className="mt-6 flex flex-wrap gap-3">
                                {primaryChapter ? <Button variant="primary" onPress={() => router.push(`/manga/read/${primaryChapter.id}`)}>{primaryText}</Button> : null}
                                <Button variant={isFollowing ? "primary" : "secondary"} onPress={() => setIsFollowing((value) => !value)}>{isFollowing ? "已加入书架" : "加入书架"}</Button>
                            </div>
                        </div>
                        <div className="border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0 dark:border-slate-800">
                            <p className="text-xs font-semibold tracking-normal text-slate-400">阅读进度</p>
                            <p className="mt-2 text-lg font-bold">{resumeChapter ? resumeChapter.title : "尚未开始"}</p>
                            <div className="mt-4 h-1.5 bg-slate-100 dark:bg-slate-800"><div className="h-full bg-sky-500" style={{ width: resumeChapter ? `${Math.min(100, ((progress!.pageIndex + 1) / Math.max(resumeChapter.page_count, 1)) * 100)}%` : "0%" }} /></div>
                            <p className="mt-2 text-xs text-slate-400">{resumeChapter ? `第 ${progress!.pageIndex + 1} / ${resumeChapter.page_count} 页` : "从第一话开始你的阅读"}</p>
                            <div className="mt-7 grid grid-cols-2 gap-3 text-center"><div><p className="text-xl font-bold">{detail.chapter_count}</p><p className="mt-1 text-xs text-slate-400">章节</p></div><div><p className="text-xl font-bold">{detail.page_count}</p><p className="mt-1 text-xs text-slate-400">页数</p></div></div>
                        </div>
                    </div>
                    </Card.Content>
                </Card.Root>

                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
                    <Card.Root className="!rounded-none border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#171c27]">
                        <Card.Content className="p-5 sm:p-7">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-800"><div><h2 className="text-xl font-bold">章节列表</h2><p className="mt-1 text-xs text-slate-400">按顺序解锁你的阅读进度</p></div><TextField.Root value={chapterQuery} onChange={setChapterQuery} className="w-full sm:w-44"><Input placeholder="搜索章节" className="h-9 border border-slate-200 bg-slate-50 px-3 text-sm shadow-none dark:border-slate-700 dark:bg-slate-900" /></TextField.Root></div>
                        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{chapters.map((chapter) => <ChapterButton key={chapter.id} chapter={chapter} index={filteredChapters.indexOf(chapter)} active={chapter.id === resumeChapter?.id} />)}</div>
                        {filteredChapters.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">未找到匹配章节</p> : null}
                        {filteredChapters.length > 24 ? <Button fullWidth variant="secondary" className="mt-5" onPress={() => setShowAll((value) => !value)}>{showAll ? "收起章节" : `查看全部 ${filteredChapters.length} 话`}</Button> : null}
                        </Card.Content>
                    </Card.Root>
                    <Card.Root className="!rounded-none border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#171c27]"><Card.Content className="p-5"><div className="flex items-baseline justify-between"><h2 className="text-lg font-bold">猜你喜欢</h2><Link href="/manga" className="text-xs text-sky-600">更多</Link></div><div className="mt-4 space-y-4">{recommendations.map((series) => <Link key={series.id} href={`/manga/${series.id}`} className="flex gap-3 group"><div className="relative aspect-[2/3] w-14 shrink-0 overflow-hidden bg-slate-200">{series.cover_src ? <Image src={series.cover_src} alt="" fill unoptimized className="object-cover" /> : null}</div><div className="min-w-0"><p className="line-clamp-2 text-sm font-medium group-hover:text-sky-600">{series.title}</p><p className="mt-1 truncate text-xs text-slate-400">{series.author_name ?? "本地收藏"}</p><p className="mt-1 text-xs text-slate-400">{series.chapter_count} 话 · {series.page_count} 页</p></div></Link>)}</div></Card.Content></Card.Root>
                </div>
            </div>
        </div>
    );
}
