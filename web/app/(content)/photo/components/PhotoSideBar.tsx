"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Folder,
    LayoutCells,
    Magnifier,
    Sparkles,
    Star,
} from "@gravity-ui/icons";
import { Input, TextField } from "@heroui/react";
import type { ComponentType, SVGProps } from "react";
import ContentZoomSlider from "@/app/components/ContentZoomSlider";
import { usePhotoShell } from "./PhotoShellContext";

type PhotoNavItem = {
    href: string;
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const PHOTO_NAV_ITEMS: PhotoNavItem[] = [
    { href: "/photo", label: "图库", icon: LayoutCells },
    { href: "/photo/folder", label: "文件夹", icon: Folder },
    { href: "/photo/ic", label: "智能分类", icon: Sparkles },
    { href: "/photo/collection", label: "收藏", icon: Star },
];

const searchInputClass =
    "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-slate-700 shadow-none outline-none transition focus:border-sky-300 dark:text-slate-200 [&_input]:text-slate-700 dark:[&_input]:text-slate-200 [&_input]:placeholder:text-slate-400 dark:[&_input]:placeholder:text-slate-500";
const PHOTO_ZOOM_LABELS = ["小", "较小", "正常", "较大", "大"] as const;

function isActivePath(pathname: string, href: string) {
    if (href === "/photo") {
        return pathname === "/photo";
    }

    return pathname === href || pathname.startsWith(`${href}/`);
}

export default function PhotoSideBar() {
    const pathname = usePathname();
    const {
        scaleLevel,
        scaleMode,
        searchQuery,
        setScaleLevel,
        setSearchQuery,
    } = usePhotoShell();
    const shouldShowControls = scaleMode !== "none";

    return (
        <div className="flex min-w-max items-center gap-3">
                <nav
                    aria-label="照片导航"
                    className="flex shrink-0 items-center gap-1"
                >
                    {PHOTO_NAV_ITEMS.map((item) => {
                        const isActive = isActivePath(pathname, item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors ${isActive
                                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                        : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                                    }`}
                            >
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span className="whitespace-nowrap">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {shouldShowControls ? (
                    <div className="flex min-w-[320px] items-center justify-end gap-2">
                        <label className="block min-w-[220px] flex-1">
                            <div className="relative">
                                <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                                    <Magnifier className="h-4 w-4" />
                                </div>
                                <TextField.Root value={searchQuery} onChange={setSearchQuery}>
                                    <Input
                                        placeholder="搜索文件夹或照片"
                                        className={`${searchInputClass} pl-9`}
                                    />
                                </TextField.Root>
                            </div>
                        </label>

                        <ContentZoomSlider
                            value={scaleLevel}
                            labels={PHOTO_ZOOM_LABELS}
                            onChange={setScaleLevel}
                            ariaLabel="照片内容缩放"
                            label="缩放"
                            className="w-28"
                        />
                    </div>
                ) : null}
        </div>
    );
}
