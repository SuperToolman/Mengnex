"use client";

import { Books, LayoutCells } from "@gravity-ui/icons";
import { Tabs } from "@heroui/react";
import { usePathname, useRouter } from "next/navigation";

const navigationItems = [
    { href: "/manga", label: "首页", icon: LayoutCells },
    { href: "/manga/library", label: "漫画库", icon: Books },
];

export default function MangaNavigationTabs() {
    const pathname = usePathname();
    const router = useRouter();

    return (
        <Tabs.Root aria-label="漫画导航" selectedKey={pathname === "/manga/library" ? "/manga/library" : "/manga"} onSelectionChange={(key) => router.push(String(key))} className="w-52 shrink-0">
            <Tabs.ListContainer className="w-full">
                <Tabs.List className="grid w-full grid-cols-2">
                    {navigationItems.map((item) => (
                        <Tabs.Tab key={item.href} id={item.href} className="h-9 justify-center gap-2 whitespace-nowrap">
                            <item.icon className="h-4 w-4 shrink-0" />
                            {item.label}
                            <Tabs.Indicator />
                        </Tabs.Tab>
                    ))}
                </Tabs.List>
            </Tabs.ListContainer>
        </Tabs.Root>
    );
}
