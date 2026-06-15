import Link from "next/link";

const settingNavItems = [
    {
        href: "/settings/preferences",
        label: "首选项",
        description: "应用行为与通用偏好",
    },
    {
        href: "/settings/libraries",
        label: "媒体库",
        description: "管理扫码路径与媒体类型",
    },
];

export default function SettingsLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="flex h-full min-h-0 gap-4">
            <aside className="w-56 shrink-0 rounded-3xl border border-slate-200/70 bg-white/70 p-3 shadow-sm">
                <div className="px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                        Settings
                    </p>
                    <h1 className="mt-1 text-xl font-semibold text-slate-950">设置</h1>
                </div>
                <nav className="mt-3 flex flex-col gap-2">
                    {settingNavItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="rounded-2xl px-3 py-3 text-left transition hover:bg-slate-100"
                        >
                            <span className="block text-sm font-medium text-slate-900">
                                {item.label}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                                {item.description}
                            </span>
                        </Link>
                    ))}
                </nav>
            </aside>
            <section className="min-w-0 flex-1 overflow-auto rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm">
                {children}
            </section>
        </div>
    );
}
