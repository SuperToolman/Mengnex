import { Card, Chip, Tooltip } from "@heroui/react";
import Image from "next/image";
import Link from "next/link";
import type { MangaSeriesResponse } from "@/src/api/client";

type MangaCardProps = {
    manga: MangaSeriesResponse;
};

export default function MangaCard({ manga }: MangaCardProps) {
    const progress = manga.layout === "chapter" && manga.chapter_count > 1
        ? `${manga.chapter_count} 章`
        : `${manga.page_count} P`;

    return (
        <Tooltip>
            <Tooltip.Trigger>
                <Link href={`/manga/${manga.id}`} className="block min-w-0">
                    <Card.Root className="group !p-0 bg-transparent shadow-none transition-transform duration-200 hover:-translate-y-0.5">
                <Card.Content className="!p-0">
                    <div className="relative aspect-[2/3]">
                        {manga.cover_src ? (
                            <Image src={manga.cover_src} alt={manga.title} fill sizes="(min-width: 1536px) 11vw, (min-width: 1280px) 13vw, 20vw" unoptimized className="h-full w-full rounded-2xl object-cover" />
                        ) : (
                            <span className="flex h-full items-center justify-center text-sm text-slate-400">无封面</span>
                        )}
                        <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
                            {progress}
                        </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                        <Card.Title className="truncate text-sm">{manga.title}</Card.Title>
                        <div className="flex items-center justify-between">
                            <p className="truncate text-xs text-muted">{manga.author_name ?? "未知作者"}</p>
                            {manga.tags[0] ? <Chip size="sm" variant="soft">{manga.tags[0]}</Chip> : null}
                        </div>
                    </div>
                </Card.Content>
                    </Card.Root>
                </Link>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>{manga.title}</Tooltip.Content>
        </Tooltip>
    );
}
