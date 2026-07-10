"use client";

import {
    ArrowDownToLine,
    CircleInfo,
    TrashBin,
    Xmark,
} from "@gravity-ui/icons";
import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import Image from "next/image";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type PointerEvent,
    type ReactNode,
    type WheelEvent,
} from "react";
import type { GalleryItemData } from "./GalleryItem";

type PhotoViewerProps = {
    items: GalleryItemData[];
    activeIndex: number | null;
    onChange: (index: number) => void;
    onDelete?: (photoId: string) => Promise<void>;
    onClose: () => void;
};

const CONTROLS_IDLE_DELAY = 2000;
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
        return "Unknown";
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
        return "Unknown";
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

async function downloadPhoto(url: string, fileName: string) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
}

function ViewerActionButton({
    label,
    icon,
    onPress,
    tone = "default",
    isDisabled = false,
}: {
    label: string;
    icon: ReactNode;
    onPress?: () => void;
    tone?: "default" | "danger";
    isDisabled?: boolean;
}) {
    return (
        <Button
            isIconOnly
            aria-label={label}
            variant="ghost"
            isDisabled={isDisabled}
            className={[
                "h-11 w-11 min-w-11 rounded-full border p-0",
                "backdrop-blur-xl transition-colors duration-200",
                "[&>span]:flex [&>span]:h-full [&>span]:w-full [&>span]:items-center [&>span]:justify-center",
                tone === "danger"
                    ? "border-red-400/20 bg-red-500/12 text-red-100 hover:bg-red-500/20"
                    : "border-white/10 bg-black/35 text-white hover:bg-white/15",
            ].join(" ")}
            onPress={onPress}
        >
            <span className="flex h-full w-full items-center justify-center">
                {icon}
            </span>
        </Button>
    );
}

export default function PhotoViewer({
    items,
    activeIndex,
    onChange,
    onDelete,
    onClose,
}: PhotoViewerProps) {
    const [areControlsVisible, setAreControlsVisible] = useState(true);
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState<ViewportPosition>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isOriginalLoaded, setIsOriginalLoaded] = useState(false);
    const [isOriginalRevealActive, setIsOriginalRevealActive] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<DragState | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isInfoOpenRef = useRef(false);
    const isDeleteDialogOpenRef = useRef(false);
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

    const clearIdleTimer = useCallback(() => {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        isInfoOpenRef.current = isInfoOpen;
    }, [isInfoOpen]);

    useEffect(() => {
        isDeleteDialogOpenRef.current = isDeleteDialogOpen;
    }, [isDeleteDialogOpen]);

    const scheduleControlsHide = useCallback(() => {
        clearIdleTimer();
        idleTimerRef.current = setTimeout(() => {
            if (!isInfoOpenRef.current && !isDeleteDialogOpenRef.current) {
                setAreControlsVisible(false);
            }
        }, CONTROLS_IDLE_DELAY);
    }, [clearIdleTimer]);

    const revealControls = useCallback(() => {
        setAreControlsVisible(true);
        setActionError(null);

        if (!isInfoOpenRef.current && !isDeleteDialogOpenRef.current) {
            scheduleControlsHide();
        }
    }, [scheduleControlsHide]);

    const goTo = useCallback((offset: number) => {
        if (activeIndex === null || items.length === 0) {
            return;
        }

        onChange(getSafeIndex(activeIndex + offset, items.length));
    }, [activeIndex, items.length, onChange]);

    const resetViewport = useCallback(() => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
        setIsDragging(false);
        setIsOriginalLoaded(false);
        setIsOriginalRevealActive(false);
        dragStateRef.current = null;
    }, []);

    function handleWheel(event: WheelEvent<HTMLDivElement>) {
        event.preventDefault();
        revealControls();

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
        revealControls();

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
        revealControls();

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

        const timer = window.setTimeout(() => {
            setAreControlsVisible(true);
            setIsInfoOpen(false);
            setIsDeleteDialogOpen(false);
            setActionError(null);
            scheduleControlsHide();
            resetViewport();
        }, 0);

        return () => {
            window.clearTimeout(timer);
            clearIdleTimer();
        };
    }, [activeIndex, clearIdleTimer, isOpen, resetViewport, scheduleControlsHide]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (isInfoOpen || isDeleteDialogOpen) {
            clearIdleTimer();
            const timer = window.setTimeout(() => {
                setAreControlsVisible(true);
            }, 0);

            return () => {
                window.clearTimeout(timer);
            };
        }

        const timer = window.setTimeout(() => {
            scheduleControlsHide();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [clearIdleTimer, isDeleteDialogOpen, isInfoOpen, isOpen, scheduleControlsHide]);

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
                return;
            }

            if (event.key === "Escape" && isDeleteDialogOpen) {
                event.preventDefault();
                setIsDeleteDialogOpen(false);
            }
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [goTo, isDeleteDialogOpen, isOpen]);

    if (!activeItem || activeIndex === null) {
        return null;
    }

    const dimensions = activeItem.width && activeItem.height
        ? `${activeItem.width} x ${activeItem.height}`
        : "Unknown";
    const previewSrc = activeItem.viewerSrc ?? activeItem.src;
    const originalSrc = activeItem.originalSrc ?? activeItem.src;
    const shouldProgressivelyReveal = Boolean(previewSrc && originalSrc && previewSrc !== originalSrc);
    const fileName = getFileName(activeItem);
    const infoRows = [
        { label: "文件名", value: fileName },
        { label: "拍摄时间", value: formatTakenAt(activeItem.takenAt) },
        { label: "尺寸", value: dimensions },
        { label: "类型", value: activeItem.mimeType ?? "Unknown" },
        { label: "大小", value: formatFileSize(activeItem.fileSize) },
        { label: "缩略图", value: activeItem.thumbnailSrc ? "已生成" : "未生成" },
        { label: "预览图", value: activeItem.previewSrc ? "已生成" : "未生成" },
        { label: "源路径", value: activeItem.sourcePath ?? "Unknown" },
    ];

    return (
        <>
            <Modal state={overlayState}>
                <Modal.Backdrop
                    isDismissable
                    className="fixed inset-0 z-50 h-screen w-screen bg-black/95 p-0 text-white"
                    onMouseMove={revealControls}
                    onPointerDown={revealControls}
                >
                    <Modal.Container
                        placement="center"
                        size="full"
                        className="m-0 h-screen max-h-screen w-screen max-w-none overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none"
                    >
                        <Modal.Dialog className="relative h-screen w-screen overflow-hidden bg-transparent p-0 text-white outline-none">
                            <Modal.Body className="relative flex h-screen w-screen items-center justify-center overflow-hidden p-0">
                                <div
                                    className={`absolute right-5 top-5 z-30 flex items-center gap-2 rounded-full border border-white/10 bg-black/28 p-2 backdrop-blur-2xl transition-all duration-300 ${
                                        areControlsVisible
                                            ? "translate-y-0 opacity-100"
                                            : "pointer-events-none -translate-y-3 opacity-0"
                                    }`}
                                >
                                    <ViewerActionButton
                                        label="显示图片信息"
                                        icon={<CircleInfo className="h-5 w-5" />}
                                        onPress={() => setIsInfoOpen((current) => !current)}
                                    />

                                    <ViewerActionButton
                                        label="下载原图"
                                        icon={<ArrowDownToLine className="h-5 w-5" />}
                                        onPress={() => {
                                            void downloadPhoto(originalSrc, fileName).catch((error: unknown) => {
                                                setActionError(
                                                    error instanceof Error ? error.message : "下载失败",
                                                );
                                                setAreControlsVisible(true);
                                            });
                                        }}
                                    />

                                    <ViewerActionButton
                                        label="删除图片"
                                        tone="danger"
                                        icon={<TrashBin className="h-5 w-5" />}
                                        isDisabled={!onDelete}
                                        onPress={() => setIsDeleteDialogOpen(true)}
                                    />

                                    <ViewerActionButton
                                        label="关闭图片查看器"
                                        icon={<Xmark className="h-5 w-5" />}
                                        onPress={onClose}
                                    />
                                </div>

                                {actionError ? (
                                    <div className="absolute right-5 top-[5.5rem] z-30 max-w-[min(360px,calc(100vw-40px))] rounded-2xl border border-red-400/20 bg-red-500/12 px-4 py-3 text-sm text-red-100 backdrop-blur-xl">
                                        {actionError}
                                    </div>
                                ) : null}

                                <div
                                    className={`absolute right-5 top-[5.5rem] z-40 w-[min(420px,calc(100vw-40px))] rounded-[28px] border border-white/10 bg-slate-950/92 text-white shadow-2xl backdrop-blur-2xl transition-all duration-200 ${
                                        isInfoOpen
                                            ? "translate-y-0 opacity-100"
                                            : "pointer-events-none -translate-y-2 opacity-0"
                                    }`}
                                    onMouseMove={revealControls}
                                    onPointerDown={(event) => {
                                        event.stopPropagation();
                                        revealControls();
                                    }}
                                >
                                    <div className="border-b border-white/10 px-5 py-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <h3 className="text-base font-semibold text-white">
                                                    图片信息
                                                </h3>
                                                <p className="mt-1 text-sm text-white/55">
                                                    {fileName}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label="关闭信息面板"
                                                className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
                                                onClick={() => setIsInfoOpen(false)}
                                            >
                                                <Xmark className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2 px-5 py-4">
                                        {infoRows.map((row) => (
                                            <div
                                                key={row.label}
                                                className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 text-sm"
                                            >
                                                <span className="text-white/45">
                                                    {row.label}
                                                </span>
                                                <span className="break-all text-white/85">
                                                    {row.value}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {items.length > 1 ? (
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
                                ) : null}

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
                                            alt={activeItem.alt ?? fileName}
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
                                                    alt={activeItem.alt ?? fileName}
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
                            </Modal.Body>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>

            <Modal isOpen={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <Modal.Backdrop className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
                <Modal.Container
                    placement="center"
                    className="z-[61] w-[min(460px,calc(100vw-32px))] rounded-[28px] border border-white/10 bg-slate-950/96 p-0 text-white shadow-2xl"
                >
                    <Modal.Dialog className="outline-none">
                        <Modal.Header className="border-b border-white/10 px-6 py-5">
                            <Modal.Heading className="text-lg font-semibold text-white">
                                确认删除
                            </Modal.Heading>
                            <p className="mt-1 text-sm text-white/55">
                                该操作会真实删除原始文件，并移除缩略图、预览图和数据库记录。
                            </p>
                        </Modal.Header>
                        <Modal.Body className="space-y-3 px-6 py-5">
                            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                                <p className="font-medium">{fileName}</p>
                                <p className="mt-1 break-all text-red-100/75">
                                    {activeItem.sourcePath ?? "Unknown"}
                                </p>
                            </div>
                        </Modal.Body>
                        <Modal.Footer className="flex justify-end gap-3 border-t border-white/10 px-6 py-5">
                            <Button
                                variant="ghost"
                                className="rounded-2xl text-white/70 hover:bg-white/10 hover:text-white"
                                isDisabled={isDeleting}
                                onPress={() => setIsDeleteDialogOpen(false)}
                            >
                                取消
                            </Button>
                            <Button
                                variant="ghost"
                                className="rounded-2xl bg-red-500/14 text-red-100 hover:bg-red-500/22"
                                isDisabled={!onDelete || isDeleting}
                                onPress={() => {
                                    if (!onDelete) {
                                        return;
                                    }

                                    setIsDeleting(true);
                                    setActionError(null);
                                    void onDelete(activeItem.id)
                                        .then(() => {
                                            setIsDeleteDialogOpen(false);
                                        })
                                        .catch((error: unknown) => {
                                            setActionError(
                                                error instanceof Error ? error.message : "删除失败",
                                            );
                                        })
                                        .finally(() => {
                                            setIsDeleting(false);
                                        });
                                }}
                            >
                                {isDeleting ? <Spinner size="sm" color="current" /> : "确认删除"}
                            </Button>
                        </Modal.Footer>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal>

        </>
    );
}
