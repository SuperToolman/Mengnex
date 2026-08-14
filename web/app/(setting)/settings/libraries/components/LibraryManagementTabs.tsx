"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "@heroui/react";

const MANAGEMENT_TABS = [
    { id: "/settings/libraries/metadata", label: "元数据管理" },
    { id: "/settings/libraries/authors", label: "作者库" },
    { id: "/settings/libraries/tags", label: "标签库" },
] as const;

export default function LibraryManagementTabs() {
    const pathname = usePathname();
    const router = useRouter();
    const selectedKey = MANAGEMENT_TABS.some((tab) => tab.id === pathname)
        ? pathname
        : MANAGEMENT_TABS[0].id;

    return (
        <Tabs.Root
            aria-label="资源管理分类"
            selectedKey={selectedKey}
            onSelectionChange={(key) => router.push(String(key))}
            className="w-full sm:w-[360px]"
        >
            <Tabs.ListContainer className="w-full">
                <Tabs.List className="grid w-full grid-cols-3">
                    {MANAGEMENT_TABS.map((tab) => (
                        <Tabs.Tab
                            key={tab.id}
                            id={tab.id}
                            className="h-9 justify-center px-2 whitespace-nowrap"
                        >
                            {tab.label}
                            <Tabs.Indicator />
                        </Tabs.Tab>
                    ))}
                </Tabs.List>
            </Tabs.ListContainer>
        </Tabs.Root>
    );
}
