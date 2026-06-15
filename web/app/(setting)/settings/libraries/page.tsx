"use client";

import { Button, Input, Modal, useOverlayState } from "@heroui/react";
import { useEffect, useState, useTransition } from "react";
import {
    createMediaLibrary,
    getMediaLibraries,
    scanMediaLibrary,
    type LibraryResponse,
    type ScanTaskResponse,
} from "@/src/api/client";

type FormState = {
    name: string;
    rootPath: string;
    mediaType: "photo";
};

const initialFormState: FormState = {
    name: "",
    rootPath: "",
    mediaType: "photo",
};

function formatDate(value: string) {
    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "object" && error && "message" in error) {
        return String(error.message);
    }

    return "请求失败，请确认 API 服务已启动";
}

export default function MediaLibrariesPage() {
    const modalState = useOverlayState();
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [latestScan, setLatestScan] = useState<ScanTaskResponse | null>(null);
    const [form, setForm] = useState<FormState>(initialFormState);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, startLoadingTransition] = useTransition();
    const [isSubmitting, startSubmitTransition] = useTransition();

    function loadLibraries() {
        startLoadingTransition(async () => {
            try {
                setError(null);
                const data = await getMediaLibraries();
                setLibraries(data);
            } catch (loadError) {
                setError(getErrorMessage(loadError));
            }
        });
    }

    useEffect(() => {
        loadLibraries();
    }, []);

    function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
        setForm((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function submitLibrary() {
        const name = form.name.trim();
        const rootPath = form.rootPath.trim();

        if (!name || !rootPath) {
            setError("请填写媒体库名称和本地绝对路径");
            return;
        }

        startSubmitTransition(async () => {
            try {
                setError(null);
                const library = await createMediaLibrary({
                    name,
                    root_path: rootPath,
                    media_type: form.mediaType,
                });
                const scanTask = await scanMediaLibrary({
                    library_id: library.id,
                });

                setLatestScan(scanTask);
                setForm(initialFormState);
                modalState.close();
                const data = await getMediaLibraries();
                setLibraries(data);
            } catch (submitError) {
                setError(getErrorMessage(submitError));
            }
        });
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                        Media Libraries
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-950">媒体库</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                        添加本地媒体目录后会立即创建媒体库记录，并触发一次扫码写入数据库。
                    </p>
                </div>
                <Button
                    className="rounded-2xl bg-slate-950 px-5 text-white hover:bg-slate-800"
                    onPress={modalState.open}
                >
                    新增媒体库
                </Button>
            </div>

            {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            ) : null}

            {latestScan ? (
                <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                    最近扫码完成：发现 {latestScan.discovered_files} 个文件，新增{" "}
                    {latestScan.inserted_items} 个条目，更新 {latestScan.updated_files} 个文件。
                </div>
            ) : null}

            <div className="mt-6 min-h-0 flex-1 overflow-auto">
                {libraries.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 text-sm text-slate-500">
                        {isLoading ? "正在读取媒体库..." : "还没有媒体库，点击右上角新增。"}
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {libraries.map((library) => (
                            <article
                                key={library.id}
                                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-3">
                                            <h3 className="truncate text-base font-semibold text-slate-950">
                                                {library.name}
                                            </h3>
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                                {library.media_type}
                                            </span>
                                        </div>
                                        <p className="mt-2 break-all text-sm text-slate-500">
                                            {library.root_path}
                                        </p>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                                        {library.enabled ? "启用" : "停用"}
                                    </span>
                                </div>
                                <p className="mt-4 text-xs text-slate-400">
                                    创建于 {formatDate(library.created_at)}
                                </p>
                            </article>
                        ))}
                    </div>
                )}
            </div>

            <Modal state={modalState}>
                <Modal.Backdrop
                    isDismissable
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
                >
                    <Modal.Container
                        placement="center"
                        className="w-[min(560px,calc(100vw-32px))] rounded-3xl border border-white/70 bg-white p-0 shadow-2xl"
                    >
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-slate-100 px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-slate-950">
                                    新增媒体库
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-slate-500">
                                    当前只开放照片类型，提交后会立即触发一次扫码。
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-4 px-6 py-5">
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        媒体库名称
                                    </span>
                                    <Input
                                        value={form.name}
                                        placeholder="例如：家庭照片"
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                                        onChange={(event) => updateForm("name", event.target.value)}
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        本地绝对路径
                                    </span>
                                    <Input
                                        value={form.rootPath}
                                        placeholder="例如：D:\\Media\\Photos"
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                                        onChange={(event) => updateForm("rootPath", event.target.value)}
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        媒体库类型
                                    </span>
                                    <select
                                        value={form.mediaType}
                                        className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                                        onChange={(event) =>
                                            updateForm("mediaType", event.target.value as "photo")
                                        }
                                    >
                                        <option value="photo">照片 photo</option>
                                    </select>
                                </label>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">
                                    取消
                                </Modal.CloseTrigger>
                                <Button
                                    className="rounded-2xl bg-slate-950 px-5 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    isDisabled={isSubmitting}
                                    onPress={submitLibrary}
                                >
                                    {isSubmitting ? "写入并扫码中..." : "写入并扫码"}
                                </Button>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>
        </div>
    );
}
