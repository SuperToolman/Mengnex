"use client";

import { Gear, Xmark } from "@gravity-ui/icons";
import { Button, Input, Label, Modal, Spinner, Switch, TextField, toast, useOverlayState } from "@heroui/react";
import { useState, useTransition } from "react";
import { getPreferences, updatePreferences } from "@/src/api/client";

type ScanSettingsForm = {
    previewMaxDimension: string;
    previewQuality: string;
    videoProbeEnabled: boolean;
    videoProbeCommand: string;
    videoProbeTimeoutSeconds: string;
    videoFfmpegCommand: string;
    videoCoverTimePercent: string;
};

const defaultScanSettings: ScanSettingsForm = {
    previewMaxDimension: "640",
    previewQuality: "45",
    videoProbeEnabled: true,
    videoProbeCommand: "ffprobe",
    videoProbeTimeoutSeconds: "30",
    videoFfmpegCommand: "ffmpeg",
    videoCoverTimePercent: "20",
};

type PreferenceFields = {
    preview_max_dimension: number;
    preview_quality: number;
    video_probe_enabled: boolean;
    video_probe_command: string;
    video_probe_timeout_seconds: number;
    video_ffmpeg_command: string;
    video_cover_time_percent: number;
};

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "请求失败，请确认 API 服务已启动。";
}

function NumberSetting({
    label,
    value,
    onChange,
    min,
    max,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    min?: number;
    max?: number;
}) {
    return (
        <TextField.Root value={value} onChange={onChange}>
            <Label>{label}</Label>
            <Input type="number" min={min} max={max} />
        </TextField.Root>
    );
}

function TextSetting({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
}) {
    return (
        <TextField.Root value={value} onChange={onChange}>
            <Label>{label}</Label>
            <Input placeholder={placeholder} />
        </TextField.Root>
    );
}

export default function LibraryScanSettingsDialog() {
    const modal = useOverlayState({});
    const [form, setForm] = useState<ScanSettingsForm>(defaultScanSettings);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, startSaving] = useTransition();

    function applyPreferences(preferences: PreferenceFields) {
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

    function updateField(key: keyof ScanSettingsForm, value: string) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function load() {
        setIsLoading(true);
        try {
            applyPreferences(await getPreferences());
        } catch (error) {
            setForm(defaultScanSettings);
            toast.danger(getErrorMessage(error));
        } finally {
            setIsLoading(false);
        }
    }

    function save() {
        startSaving(async () => {
            try {
                applyPreferences(await updatePreferences({
                    preview_max_dimension: Number(form.previewMaxDimension),
                    preview_quality: Number(form.previewQuality),
                    video_probe_enabled: form.videoProbeEnabled,
                    video_probe_command: form.videoProbeCommand,
                    video_probe_timeout_seconds: Number(form.videoProbeTimeoutSeconds),
                    video_ffmpeg_command: form.videoFfmpegCommand,
                    video_cover_time_percent: Number(form.videoCoverTimePercent),
                }));
                toast.success("扫描设置已保存。");
                modal.close();
            } catch (error) {
                toast.danger(getErrorMessage(error));
            }
        });
    }

    return (
        <Modal state={modal}>
            <Modal.Trigger>
                <Button variant="secondary" className="gap-2" onPress={() => void load()}>
                    <Gear className="h-4 w-4" />
                    扫描设置
                </Button>
            </Modal.Trigger>
            <Modal.Backdrop isDismissable={!isSaving} variant="blur">
                <Modal.Container placement="center" className="w-[min(720px,calc(100vw-32px))]">
                    <Modal.Dialog className="max-h-[calc(100dvh-32px)] overflow-hidden outline-none">
                        <Modal.Header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
                            <div>
                                <Modal.Heading>扫描设置</Modal.Heading>
                                <p className="mt-1 text-sm text-muted">配置预览图、视频分析与封面抽帧的默认参数。</p>
                            </div>
                            <Modal.CloseTrigger aria-label="关闭扫描设置" className="p-2 text-muted hover:bg-default">
                                <Xmark className="h-5 w-5" />
                            </Modal.CloseTrigger>
                        </Modal.Header>
                        <Modal.Body className="max-h-[calc(100dvh-220px)] space-y-6 overflow-y-auto px-6 py-5">
                            {isLoading ? <div className="flex justify-center py-12"><Spinner aria-label="正在加载扫描设置" /></div> : <>
                                <section className="space-y-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">预览图</h3>
                                        <p className="mt-1 text-sm text-muted">控制详情页与大图预览所用缓存图的尺寸和压缩质量。</p>
                                    </div>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <NumberSetting label="质量" value={form.previewQuality} onChange={(value) => updateField("previewQuality", value)} min={1} max={100} />
                                        <NumberSetting label="最大分辨率" value={form.previewMaxDimension} onChange={(value) => updateField("previewMaxDimension", value)} min={1} />
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">视频技术信息</h3>
                                        <p className="mt-1 text-sm text-muted">读取新视频的时长、分辨率和编解码器信息，不会修改原始文件。</p>
                                    </div>
                                    <Switch isSelected={form.videoProbeEnabled} onChange={(videoProbeEnabled) => setForm((current) => ({ ...current, videoProbeEnabled }))}>
                                        <Switch.Content>
                                            <p className="text-sm font-medium text-foreground">启用 FFprobe 分析</p>
                                            <p className="mt-1 text-xs text-muted">关闭后新视频将保留为待分析状态。</p>
                                        </Switch.Content>
                                        <Switch.Control><Switch.Thumb /></Switch.Control>
                                    </Switch>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <TextSetting label="FFprobe 命令" value={form.videoProbeCommand} onChange={(value) => updateField("videoProbeCommand", value)} placeholder="ffprobe" />
                                        <NumberSetting label="分析超时（秒）" value={form.videoProbeTimeoutSeconds} onChange={(value) => updateField("videoProbeTimeoutSeconds", value)} min={1} />
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">视频封面</h3>
                                        <p className="mt-1 text-sm text-muted">封面缓存保存在预览目录中，不会修改原始视频文件。</p>
                                    </div>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <TextSetting label="FFmpeg 命令" value={form.videoFfmpegCommand} onChange={(value) => updateField("videoFfmpegCommand", value)} placeholder="ffmpeg" />
                                        <NumberSetting label="抽帧位置（视频百分比）" value={form.videoCoverTimePercent} onChange={(value) => updateField("videoCoverTimePercent", value)} min={1} max={90} />
                                    </div>
                                </section>
                            </>}
                        </Modal.Body>
                        <Modal.Footer className="flex justify-end gap-3 border-t border-border px-6 py-4">
                            <Button variant="secondary" onPress={modal.close} isDisabled={isSaving}>取消</Button>
                            <Button onPress={save} isDisabled={isLoading || isSaving}>{isSaving ? "保存中..." : "保存"}</Button>
                        </Modal.Footer>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>
        </Modal>
    );
}
