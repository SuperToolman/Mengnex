"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@heroui/react";
import ContentPageLayout from "@/app/components/ContentPageLayout";

type SettingSection = {
    label: string;
    description: string;
    items: Array<{
        href: string;
        label: string;
        description: string;
        activePaths?: string[];
    }>;
};

const settingSections: SettingSection[] = [
    {
        label: "媒体库",
        description: "媒体源、扫描与元数据配置",
        items: [
            {
                href: "/settings/libraries/list",
                label: "媒体库列表",
                description: "管理媒体库与扫描入口",
            },
            {
                href: "/settings/libraries/metadata",
                label: "资源管理",
                description: "元数据、作者与标签词库",
                activePaths: [
                    "/settings/libraries/metadata",
                    "/settings/libraries/authors",
                    "/settings/libraries/tags",
                ],
            },
            {
                href: "/settings/libraries/remote-sources",
                label: "远程数据源",
                description: "管理 WebDAV 等远程媒体连接",
            },
        ],
    },
    {
        label: "首选项",
        description: "界面偏好与应用运行信息",
        items: [
            {
                href: "/settings/preferences/theme",
                label: "偏好设置",
                description: "主题切换与外观行为",
            },
            {
                href: "/settings/preferences/logs",
                label: "系统日志",
                description: "查看运行日志与诊断信息",
            },
        ],
    },
    {
        label: "安全",
        description: "账号与访问安全",
        items: [
            {
                href: "/settings/security/account",
                label: "账号安全",
                description: "密码、登录与设备保护",
            },
        ],
    },
];

export default function SettingsLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const pathname = usePathname();

    return (
        <ContentPageLayout title="设置" description="管理媒体库、界面偏好和访问安全。">
            <div className="flex h-full min-h-0 gap-4">
                <aside className="w-55 overflow-y-auto space-y-4">
                    {settingSections.map((section) => (
                        <Card.Root key={section.label}>
                            <Card.Content>
                                <section>
                                    <div className="px-2">
                                        <h2 className="text-sm font-semibold text-foreground">
                                            {section.label}
                                        </h2>
                                        <p className="mt-1 text-xs leading-5 text-muted">
                                            {section.description}
                                        </p>
                                    </div>
                                    <nav className="mt-3 flex flex-col gap-1.5">
                                        {section.items.map((item) => {
                                            const active = (item.activePaths ?? [item.href]).includes(pathname);

                                            return (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    className={`rounded-2xl px-2 py-2 text-left transition ${active ? "bg-accent-soft" : "hover:bg-default"}`}
                                                >
                                                    <span className={`block text-sm font-medium ${active ? "text-accent-soft-foreground" : "text-foreground"}`}>
                                                        {item.label}
                                                    </span>
                                                    <span className="mt-1 block text-xs text-muted">
                                                        {item.description}
                                                    </span>
                                                </Link>
                                            );
                                        })}
                                    </nav>
                                </section>
                            </Card.Content>
                        </Card.Root>
                    ))}
                </aside>
                <section className="min-w-0 flex-1 overflow-auto rounded-3xl bg-surface p-6 shadow-surface">
                    {children}
                </section>
            </div>
        </ContentPageLayout>
    );
}
