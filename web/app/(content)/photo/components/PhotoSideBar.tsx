"use client";

import { usePathname, useRouter } from "next/navigation";
import {
    Folder,
    LayoutCells,
    Sparkles,
    Star,
} from "@gravity-ui/icons";
import { SearchField, Tabs } from "@heroui/react";
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

const PHOTO_ZOOM_LABELS = ["小", "较小", "正常", "较大", "大"] as const;

function getSelectedNavigationKey(pathname: string) {
    return PHOTO_NAV_ITEMS.find((item) =>
        item.href === "/photo"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`),
    )?.href ?? "/photo";
}

export default function PhotoSideBar() {
    const pathname = usePathname();
    const router = useRouter();
    const {
        scaleLevel,
        scaleMode,
        searchQuery,
        setScaleLevel,
        setSearchQuery,
    } = usePhotoShell();
    const shouldShowControls = scaleMode !== "none";
    const selectedNavigationKey = getSelectedNavigationKey(pathname);

    return (
        <div className="flex min-w-max items-center gap-3">
                <Tabs.Root
                    aria-label="照片导航"
                    selectedKey={selectedNavigationKey}
                    onSelectionChange={(key) => router.push(String(key))}
                    className="w-[440px] shrink-0"
                >
                    <Tabs.ListContainer className="w-full">
                        <Tabs.List className="grid w-full grid-cols-4">
                    {PHOTO_NAV_ITEMS.map((item) => {
                        return (
                            <Tabs.Tab
                                key={item.href}
                                id={item.href}
                                className="h-9 justify-center gap-2 px-2 whitespace-nowrap"
                            >
                                <item.icon className="h-4 w-4 shrink-0" />
                                {item.label}
                                <Tabs.Indicator />
                            </Tabs.Tab>
                        );
                    })}
                        </Tabs.List>
                    </Tabs.ListContainer>
                </Tabs.Root>

                {shouldShowControls ? (
                    <div className="flex min-w-[320px] items-center justify-end gap-2">
                        <SearchField
                            value={searchQuery}
                            onChange={setSearchQuery}
                            aria-label="搜索文件夹或照片"
                            className="min-w-[220px] flex-1"
                        >
                            <SearchField.Group className="h-9">
                                <SearchField.SearchIcon />
                                <SearchField.Input placeholder="搜索文件夹或照片" />
                                <SearchField.ClearButton />
                            </SearchField.Group>
                        </SearchField>

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
