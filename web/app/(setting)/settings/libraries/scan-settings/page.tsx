"use client";

import { Button, Input, TextField } from "@heroui/react";
import { useEffect, useState, useTransition } from "react";
import { getPreferences, updatePreferences } from "@/src/api/client";
import SettingsPage from "../../components/SettingsPage";

type ScanSettingsForm = {
    previewMaxDimension: string;
    previewQuality: string;
    videoProbeEnabled: boolean;
    videoProbeCommand: string;
    videoProbeTimeoutSeconds: string;
    videoFfmpegCommand: string;
    videoCoverTimePercent: string;
};

const DEFAULT_SCAN_SETTINGS: ScanSettingsForm = {
    previewMaxDimension: "960",
    previewQuality: "55",
    videoProbeEnabled: true,
    videoProbeCommand: "ffprobe",
    videoProbeTimeoutSeconds: "30",
    videoFfmpegCommand: "ffmpeg",
    videoCoverTimePercent: "20",
};

const inputClass =
    "w-full rounded-2xl border border-border bg-white/12 px-4 py-3 text-sm text-foreground outline-none transition focus:border-focus focus:bg-white/16 [&_input]:text-foreground [&_input]:placeholder:text-muted";

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    return "请求失败，请确认 API 服务已启动。";
}

export default function LibraryScanSettingsPage() {
    const [form, setForm] = useState<ScanSettingsForm>(DEFAULT_SCAN_SETTINGS);
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
                setForm(DEFAULT_SCAN_SETTINGS);
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
        preview_max_dimension: number;
        preview_quality: number;
        video_probe_enabled: boolean;
        video_probe_command: string;
        video_probe_timeout_seconds: number;
        video_ffmpeg_command: string;
        video_cover_time_percent: number;
    }) {
        setForm({
            previewMaxDimension: String(preferences.preview_max_dimension),
            previewQuality: String(preferences.preview_quality),
            videoProbeEnabled: preferences.video_probe_enabled,
            videoProbeCommand: preferences.video_probe_command,
            videoProbeTimeoutSeconds: String(preferences.video_probe_timeout_seconds),
            videoFfmpegCommand: preferences.video_ffmpeg_command,
            videoCoverTimePercent: String(preferences.video_cover_time_percent),
        });
    }

    function save() {
        startSaving(async () => {
            try {
                setError(null);
                setNotice(null);
                const saved = await updatePreferences({
                    preview_max_dimension: Number(form.previewMaxDimension),
                    preview_quality: Number(form.previewQuality),
                    video_probe_enabled: form.videoProbeEnabled,
                    video_probe_command: form.videoProbeCommand,
                    video_probe_timeout_seconds: Number(form.videoProbeTimeoutSeconds),
                    video_ffmpeg_command: form.videoFfmpegCommand,
                    video_cover_time_percent: Number(form.videoCoverTimePercent),
                });
                applyPreferencesToForm(saved);
                setNotice("扫描设置已保存，后续扫描和手动生成任务都会使用新参数。");
            } catch (saveError) {
                setError(getErrorMessage(saveError));
            }
        });
    }

    return (
        <SettingsPage
            group="媒体库"
            title="扫描设置"
            description="配置图片缓存、视频技术分析与视频封面抽帧参数。"
        >

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
                <div className="mt-6 text-sm text-muted">正在加载扫描设置...</div>
            ) : (
                <div className="mt-6 space-y-5">
                    <section className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-foreground">
                                预览图设置
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-muted">
                                控制详情页和大图预览使用的缓存图尺寸与压缩质量。
                            </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-muted">
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
                                <span className="mb-2 block text-sm font-medium text-muted">
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

                    <section className="space-y-4 border-t border-border pt-5">
                        <div>
                            <h3 className="text-base font-semibold text-foreground">视频媒体分析</h3>
                            <p className="mt-1 text-sm leading-6 text-muted">
                                视频扫描后会由后续分析任务读取时长、分辨率和编解码器信息。此设置不会改变原始视频文件。
                            </p>
                        </div>
                        <label className="flex items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3">
                            <span>
                                <span className="block text-sm font-medium text-foreground">启用 FFprobe 分析</span>
                                <span className="mt-1 block text-xs text-muted">关闭后新视频将保留为待分析状态。</span>
                            </span>
                            <input
                                type="checkbox"
                                checked={form.videoProbeEnabled}
                                onChange={(event) => setForm((current) => ({ ...current, videoProbeEnabled: event.target.checked }))}
                                className="h-4 w-4 accent-accent"
                            />
                        </label>
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-muted">FFprobe 命令</span>
                                <TextField.Root value={form.videoProbeCommand} onChange={(value) => updateField("videoProbeCommand", value)}>
                                    <Input className={inputClass} placeholder="ffprobe" />
                                </TextField.Root>
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-muted">分析超时（秒）</span>
                                <TextField.Root value={form.videoProbeTimeoutSeconds} onChange={(value) => updateField("videoProbeTimeoutSeconds", value)}>
                                    <Input type="number" className={inputClass} />
                                </TextField.Root>
                            </label>
                        </div>
                    </section>

                    <section className="space-y-4 border-t border-border pt-5">
                        <div>
                            <h3 className="text-base font-semibold text-foreground">视频封面抽帧</h3>
                            <p className="mt-1 text-sm leading-6 text-muted">
                                视频封面统一保存到 api/data/preview/媒体库ID，不会修改原始视频文件。
                            </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-muted">FFmpeg 命令</span>
                                <TextField.Root value={form.videoFfmpegCommand} onChange={(value) => updateField("videoFfmpegCommand", value)}>
                                    <Input className={inputClass} placeholder="ffmpeg" />
                                </TextField.Root>
                            </label>
                            <label className="block">
                                <span className="mb-2 block text-sm font-medium text-muted">抽帧位置（视频百分比）</span>
                                <TextField.Root value={form.videoCoverTimePercent} onChange={(value) => updateField("videoCoverTimePercent", value)}>
                                    <Input type="number" min={1} max={90} className={inputClass} />
                                </TextField.Root>
                            </label>
                        </div>
                    </section>

                    <div className="flex justify-end gap-3">
                        <Button
                            className="rounded-2xl bg-accent px-5 text-accent-foreground hover:opacity-90 disabled:opacity-60"
                            isDisabled={isLoading || isSaving}
                            onPress={save}
                        >
                            {isSaving ? "保存中..." : "保存扫描设置"}
                        </Button>
                    </div>
                </div>
            )}
        </SettingsPage>
    );
}
