"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

function ActiveFocus({
    frame,
}: {
    frame: ActiveFrame | null;
}) {
    if (!frame) {
        return null;
    }

    return (
        <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-0 rounded-[20px] sidebar-active-focus"
            style={{
                width: frame.width,
                height: frame.height,
                opacity: frame.opacity,
                transform: `translate3d(${frame.left + frame.width / 2}px, ${frame.top + frame.height / 2}px, 0) translate3d(-50%, -50%, 0)`,
                transformOrigin: "center",
            }}
        />
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
                className={baseClass}
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
    const [preview, setPreview] = useState<{ index: number; pathname: string } | null>(null);

    const matchedIndex = items.findIndex(
        (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    );
    const routeIndex = pathname === "/" && items.length > 0 ? 0 : matchedIndex;
    const focusIndex = preview?.pathname === pathname ? preview.index : routeIndex;

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
            <ActiveFocus frame={activeFrame} />

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
                                    setPreview({ index, pathname });
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
    const [preferenceLoaded, setPreferenceLoaded] = useState(false);

    useLayoutEffect(() => {
        const cachedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

        // Restore before paint so a saved collapsed state never flashes expanded.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExpanded(cachedValue !== "0");
        setPreferenceLoaded(true);
    }, []);

    useEffect(() => {
        if (!preferenceLoaded) {
            return;
        }

        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, expanded ? "1" : "0");
    }, [expanded, preferenceLoaded]);

    return (
        <aside
            className={`flex h-full min-h-0 shrink-0 flex-col justify-between overflow-hidden py-2 transition-[width] duration-300 ${
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
