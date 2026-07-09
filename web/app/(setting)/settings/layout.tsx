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
                description: "预览图与缩略图生成参数",
            },
            {
                href: "/settings/libraries/metadata",
                label: "元数据管理",
                description: "媒体识别与元数据维护",
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
            <aside
                className="w-72 shrink-0 overflow-auto rounded-3xl p-3 shadow-sm backdrop-blur-xl"
                style={{
                    border: "1px solid var(--theme-border-heavy)",
                    backgroundColor: "var(--theme-bg-overlay-heavy)",
                }}
            >
                <div className="px-3 py-2">
                    <p
                        className="text-xs font-medium uppercase tracking-[0.22em]"
                        style={{ color: "var(--theme-text-muted)" }}
                    >
                        设置
                    </p>
                    <h1
                        className="mt-1 text-xl font-semibold"
                        style={{ color: "var(--theme-text-primary)" }}
                    >
                        设置
                    </h1>
                </div>
                <div className="mt-4 space-y-4">
                    {settingSections.map((section) => (
                        <section key={section.label} className="rounded-3xl bg-white/6 px-3 py-3">
                            <div className="px-2">
                                <h2
                                    className="text-sm font-semibold"
                                    style={{ color: "var(--theme-text-primary)" }}
                                >
                                    {section.label}
                                </h2>
                                <p
                                    className="mt-1 text-xs leading-5"
                                    style={{ color: "var(--theme-text-secondary)" }}
                                >
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
                                            className="rounded-2xl px-3 py-3 text-left transition"
                                            style={{
                                                backgroundColor: active
                                                    ? "var(--theme-bg-overlay-heavy)"
                                                    : "transparent",
                                            }}
                                        >
                                            <span
                                                className="block text-sm font-medium"
                                                style={{ color: "var(--theme-text-primary)" }}
                                            >
                                                {item.label}
                                            </span>
                                            <span
                                                className="mt-1 block text-xs"
                                                style={{ color: "var(--theme-text-secondary)" }}
                                            >
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
            <section
                className="min-w-0 flex-1 overflow-auto rounded-3xl p-6 shadow-sm backdrop-blur-xl"
                style={{
                    border: "1px solid var(--theme-border-heavy)",
                    backgroundColor: "var(--theme-bg-overlay-heavy)",
                }}
            >
                {children}
            </section>
        </div>
    );
}
