"use client";

import { Button, Input, TextField } from "@heroui/react";
import { useEffect, useState, useTransition } from "react";
import { getPreferences, updatePreferences } from "@/src/api/client";

type ScanSettingsForm = {
    thumbMaxDimension: string;
    previewMaxDimension: string;
    thumbQuality: string;
    previewQuality: string;
};

const inputClass =
    "w-full rounded-2xl border border-[var(--theme-border)] bg-white/12 px-4 py-3 text-sm text-[var(--theme-text-primary)] outline-none transition focus:border-[var(--theme-text-secondary)] focus:bg-white/16 [&_input]:text-[var(--theme-text-primary)] [&_input]:placeholder:text-[var(--theme-text-muted)]";

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    return "请求失败，请确认 API 服务已启动。";
}

export default function LibraryScanSettingsPage() {
    const [form, setForm] = useState<ScanSettingsForm>({
        thumbMaxDimension: "",
        previewMaxDimension: "",
        thumbQuality: "",
        previewQuality: "",
    });
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, startSaving] = useTransition();

    useEffect(() => {
        async function load() {
            try {
                const preferences = await getPreferences();
                applyPreferencesToForm(preferences);
                setError(null);
            } catch (loadError) {
                setError(getErrorMessage(loadError));
            } finally {
                setIsLoading(false);
            }
        }

        void load();
    }, []);

    function updateField(key: keyof ScanSettingsForm, value: string) {
        setForm((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function applyPreferencesToForm(preferences: {
        thumb_max_dimension: number;
        preview_max_dimension: number;
        thumb_quality: number;
        preview_quality: number;
    }) {
        setForm({
            thumbMaxDimension: String(preferences.thumb_max_dimension),
            previewMaxDimension: String(preferences.preview_max_dimension),
            thumbQuality: String(preferences.thumb_quality),
            previewQuality: String(preferences.preview_quality),
        });
    }

    function save() {
        startSaving(async () => {
            try {
                setError(null);
                setNotice(null);
                const saved = await updatePreferences({
                    thumb_max_dimension: Number(form.thumbMaxDimension),
                    preview_max_dimension: Number(form.previewMaxDimension),
                    thumb_quality: Number(form.thumbQuality),
                    preview_quality: Number(form.previewQuality),
                });
                applyPreferencesToForm(saved);
                setNotice("扫描设置已保存，后续扫描和手动生成任务都会使用新参数。");
            } catch (saveError) {
                setError(getErrorMessage(saveError));
            }
        });
    }

    return (
        <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--theme-text-muted)]">
                媒体库
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
                扫描设置
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-text-secondary)]">
                配置缩略图与预览图的全局生成尺寸和质量。扫描时自动补齐缓存，以及手动生成缓存任务，都会读取这里的参数。
            </p>

            {error ? (
                <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/12 px-4 py-3 text-sm text-red-100 dark:text-red-200">
                    {error}
                </div>
            ) : null}

            {notice ? (
                <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-100">
                    {notice}
                </div>
            ) : null}

            {isLoading ? (
                <div className="mt-6 text-sm text-[var(--theme-text-secondary)]">正在加载扫描设置...</div>
            ) : (
                <div className="mt-6 space-y-5">
                    <section className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-[var(--theme-text-primary)]">
                                预览图设置
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-[var(--theme-text-secondary)]">
                                控制详情页和大图预览使用的缓存图尺寸与压缩质量。
                            </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-[var(--theme-text-secondary)]">
                                    质量
                                </span>
                                <TextField.Root
                                    value={form.previewQuality}
                                    onChange={(value) => updateField("previewQuality", value)}
                                >
                                    <Input type="number" className={inputClass} />
                                </TextField.Root>
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-[var(--theme-text-secondary)]">
                                    最大分辨率
                                </span>
                                <TextField.Root
                                    value={form.previewMaxDimension}
                                    onChange={(value) => updateField("previewMaxDimension", value)}
                                >
                                    <Input type="number" className={inputClass} />
                                </TextField.Root>
                            </label>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-[var(--theme-text-primary)]">
                                缩略图设置
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-[var(--theme-text-secondary)]">
                                控制列表、网格和封面拼图使用的小尺寸缓存图参数。
                            </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-[var(--theme-text-secondary)]">
                                    质量
                                </span>
                                <TextField.Root
                                    value={form.thumbQuality}
                                    onChange={(value) => updateField("thumbQuality", value)}
                                >
                                    <Input type="number" className={inputClass} />
                                </TextField.Root>
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-[var(--theme-text-secondary)]">
                                    最大分辨率
                                </span>
                                <TextField.Root
                                    value={form.thumbMaxDimension}
                                    onChange={(value) => updateField("thumbMaxDimension", value)}
                                >
                                    <Input type="number" className={inputClass} />
                                </TextField.Root>
                            </label>
                        </div>
                    </section>

                    <div className="flex justify-end">
                        <Button
                            className="rounded-2xl bg-[var(--theme-text-primary)] px-5 text-[var(--theme-bg-card)] hover:opacity-90 disabled:opacity-60"
                            isDisabled={isLoading || isSaving}
                            onPress={save}
                        >
                            {isSaving ? "保存中..." : "保存扫描设置"}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
