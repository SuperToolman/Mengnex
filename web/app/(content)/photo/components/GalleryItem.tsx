"use client";

import { Card } from "@heroui/react";
import Image from "next/image";
import { memo, useEffect, useState } from "react";

export type GalleryItemData = {
    id: string;
    src: string;
    viewerSrc?: string;
    originalSrc?: string;
    previewSrc?: string;
    alt?: string;
    width?: number;
    height?: number;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    takenAt?: Date | string | number;
    sourcePath?: string;
};

type GalleryItemProps = {
    item: GalleryItemData;
    className?: string;
    styleWidth?: string;
    styleHeight?: string;
    onOpen?: () => void;
};

function GalleryItem({
    item,
    className,
    styleWidth,
    styleHeight,
    onOpen,
}: GalleryItemProps) {
    const aspectRatio = item.width && item.height ? `${item.width} / ${item.height}` : "1 / 1";
    const preferredSource = item.src || item.originalSrc || "";
    const [displaySource, setDisplaySource] = useState(preferredSource);

    useEffect(() => {
        setDisplaySource(preferredSource);
    }, [preferredSource]);

    function handleImageError() {
        if (item.originalSrc && displaySource !== item.originalSrc) {
            setDisplaySource(item.originalSrc);
            return;
        }

        setDisplaySource("");
    }

    return (
        <Card
            role="button"
            tabIndex={0}
            className={`group shrink-0 cursor-zoom-in overflow-hidden rounded-sm bg-slate-100 p-0 outline-none ring-slate-900/10 transition-shadow focus-visible:ring-2 dark:bg-slate-700 ${className ?? ""}`}
            style={{
                aspectRatio,
                height: styleHeight,
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
                    {displaySource ? (
                        <Image
                            src={displaySource}
                            alt={item.alt ?? ""}
                            fill
                            sizes={styleWidth ?? styleHeight ?? "168px"}
                            loading="lazy"
                            unoptimized
                            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            onError={handleImageError}
                        />
                    ) : (
                        <div className="h-full w-full bg-slate-200 dark:bg-slate-700" />
                    )}
                </div>
            </Card.Content>
        </Card>
    );
}

export default memo(GalleryItem);
