"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SettingSection = {
    label: string;
    description: string;
    items: Array<{
        href: string;
        label: string;
        description: string;
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
                href: "/settings/libraries/scan-settings",
                label: "扫描设置",
                description: "预览图缓存与视频分析参数",
            },
            {
                href: "/settings/libraries/metadata",
                label: "元数据管理",
                description: "媒体识别与元数据维护",
            },
            {
                href: "/settings/libraries/remote-sources",
                label: "远程数据源",
                description: "管理 WebDAV 等远程媒体连接",
            },
            {
                href: "/settings/libraries/authors",
                label: "作者库",
                description: "查看扫描识别出的媒体作者",
            },
            {
                href: "/settings/libraries/tags",
                label: "标签库",
                description: "管理所有媒体类型共用的标签",
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
        <div className="flex h-full min-h-0 gap-4">
            <aside className="w-72 shrink-0 overflow-auto rounded-3xl bg-surface p-3 shadow-surface">
                <div className="px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
                        设置
                    </p>
                    <h1 className="mt-1 text-xl font-semibold text-foreground">
                        设置
                    </h1>
                </div>
                <div className="mt-4 space-y-4">
                    {settingSections.map((section) => (
                        <section key={section.label} className="rounded-3xl bg-white/6 px-3 py-3">
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
                                    const active = pathname === item.href;

                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`rounded-2xl px-3 py-3 text-left transition ${active ? "bg-accent-soft" : "hover:bg-default"}`}
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
                    ))}
                </div>
            </aside>
            <section className="min-w-0 flex-1 overflow-auto rounded-3xl bg-surface p-6 shadow-surface">
                {children}
            </section>
        </div>
    );
}
