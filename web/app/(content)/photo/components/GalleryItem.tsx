"use client";

import { Card } from "@heroui/react";
import Image from "next/image";

export type GalleryItemData = {
    id: string;
    src: string;
    viewerSrc?: string;
    originalSrc?: string;
    alt?: string;
    width?: number;
    height?: number;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    takenAt?: Date | string | number;
};

type GalleryItemProps = {
    item: GalleryItemData;
    className?: string;
    styleWidth?: string;
    onOpen?: () => void;
};

export default function GalleryItem({
    item,
    className,
    styleWidth,
    onOpen,
}: GalleryItemProps) {
    const aspectRatio = item.width && item.height ? `${item.width} / ${item.height}` : "1 / 1";

    return (
        <Card
            role="button"
            tabIndex={0}
            className={`group shrink-0 cursor-zoom-in overflow-hidden rounded-sm bg-slate-100 p-0 outline-none ring-slate-900/10 transition-shadow focus-visible:ring-2 ${className ?? ""}`}
            style={{
                aspectRatio,
                width: styleWidth,
            }}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen?.();
                }
            }}
        >
            <Card.Content className="h-full overflow-hidden p-0">
                <div className="relative h-full w-full">
                    <Image
                        src={item.src}
                        alt={item.alt ?? ""}
                        fill
                        sizes={styleWidth ?? "168px"}
                        unoptimized
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                </div>
            </Card.Content>
        </Card>
    );
}
