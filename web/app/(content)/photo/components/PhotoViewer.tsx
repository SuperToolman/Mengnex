"use client";

import { Modal, useOverlayState } from "@heroui/react";
import Image from "next/image";
import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { GalleryItemData } from "./GalleryItem";

type PhotoViewerProps = {
    items: GalleryItemData[];
    activeIndex: number | null;
    onChange: (index: number) => void;
    onClose: () => void;
};

const INFO_IDLE_DELAY = 3000;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_ZOOM_STEP = 1.14;

type ViewportPosition = {
    x: number;
    y: number;
};

type DragState = {
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
};

function getSafeIndex(index: number, length: number) {
    if (length === 0) {
        return 0;
    }

    return (index + length) % length;
}

function getFileName(item: GalleryItemData) {
    if (item.fileName) {
        return item.fileName;
    }

    try {
        const url = new URL(item.src, "http://localhost");
        const pathname = url.pathname.split("/").filter(Boolean).at(-1);

        return pathname ? decodeURIComponent(pathname) : item.id;
    } catch {
        return item.src.split("/").filter(Boolean).at(-1) ?? item.id;
    }
}

function formatFileSize(size?: number) {
    if (!size) {
        return "未知大小";
    }

    if (size < 1024) {
        return `${size} B`;
    }

    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTakenAt(value?: Date | string | number) {
    if (!value) {
        return "未知时间";
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function constrainPosition(position: ViewportPosition, scale: number, rect?: DOMRect | null) {
    if (scale <= MIN_SCALE || !rect) {
        return { x: 0, y: 0 };
    }

    const maxX = ((scale - 1) * rect.width) / 2;
    const maxY = ((scale - 1) * rect.height) / 2;

    return {
        x: clamp(position.x, -maxX, maxX),
        y: clamp(position.y, -maxY, maxY),
    };
}

export default function PhotoViewer({
    items,
    activeIndex,
    onChange,
    onClose,
}: PhotoViewerProps) {
    const [isInfoVisible, setIsInfoVisible] = useState(true);
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState<ViewportPosition>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isOriginalLoaded, setIsOriginalLoaded] = useState(false);
    const [isOriginalRevealActive, setIsOriginalRevealActive] = useState(false);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<DragState | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeItem = activeIndex === null ? null : items[activeIndex] ?? null;
    const isOpen = activeIndex !== null && !!activeItem;
    const overlayState = useOverlayState({
        isOpen,
        onOpenChange: (nextOpen) => {
            if (!nextOpen) {
                onClose();
            }
        },
    });

    function clearIdleTimer() {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }

    function scheduleInfoHide() {
        clearIdleTimer();
        idleTimerRef.current = setTimeout(() => {
            setIsInfoVisible(false);
        }, INFO_IDLE_DELAY);
    }

    function showInfoTemporarily() {
        setIsInfoVisible(true);
        scheduleInfoHide();
    }

    function goTo(offset: number) {
        if (activeIndex === null || items.length === 0) {
            return;
        }

        onChange(getSafeIndex(activeIndex + offset, items.length));
    }

    function resetViewport() {
        setScale(1);
        setPosition({ x: 0, y: 0 });
        setIsDragging(false);
        setIsOriginalLoaded(false);
        setIsOriginalRevealActive(false);
        dragStateRef.current = null;
    }

    function handleWheel(event: WheelEvent<HTMLDivElement>) {
        event.preventDefault();
        showInfoTemporarily();

        const rect = viewportRef.current?.getBoundingClientRect();

        if (!rect) {
            return;
        }

        const nextScale = clamp(
            scale * (event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP),
            MIN_SCALE,
            MAX_SCALE,
        );

        if (nextScale === scale) {
            return;
        }

        const cursorX = event.clientX - rect.left - rect.width / 2;
        const cursorY = event.clientY - rect.top - rect.height / 2;
        const scaleRatio = nextScale / scale;
        const nextPosition = constrainPosition(
            {
                x: cursorX - (cursorX - position.x) * scaleRatio,
                y: cursorY - (cursorY - position.y) * scaleRatio,
            },
            nextScale,
            rect,
        );

        setScale(nextScale);
        setPosition(nextPosition);
    }

    function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
        showInfoTemporarily();

        if (event.button !== 0 || scale <= MIN_SCALE) {
            return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: position.x,
            originY: position.y,
        };
        setIsDragging(true);
    }

    function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
        showInfoTemporarily();

        const dragState = dragStateRef.current;

        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
        }

        const rect = viewportRef.current?.getBoundingClientRect();
        setPosition(
            constrainPosition(
                {
                    x: dragState.originX + event.clientX - dragState.startX,
                    y: dragState.originY + event.clientY - dragState.startY,
                },
                scale,
                rect,
            ),
        );
    }

    function stopDragging(event?: PointerEvent<HTMLDivElement>) {
        if (
            event &&
            dragStateRef.current?.pointerId === event.pointerId &&
            event.currentTarget.hasPointerCapture(event.pointerId)
        ) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        dragStateRef.current = null;
        setIsDragging(false);
    }

    useEffect(() => {
        if (!isOpen) {
            clearIdleTimer();
            return;
        }

        setIsInfoVisible(true);
        scheduleInfoHide();
        resetViewport();

        return clearIdleTimer;
    }, [isOpen, activeIndex]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                goTo(-1);
                return;
            }

            if (event.key === "ArrowRight") {
                event.preventDefault();
                goTo(1);
            }
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, activeIndex, items.length, onChange]);

    if (!activeItem || activeIndex === null) {
        return null;
    }

    const dimensions = activeItem.width && activeItem.height
        ? `${activeItem.width} x ${activeItem.height}`
        : "未知尺寸";
    const previewSrc = activeItem.viewerSrc ?? activeItem.src;
    const originalSrc = activeItem.originalSrc ?? activeItem.src;
    const shouldProgressivelyReveal = Boolean(previewSrc && originalSrc && previewSrc !== originalSrc);

    return (
        <Modal state={overlayState}>
            <Modal.Backdrop
                isDismissable
                className="fixed inset-0 z-50 h-screen w-screen bg-black/95 p-0 text-white"
                onMouseMove={showInfoTemporarily}
                onPointerDown={showInfoTemporarily}
            >
                <Modal.Container
                    placement="center"
                    size="full"
                    className="m-0 h-screen max-h-screen w-screen max-w-none overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none"
                >
                    <Modal.Dialog className="relative h-screen w-screen overflow-hidden bg-transparent p-0 text-white outline-none">
                        <Modal.Body className="relative flex h-screen w-screen items-center justify-center overflow-hidden p-0">
                            <Modal.CloseTrigger
                                aria-label="关闭图片查看器"
                                className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition hover:bg-white/20"
                            >
                                x
                            </Modal.CloseTrigger>

                            {items.length > 1 && (
                                <>
                                    <button
                                        type="button"
                                        aria-label="上一张图片"
                                        className="absolute left-5 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20"
                                        onClick={() => goTo(-1)}
                                    >
                                        {"<"}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="下一张图片"
                                        className="absolute right-5 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20"
                                        onClick={() => goTo(1)}
                                    >
                                        {">"}
                                    </button>
                                </>
                            )}

                            <div
                                ref={viewportRef}
                                className={`relative h-screen w-screen touch-none select-none overflow-hidden ${
                                    scale > MIN_SCALE
                                        ? isDragging
                                            ? "cursor-grabbing"
                                            : "cursor-grab"
                                        : "cursor-zoom-in"
                                }`}
                                onPointerCancel={stopDragging}
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={stopDragging}
                                onWheel={handleWheel}
                            >
                                <div
                                    className="absolute inset-0 origin-center will-change-transform"
                                    style={{
                                        transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
                                    }}
                                >
                                    <Image
                                        key={`${activeItem.id}-preview`}
                                        src={previewSrc}
                                        alt={activeItem.alt ?? getFileName(activeItem)}
                                        fill
                                        priority
                                        draggable={false}
                                        sizes="100vw"
                                        unoptimized
                                        className="object-contain"
                                    />
                                    {shouldProgressivelyReveal ? (
                                        <div
                                            className="absolute inset-0 transition-[clip-path,opacity] duration-700 ease-out"
                                            style={{
                                                clipPath: isOriginalRevealActive
                                                    ? "inset(0 0 0 0)"
                                                    : "inset(0 0 100% 0)",
                                                opacity: isOriginalLoaded ? 1 : 0,
                                            }}
                                        >
                                            <Image
                                                key={`${activeItem.id}-original`}
                                                src={originalSrc}
                                                alt={activeItem.alt ?? getFileName(activeItem)}
                                                fill
                                                priority
                                                draggable={false}
                                                sizes="100vw"
                                                unoptimized
                                                className="object-contain"
                                                onLoad={() => {
                                                    setIsOriginalLoaded(true);
                                                    requestAnimationFrame(() => {
                                                        requestAnimationFrame(() => {
                                                            setIsOriginalRevealActive(true);
                                                        });
                                                    });
                                                }}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div
                                className={`absolute bottom-5 left-1/2 z-20 w-[min(720px,calc(100vw-40px))] -translate-x-1/2 rounded-2xl border border-white/10 bg-black/55 px-5 py-4 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
                                    isInfoVisible
                                        ? "translate-y-0 opacity-100"
                                        : "pointer-events-none translate-y-4 opacity-0"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-5">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-white">
                                            {getFileName(activeItem)}
                                        </p>
                                        <p className="mt-1 text-xs text-white/60">
                                            {formatTakenAt(activeItem.takenAt)}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 gap-4 text-right text-xs text-white/70">
                                        <span>{dimensions}</span>
                                        <span>{activeItem.mimeType ?? "未知类型"}</span>
                                        <span>{formatFileSize(activeItem.fileSize)}</span>
                                        <span>
                                            {activeIndex + 1} / {items.length}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </Modal.Body>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>
        </Modal>
    );
}
