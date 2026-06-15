"use client";

import { Modal, useOverlayState } from "@heroui/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { GalleryItemData } from "./GalleryItem";

type PhotoViewerProps = {
    items: GalleryItemData[];
    activeIndex: number | null;
    onChange: (index: number) => void;
    onClose: () => void;
};

const INFO_IDLE_DELAY = 3000;

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

export default function PhotoViewer({
    items,
    activeIndex,
    onChange,
    onClose,
}: PhotoViewerProps) {
    const [isInfoVisible, setIsInfoVisible] = useState(true);
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

    useEffect(() => {
        if (!isOpen) {
            clearIdleTimer();
            return;
        }

        setIsInfoVisible(true);
        scheduleInfoHide();

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

                            <div className="relative h-screen w-screen">
                                <Image
                                    key={activeItem.id}
                                    src={activeItem.src}
                                    alt={activeItem.alt ?? getFileName(activeItem)}
                                    fill
                                    priority
                                    sizes="100vw"
                                    className="object-contain"
                                />
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
