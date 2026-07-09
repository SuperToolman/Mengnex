"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
    SIDEBAR_BOTTOM_CONFIG,
    SIDEBAR_CONFIG,
    type SidebarItem,
} from "@/types/sidebar";

const SIDEBAR_STORAGE_KEY = "mengnex.sidebar.expanded";

type ActiveFrame = {
    top: number;
    left: number;
    width: number;
    height: number;
    opacity: number;
};

type BlobState = {
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
};

function FluidFocus({
    frame,
}: {
    frame: ActiveFrame | null;
}) {
    const filterId = useId().replace(/:/g, "");
    const sourceBlobRef = useRef<HTMLDivElement | null>(null);
    const bridgeBlobRef = useRef<HTMLDivElement | null>(null);
    const leadBlobRef = useRef<HTMLDivElement | null>(null);
    const glowRef = useRef<HTMLDivElement | null>(null);
    const targetRef = useRef<BlobState>({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        opacity: 0,
    });
    const previousTargetRef = useRef<BlobState | null>(null);
    const transitionRef = useRef<{
        from: BlobState;
        startedAt: number;
        duration: number;
    } | null>(null);

    useEffect(() => {
        if (!frame) {
            targetRef.current = {
                ...targetRef.current,
                opacity: 0,
            };
            previousTargetRef.current = null;
            transitionRef.current = null;
            return;
        }

        const nextTarget = {
            x: frame.left + frame.width / 2,
            y: frame.top + frame.height / 2,
            width: frame.width,
            height: frame.height,
            opacity: frame.opacity,
        };

        const previousTarget = previousTargetRef.current;

        if (
            previousTarget &&
            (previousTarget.x !== nextTarget.x ||
                previousTarget.y !== nextTarget.y ||
                previousTarget.width !== nextTarget.width ||
                previousTarget.height !== nextTarget.height)
        ) {
            transitionRef.current = {
                from: previousTarget,
                startedAt: performance.now(),
                duration: 420,
            };
        }

        targetRef.current = nextTarget;
        previousTargetRef.current = nextTarget;
    }, [frame]);

    useEffect(() => {
        const sourceBlob = sourceBlobRef.current;
        const bridgeBlob = bridgeBlobRef.current;
        const leadBlob = leadBlobRef.current;
        const glow = glowRef.current;

        if (!sourceBlob || !bridgeBlob || !leadBlob || !glow) {
            return;
        }

        let animationFrame = 0;

        const state = {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            opacity: 0,
            velocityX: 0,
            velocityY: 0,
            ready: false,
        };

        const renderBlob = (node: HTMLDivElement, blob: BlobState) => {
            node.style.opacity = `${Math.max(0, blob.opacity)}`;
            node.style.width = `${Math.max(0, blob.width)}px`;
            node.style.height = `${Math.max(0, blob.height)}px`;
            node.style.transform = `translate(${blob.x - blob.width / 2}px, ${blob.y - blob.height / 2}px)`;
        };

        const animate = (now: number) => {
            const target = targetRef.current;

            if (!state.ready) {
                state.x = target.x;
                state.y = target.y;
                state.width = target.width;
                state.height = target.height;
                state.opacity = target.opacity;
                state.ready = true;
            }

            state.velocityX += (target.x - state.x) * 0.14;
            state.velocityX *= 0.72;
            state.x += state.velocityX;

            state.velocityY += (target.y - state.y) * 0.18;
            state.velocityY *= 0.68;
            state.y += state.velocityY;

            state.width += (target.width - state.width) * 0.18;
            state.height += (target.height - state.height) * 0.18;
            state.opacity += (target.opacity - state.opacity) * 0.15;

            const travel = Math.min(
                Math.hypot(state.velocityX * 1.1, state.velocityY * 1.35),
                26,
            );
            const leadWidth = state.width * Math.max(0.9, 1 - travel * 0.0045);
            const leadHeight = state.height * (1 + travel * 0.02);

            renderBlob(leadBlob, {
                x: state.x,
                y: state.y,
                width: leadWidth,
                height: leadHeight,
                opacity: state.opacity,
            });

            const transition = transitionRef.current;

            if (transition) {
                const rawProgress = Math.min(1, (now - transition.startedAt) / transition.duration);
                const easedProgress = 1 - Math.pow(1 - rawProgress, 3);
                const sourceX = transition.from.x + (state.x - transition.from.x) * easedProgress;
                const sourceY = transition.from.y + (state.y - transition.from.y) * easedProgress;
                const sourceWidth = transition.from.width + (leadWidth - transition.from.width) * easedProgress;
                const sourceHeight = transition.from.height + (leadHeight - transition.from.height) * easedProgress;

                renderBlob(sourceBlob, {
                    x: sourceX,
                    y: sourceY,
                    width: sourceWidth,
                    height: sourceHeight,
                    opacity: state.opacity * (1 - easedProgress) * 0.92,
                });

                const dx = Math.abs(state.x - sourceX);
                const dy = Math.abs(state.y - sourceY);

                renderBlob(bridgeBlob, {
                    x: (state.x + sourceX) / 2,
                    y: (state.y + sourceY) / 2,
                    width: Math.max(leadWidth, dx + leadWidth * 0.85),
                    height: Math.max(state.height * 0.78, Math.max(leadHeight, sourceHeight) + dy * 0.22),
                    opacity: state.opacity * Math.sin(rawProgress * Math.PI) * 0.78,
                });

                if (rawProgress >= 1) {
                    transitionRef.current = null;
                }
            } else {
                renderBlob(sourceBlob, {
                    x: state.x,
                    y: state.y,
                    width: 0,
                    height: 0,
                    opacity: 0,
                });
                renderBlob(bridgeBlob, {
                    x: state.x,
                    y: state.y,
                    width: 0,
                    height: 0,
                    opacity: 0,
                });
            }

            glow.style.opacity = `${state.opacity}`;
            glow.style.width = `${state.width + 18}px`;
            glow.style.height = `${state.height + 22}px`;
            glow.style.transform = `translate(${state.x - (state.width + 18) / 2}px, ${state.y - (state.height + 22) / 2}px)`;

            animationFrame = window.requestAnimationFrame(animate);
        };

        animationFrame = window.requestAnimationFrame(animate);

        return () => {
            window.cancelAnimationFrame(animationFrame);
        };
    }, []);

    return (
        <>
            <svg className="pointer-events-none absolute h-0 w-0">
                <defs>
                    <filter id={filterId}>
                        <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
                        <feColorMatrix
                            in="blur"
                            mode="matrix"
                            values="
                                1 0 0 0 0
                                0 1 0 0 0
                                0 0 1 0 0
                                0 0 0 24 -11
                            "
                            result="goo"
                        />
                        <feComposite in="SourceGraphic" in2="goo" operator="atop" />
                    </filter>
                </defs>
            </svg>

            <div
                className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[24px]"
                style={{ filter: `url(#${filterId})` }}
            >
                <div ref={sourceBlobRef} className="sidebar-fluid-blob sidebar-fluid-blob-source" />
                <div ref={bridgeBlobRef} className="sidebar-fluid-blob sidebar-fluid-blob-bridge" />
                <div ref={leadBlobRef} className="sidebar-fluid-blob sidebar-fluid-blob-lead" />
            </div>

            <div
                ref={glowRef}
                className="pointer-events-none absolute z-0 rounded-[24px] sidebar-fluid-glow"
            />
        </>
    );
}

function SidebarLabel({
    children,
    expanded,
}: {
    children: React.ReactNode;
    expanded: boolean;
}) {
    return (
        <span
            aria-hidden={!expanded}
            className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ${
                expanded
                    ? "max-w-24 translate-x-0 opacity-100"
                    : "max-w-0 -translate-x-1 opacity-0"
            }`}
        >
            {children}
        </span>
    );
}

function SidebarRow({
    children,
    expanded,
    title,
    active,
    href,
    onClick,
    itemRef,
}: {
    children: React.ReactNode;
    expanded: boolean;
    title?: string;
    active?: boolean;
    href?: string;
    onClick?: () => void;
    itemRef?: (node: HTMLAnchorElement | null) => void;
}) {
    const baseClass = `origin-left flex h-12 items-center justify-start overflow-hidden rounded-[20px] px-[14px] text-sm font-medium transition-[color,width,gap,background-color] duration-300 ${
        expanded ? "w-full gap-3" : "w-12 gap-0"
    } ${active ? "text-slate-950 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`;

    if (!href) {
        return (
            <button
                type="button"
                aria-label={title}
                title={title}
                onClick={onClick}
                className={`${baseClass} hover:bg-white/60 dark:hover:bg-white/10`}
            >
                {children}
            </button>
        );
    }

    return (
        <Link
            href={href}
            ref={itemRef}
            aria-label={title}
            title={expanded ? undefined : title}
            onClick={onClick}
            className={baseClass}
        >
            {children}
        </Link>
    );
}

function SidebarSection({
    items,
    pathname,
    expanded,
}: {
    items: SidebarItem[];
    pathname: string;
    expanded: boolean;
}) {
    const listRef = useRef<HTMLUListElement | null>(null);
    const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
    const [activeFrame, setActiveFrame] = useState<ActiveFrame | null>(null);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);

    const matchedIndex = items.findIndex(
        (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    );
    const routeIndex = pathname === "/" && items.length > 0 ? 0 : matchedIndex;
    const focusIndex = previewIndex ?? routeIndex;

    useEffect(() => {
        setPreviewIndex(null);
    }, [pathname]);

    const measureItem = (index: number | null) => {
        if (!listRef.current || index === null || index < 0) {
            setActiveFrame((current) => (current === null ? current : null));
            return;
        }

        const itemNode = itemRefs.current[index];
        if (!itemNode) {
            return;
        }

        const listRect = listRef.current.getBoundingClientRect();
        const itemRect = itemNode.getBoundingClientRect();

        const nextFrame = {
            top: itemRect.top - listRect.top,
            left: itemRect.left - listRect.left,
            width: itemRect.width,
            height: itemRect.height,
            opacity: 1,
        };

        setActiveFrame((current) => {
            if (
                current &&
                current.top === nextFrame.top &&
                current.left === nextFrame.left &&
                current.width === nextFrame.width &&
                current.height === nextFrame.height &&
                current.opacity === nextFrame.opacity
            ) {
                return current;
            }

            return nextFrame;
        });
    };

    useLayoutEffect(() => {
        measureItem(focusIndex);
    }, [focusIndex, expanded]);

    useEffect(() => {
        if (!listRef.current) {
            return;
        }

        const handleResize = () => {
            measureItem(focusIndex);
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(listRef.current);
        itemRefs.current.forEach((item) => {
            if (item) {
                observer.observe(item);
            }
        });

        window.addEventListener("resize", handleResize);

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", handleResize);
        };
    }, [focusIndex, expanded]);

    return (
        <ul
            ref={listRef}
            className={`relative flex flex-col items-start gap-1 p-2 ${
                expanded ? "w-full" : "w-fit"
            }`}
        >
            <FluidFocus frame={activeFrame} />

            {items.map((item, index) => {
                const isActive = index === focusIndex;

                return (
                    <li
                        key={item.id}
                        className={`relative z-10 ${expanded ? "w-full" : "w-12"}`}
                    >
                        <SidebarRow
                            href={item.href}
                            expanded={expanded}
                            active={isActive}
                            title={item.label}
                            onClick={() => {
                                if (index !== routeIndex) {
                                    setPreviewIndex(index);
                                }
                            }}
                            itemRef={(node) => {
                                itemRefs.current[index] = node;
                            }}
                        >
                            {item.icon ? <item.icon className="h-5 w-5 shrink-0" /> : null}
                            <SidebarLabel expanded={expanded}>{item.label}</SidebarLabel>
                        </SidebarRow>
                    </li>
                );
            })}
        </ul>
    );
}

export default function SideBar() {
    const pathname = usePathname();
    const [expanded, setExpanded] = useState(true);
    const loadedPreferenceRef = useRef(false);

    useEffect(() => {
        const cachedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

        if (cachedValue === "0") {
            setExpanded(false);
        }

        loadedPreferenceRef.current = true;
    }, []);

    useEffect(() => {
        if (!loadedPreferenceRef.current) {
            return;
        }

        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, expanded ? "1" : "0");
    }, [expanded]);

    return (
        <aside
            className={`flex h-full min-h-0 shrink-0 flex-col justify-between overflow-hidden py-2 backdrop-blur-sm transition-[width] duration-300 ${
                expanded ? "w-[168px]" : "w-[64px]"
            }`}
        >
            <div className={`min-h-0 flex-1 ${expanded ? "w-full" : "w-fit"}`}>
                <div className={`px-2 pb-1 ${expanded ? "w-full" : "w-fit"}`}>
                    <SidebarRow
                        expanded={expanded}
                        title={expanded ? "收起侧边栏" : "展开侧边栏"}
                        onClick={() => {
                            setExpanded((current) => !current);
                        }}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            className={`h-5 w-5 shrink-0 transition-transform duration-300 ${
                                expanded ? "rotate-0" : "rotate-180"
                            }`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M15 6l-6 6 6 6" />
                            <path d="M5 4v16" />
                        </svg>
                        <SidebarLabel expanded={expanded}>
                            {expanded ? "收纳" : "展开"}
                        </SidebarLabel>
                    </SidebarRow>
                </div>
                <SidebarSection items={SIDEBAR_CONFIG} pathname={pathname} expanded={expanded} />
            </div>
            <SidebarSection items={SIDEBAR_BOTTOM_CONFIG} pathname={pathname} expanded={expanded} />
        </aside>
    );
}
