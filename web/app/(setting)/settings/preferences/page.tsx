"use client";

import { useEffect, useState, useTransition } from "react";
import {
    getPreferences,
    updatePreferences,
    type PreferencesResponse,
} from "@/src/api/client";

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "object" && error && "message" in error) {
        return String(error.message);
    }

    return "请求失败，请确认 API 服务已启动。";
}

export default function PreferencesPage() {
    const [preferences, setPreferences] = useState<PreferencesResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        let cancelled = false;

        async function loadPreferences() {
            try {
                setError(null);
                setIsLoading(true);
                const data = await getPreferences();

                if (!cancelled) {
                    setPreferences(data);
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(getErrorMessage(loadError));
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        void loadPreferences();

        return () => {
            cancelled = true;
        };
    }, []);

    function setPhotoDisplaySource(source: PreferencesResponse["photo_display_source"]) {
        startTransition(async () => {
            try {
                setError(null);
                setNotice(null);
                const nextPreferences = await updatePreferences({
                    photo_display_source: source,
                });

                setPreferences(nextPreferences);
                setNotice(
                    source === "thumbnail"
                        ? "已将缩略图设为默认显示来源。列表优先使用 Thumb，查看时优先使用 Preview。"
                        : "已将原图设为默认显示来源。列表和查看器都会优先请求原图。",
                );
            } catch (updateError) {
                setError(getErrorMessage(updateError));
            }
        });
    }

    const currentSource = preferences?.photo_display_source ?? "thumbnail";

    return (
        <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                偏好设置
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">偏好设置</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                配置照片页默认优先使用缩略图资源还是原图资源。
            </p>

            {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            ) : null}

            {notice ? (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {notice}
                </div>
            ) : null}

            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-base font-semibold text-slate-950">照片显示来源</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                    `缩略图` 模式会优先使用 `api/data/thumb` 与 `api/data/preview`
                    中的生成资源；`原图` 模式会直接请求源文件。
                </p>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <button
                        type="button"
                        disabled={isLoading || isPending}
                        className={`rounded-3xl border px-5 py-4 text-left transition ${
                            currentSource === "thumbnail"
                                ? "border-slate-900 bg-slate-950 text-white"
                                : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                        onClick={() => setPhotoDisplaySource("thumbnail")}
                    >
                        <p className="text-sm font-semibold">缩略图</p>
                        <p className="mt-2 text-xs leading-5 opacity-80">
                            默认推荐。列表加载更快，传输更小，查看时优先走 Preview。
                        </p>
                    </button>
                    <button
                        type="button"
                        disabled={isLoading || isPending}
                        className={`rounded-3xl border px-5 py-4 text-left transition ${
                            currentSource === "original"
                                ? "border-slate-900 bg-slate-950 text-white"
                                : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                        onClick={() => setPhotoDisplaySource("original")}
                    >
                        <p className="text-sm font-semibold">原图</p>
                        <p className="mt-2 text-xs leading-5 opacity-80">
                            始终直接读取源文件。画质最好，但大图库下会更慢。
                        </p>
                    </button>
                </div>
            </div>
        </div>
    );
}
