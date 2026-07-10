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
    "h-11 w-full rounded-2xl border border-white/70 bg-white/78 px-3 text-sm text-slate-700 shadow-none outline-none transition focus:border-sky-300 focus:bg-white dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 [&_input]:text-slate-700 dark:[&_input]:text-slate-200 [&_input]:placeholder:text-slate-400 dark:[&_input]:placeholder:text-slate-500";
const sliderClass =
    "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-transparent accent-sky-500 [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-200 dark:[&::-webkit-slider-runnable-track]:bg-slate-700 [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-sky-500 [&::-webkit-slider-thumb]:shadow [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-0 [&::-moz-range-track]:bg-slate-200 dark:[&::-moz-range-track]:bg-slate-700 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-sky-500 [&::-moz-range-thumb]:shadow";

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
        <div className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(240,249,255,0.92))] p-3 shadow-[0_12px_40px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.94),rgba(17,24,39,0.9))] dark:shadow-none">
            <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
                <nav
                    aria-label="照片导航"
                    className="flex min-h-11 flex-1 items-center gap-2 overflow-x-auto"
                >
                    {PHOTO_NAV_ITEMS.map((item) => {
                        const isActive = isActivePath(pathname, item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm transition-colors ${isActive
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
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3 xl:max-w-[420px] xl:flex-nowrap">
                        <label className="block min-w-[220px] flex-1">
                            <div className="relative">
                                <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
                                    <Magnifier className="h-4 w-4" />
                                </div>
                                <TextField.Root value={searchQuery} onChange={setSearchQuery}>
                                    <Input
                                        placeholder="搜索文件夹或照片"
                                        className={`${searchInputClass} pl-10`}
                                    />
                                </TextField.Root>
                            </div>
                        </label>

                        <div className="flex min-w-[140px] flex-1 items-center rounded-2xl border border-white/70 bg-white/72 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/72 xl:max-w-[160px] xl:flex-none">
                            <input
                                type="range"
                                aria-label="内容缩放"
                                className={sliderClass}
                                min={0}
                                max={3}
                                step={1}
                                value={scaleLevel}
                                onChange={(event) => {
                                    setScaleLevel(Number(event.target.value));
                                }}
                            />
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
