import { BookOpen } from "@gravity-ui/icons";
import { Card, Chip, Tooltip } from "@heroui/react";
import Image from "next/image";
import Link from "next/link";
import type { NovelBookResponse } from "@/src/api/client";

type NovelCardProps = {
    book: NovelBookResponse;
};

export default function NovelCard({ book }: NovelCardProps) {
    return (
        <Tooltip>
            <Tooltip.Trigger>
                <Link href={`/novel/${book.id}`} className="group block min-w-0">
                    <Card.Root className="h-full overflow-hidden border border-border bg-surface-secondary transition hover:-translate-y-0.5 hover:border-accent">
                        <Card.Content className="!p-0">
                            <div className="relative aspect-[2/3] overflow-hidden bg-surface-tertiary">
                                {book.cover_src ? (
                                    <Image src={book.cover_src} alt={book.title} fill unoptimized className="object-cover transition duration-300 group-hover:scale-105" />
                                ) : (
                                    <div className="grid h-full place-items-center text-muted"><BookOpen className="h-10 w-10" /></div>
                                )}
                            </div>
                            <div className="min-w-0 space-y-1 p-3">
                                <Card.Title className="truncate text-sm text-foreground">{book.title}</Card.Title>
                                <p className="truncate text-xs text-muted">{book.author ?? "未知作者"}</p>
                                <div className="flex items-center justify-between gap-2 pt-1">
                                    <Chip size="sm" variant="soft">{book.format.toUpperCase()}</Chip>
                                    <span className="truncate text-xs text-muted">{book.chapter_count} 章</span>
                                </div>
                            </div>
                        </Card.Content>
                    </Card.Root>
                </Link>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>{book.title}</Tooltip.Content>
        </Tooltip>
    );
}
