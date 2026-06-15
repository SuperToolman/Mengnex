"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Folder,
    LayoutCells,
    Sparkles,
    Star,
} from "@gravity-ui/icons";
import type { ComponentType, SVGProps } from "react";

type PhotoNavItem = {
    href: string;
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const PHOTO_NAV_ITEMS: PhotoNavItem[] = [
    {
        href: "/photo",
        label: "图库",
        icon: LayoutCells,
    },
    {
        href: "/photo/folder",
        label: "文件夹",
        icon: Folder,
    },
    {
        href: "/photo/ic",
        label: "智能分类",
        icon: Sparkles,
    },
    {
        href: "/photo/collection",
        label: "收藏",
        icon: Star,
    },
];

function isActivePath(pathname: string, href: string) {
    if (href === "/photo") {
        return pathname === "/photo";
    }

    return pathname === href || pathname.startsWith(`${href}/`);
}

export default function PhotoSideBar() {
    const pathname = usePathname();

    return (
        <aside className="w-[172px] shrink-0 border-r border-slate-200/70 pr-3">
            <nav aria-label="照片导航" className="flex flex-col gap-1">
                {PHOTO_NAV_ITEMS.map((item) => {
                    const isActive = isActivePath(pathname, item.href);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                                isActive
                                    ? "bg-slate-900 text-white"
                                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            }`}
                        >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                        </Link>
                    );
                })}
            </nav>
        </aside>
    );
}
