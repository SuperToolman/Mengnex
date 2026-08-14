"use client";

import { Button, Modal, Slider, Spinner, useOverlayState } from "@heroui/react";
import NextImage from "next/image";
import Cropper, { type Area } from "react-easy-crop";
import { useEffect, useRef, useState } from "react";

type AvatarSettingProps = {
    onSave: (file: File) => Promise<void>;
    history?: { id: string; src: string; is_current: boolean }[];
    onUseHistory?: (avatarId: string) => Promise<void>;
    onDeleteHistory?: (avatarId: string) => Promise<void>;
    isDisabled?: boolean;
    label?: string;
};

function cropImage(source: string, crop: Area) {
    return new Promise<File>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = crop.width;
            canvas.height = crop.height;
            const context = canvas.getContext("2d");
            if (!context) {
                reject(new Error("无法创建头像裁切画布"));
                return;
            }
            context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
            canvas.toBlob((blob) => {
                if (blob) resolve(new File([blob], "avatar.webp", { type: "image/webp" }));
                else reject(new Error("头像裁切失败"));
            }, "image/webp", 0.92);
        };
        image.onerror = () => reject(new Error("无法读取所选图片"));
        image.src = source;
    });
}

export default function AvatarSetting({ onSave, history, onUseHistory, onDeleteHistory, isDisabled = false, label = "设置头像" }: AvatarSettingProps) {
    const modal = useOverlayState();
    const inputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string>();
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedArea, setCroppedArea] = useState<Area>();
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [historyMenuId, setHistoryMenuId] = useState<string>();

    useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

    function selectFile(file: File) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(file));
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedArea(undefined);
        setError(undefined);
    }

    async function saveAvatar() {
        if (!previewUrl || !croppedArea) return;
        setIsSaving(true);
        try {
            await onSave(await cropImage(previewUrl, croppedArea));
            modal.close();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "头像保存失败");
        } finally {
            setIsSaving(false);
        }
    }

    async function selectHistoryAvatar(avatarId: string) {
        if (!onUseHistory) return;
        setIsSaving(true);
        try {
            await onUseHistory(avatarId);
            modal.close();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "头像切换失败");
        } finally {
            setIsSaving(false);
        }
    }

    async function deleteHistory(avatarId: string) {
        if (!onDeleteHistory) return;
        setIsSaving(true);
        try {
            await onDeleteHistory(avatarId);
            setHistoryMenuId(undefined);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "历史头像删除失败");
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <>
            <Button size="sm" isDisabled={isDisabled} onPress={() => modal.open()}>{label}</Button>
            <Modal state={modal}>
                <Modal.Backdrop className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm">
                    <Modal.Container placement="center" className="z-[61] w-[min(460px,calc(100vw-32px))] max-w-none">
                        <Modal.Dialog>
                            <Modal.Header>
                                <Modal.Heading>设置头像</Modal.Heading>
                                <p className="mt-1 text-sm text-muted">拖拽图片调整位置，使用滑块缩放后保存裁切结果。</p>
                            </Modal.Header>
                            <Modal.Body className="space-y-4">
                                <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) selectFile(file); event.target.value = ""; }} />
                                {previewUrl ? <div className="relative h-72 overflow-hidden bg-black" onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onPointerCancel={(event) => event.stopPropagation()}><Cropper image={previewUrl} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, area) => setCroppedArea(area)} /></div> : <button type="button" className="flex h-72 w-full items-center justify-center border border-dashed border-border bg-overlay text-sm text-muted" onClick={() => inputRef.current?.click()}>选择图片</button>}
                                {previewUrl ? <div className="flex items-center gap-3"><span className="shrink-0 text-sm text-muted">缩放</span><Slider aria-label="头像缩放" className="flex-1" minValue={1} maxValue={3} step={0.01} value={zoom} onChange={(value) => setZoom(Array.isArray(value) ? value[0] ?? 1 : value)}><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider><Button size="sm" variant="ghost" onPress={() => inputRef.current?.click()}>更换</Button></div> : null}
                                <div><p className="mb-2 text-sm text-muted">历史头像</p>{history?.length ? <div className="flex flex-wrap gap-2">{history.map((avatar) => <div key={avatar.id} className="relative"><button type="button" disabled={isSaving} className={`relative h-12 w-12 overflow-hidden border ${avatar.is_current ? "border-accent" : "border-border"}`} onClick={() => { if (!avatar.is_current) void selectHistoryAvatar(avatar.id); }} onContextMenu={(event) => { if (avatar.is_current) return; event.preventDefault(); setHistoryMenuId(avatar.id); }}><NextImage src={avatar.src} alt={avatar.is_current ? "当前头像" : "历史头像"} fill unoptimized className="object-cover" />{avatar.is_current ? <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[10px] text-white">当前</span> : null}</button>{historyMenuId === avatar.id ? <div className="absolute left-0 top-full z-10 mt-1"><Button size="sm" className="text-red-500" isDisabled={isSaving} onPress={() => void deleteHistory(avatar.id)}>删除</Button></div> : null}</div>)}</div> : <p className="text-sm text-muted">暂无历史头像</p>}</div>
                                {error ? <p className="text-sm text-red-500">{error}</p> : null}
                            </Modal.Body>
                            <Modal.Footer className="justify-end gap-2">
                                <Button variant="ghost" isDisabled={isSaving} onPress={() => modal.close()}>取消</Button>
                                <Button isDisabled={!previewUrl || !croppedArea || isSaving} onPress={() => void saveAvatar()}>{isSaving ? <Spinner size="sm" /> : "保存头像"}</Button>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>
        </>
    );
}
