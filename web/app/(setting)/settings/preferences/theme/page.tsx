"use client";

import { Button } from "@heroui/react";
import { Sun, Moon, Display } from "@gravity-ui/icons";
import { useTheme, type ThemeMode } from "@/app/components/ThemeProvider";

export default function PreferencesPage() {
    const { mode, effective, setMode } = useTheme();

    function getOptionClass(option: ThemeMode) {
        const active = mode === option;

        return [
            "flex h-auto min-h-[92px] items-start justify-start rounded-2xl border px-4 py-4 text-left transition",
            active
                ? "border-slate-950 bg-slate-950 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-700/80",
        ].join(" ");
    }

    return (
        <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                偏好设置
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-100">偏好设置</h2>

            <div className="mt-6 space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/60">
                    <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">主题</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        切换亮色、暗色或跟随系统主题。
                    </p>
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                        当前生效主题：{effective === "dark" ? "暗色" : "亮色"}
                    </p>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <Button
                            type="button"
                            className={getOptionClass("light")}
                            onPress={() => setMode("light")}
                        >
                            <span className="mt-0.5 rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                <Sun className="h-4 w-4" />
                            </span>
                            <span className="ml-3 min-w-0">
                                <span className="block text-sm font-semibold">亮色</span>
                                <span className="mt-1 block text-xs leading-5 opacity-75">始终使用浅色界面。</span>
                            </span>
                        </Button>
                        <Button
                            type="button"
                            className={getOptionClass("dark")}
                            onPress={() => setMode("dark")}
                        >
                            <span className="mt-0.5 rounded-xl bg-slate-200 p-2 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                <Moon className="h-4 w-4" />
                            </span>
                            <span className="ml-3 min-w-0">
                                <span className="block text-sm font-semibold">暗色</span>
                                <span className="mt-1 block text-xs leading-5 opacity-75">始终使用深色界面。</span>
                            </span>
                        </Button>
                        <Button
                            type="button"
                            className={getOptionClass("system")}
                            onPress={() => setMode("system")}
                        >
                            <span className="mt-0.5 rounded-xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                                <Display className="h-4 w-4" />
                            </span>
                            <span className="ml-3 min-w-0">
                                <span className="block text-sm font-semibold">跟随系统</span>
                                <span className="mt-1 block text-xs leading-5 opacity-75">自动跟随设备外观设置。</span>
                            </span>
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
