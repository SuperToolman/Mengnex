"use client";

import GalleryItem, { type GalleryItemData } from "./GalleryItem";

export type GalleryGroupData = {
    id: string;
    batchTime: Date | string | number;
    items: GalleryItemData[];
};

type GalleryGroupProps = {
    group: GalleryGroupData;
    className?: string;
    onItemOpen?: (item: GalleryItemData) => void;
};

const ITEM_HEIGHT = 168;
const ITEM_GAP = 4;
const MIN_ITEM_WIDTH = 160;
const MAX_ITEM_WIDTH = 360;

const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
});

function formatBatchTitle(value: Date | string | number) {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdayFormatter.format(date)}`;
}

export function getGalleryItemWidthValue(item: GalleryItemData) {
    if (!item.width || !item.height) {
        return ITEM_HEIGHT;
    }

    const ratio = item.width / item.height;
    const width = Math.round(ITEM_HEIGHT * ratio);

    return Math.min(Math.max(width, MIN_ITEM_WIDTH), MAX_ITEM_WIDTH);
}

function getGroupBasis(items: GalleryItemData[]) {
    const contentWidth = items.reduce((total, item) => total + getGalleryItemWidthValue(item), 0);
    const gapWidth = Math.max(items.length - 1, 0) * ITEM_GAP;
    const groupWidth = contentWidth + gapWidth;

    return `min(${groupWidth}px, 100%)`;
}

export default function GalleryGroup({
    group,
    className,
    onItemOpen,
}: GalleryGroupProps) {
    if (group.items.length === 0) {
        return null;
    }

    const groupBasis = getGroupBasis(group.items);

    return (
        <section
            className={`inline-block min-w-0 grow-0 align-top ${className ?? ""}`}
            style={{
                flexBasis: groupBasis,
                width: groupBasis,
                maxWidth: "100%",
            }}
        >
            <h2 className="mb-3 text-lg font-medium text-slate-800">
                {formatBatchTitle(group.batchTime)}
            </h2>
            <div className="flex flex-wrap items-start gap-1">
                {group.items.map((item) => (
                    <GalleryItem
                        key={item.id}
                        item={item}
                        className="h-[168px]"
                        styleWidth={`${getGalleryItemWidthValue(item)}px`}
                        onOpen={() => onItemOpen?.(item)}
                    />
                ))}
            </div>
        </section>
    );
}
