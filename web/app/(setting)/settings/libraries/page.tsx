"use client";

import { Button, Input, Modal, useOverlayState } from "@heroui/react";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
    createMediaLibrary,
    deleteLibraryThumbnails,
    deleteMediaLibrary,
    generateLibraryThumbnails,
    getMediaLibraries,
    getPhotos,
    getPreferences,
    getTasks,
    scanMediaLibrary,
    updateMediaLibrary,
    type LibraryResponse,
    type PhotoAssetResponse,
    type PreferencesResponse,
    type ScanTaskResponse,
    type TaskResponse,
} from "@/src/api/client";
import LibrarieCard from "./components/LibrarieCard";

type CreateFormState = {
    name: string;
    rootPath: string;
    mediaType: "photo";
    thumbnailsEnabled: boolean;
};

type LibrarySettingsFormState = {
    name: string;
    rootPath: string;
    thumbnailsEnabled: boolean;
};

const initialCreateForm: CreateFormState = {
    name: "",
    rootPath: "",
    mediaType: "photo",
    thumbnailsEnabled: true,
};

const initialSettingsForm: LibrarySettingsFormState = {
    name: "",
    rootPath: "",
    thumbnailsEnabled: true,
};

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "object" && error && "message" in error) {
        return String(error.message);
    }

    return "请求失败，请确认 API 服务已启动。";
}

function formatBytes(value: number) {
    if (value < 1024) {
        return `${value} B`;
    }

    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }

    if (value < 1024 * 1024 * 1024) {
        return `${(value / 1024 / 1024).toFixed(1)} MB`;
    }

    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value?: string | null) {
    if (!value) {
        return "暂无";
    }

    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function buildPhotoCoverMap(photos: PhotoAssetResponse[]) {
    const photoMap = new Map<string, PhotoAssetResponse[]>();

    for (const photo of photos) {
        const libraryPhotos = photoMap.get(photo.library_id) ?? [];
        libraryPhotos.push(photo);
        photoMap.set(photo.library_id, libraryPhotos);
    }

    for (const libraryPhotos of photoMap.values()) {
        libraryPhotos.sort((left, right) => {
            const leftTime = left.taken_at ?? left.batch_time;
            const rightTime = right.taken_at ?? right.batch_time;

            return new Date(rightTime).getTime() - new Date(leftTime).getTime();
        });
    }

    return photoMap;
}

export default function MediaLibrariesPage() {
    const createModalState = useOverlayState({});
    const settingsModalState = useOverlayState({});
    const infoModalState = useOverlayState({});
    const deleteModalState = useOverlayState({});
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [photos, setPhotos] = useState<PhotoAssetResponse[]>([]);
    const [preferences, setPreferences] = useState<PreferencesResponse | null>(null);
    const [tasks, setTasks] = useState<TaskResponse[]>([]);
    const [latestScan, setLatestScan] = useState<ScanTaskResponse | null>(null);
    const [createForm, setCreateForm] = useState<CreateFormState>(initialCreateForm);
    const [settingsForm, setSettingsForm] =
        useState<LibrarySettingsFormState>(initialSettingsForm);
    const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
    const [infoLibraryId, setInfoLibraryId] = useState<string | null>(null);
    const [deleteLibraryId, setDeleteLibraryId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [workingLibraryId, setWorkingLibraryId] = useState<string | null>(null);
    const [isSubmitting, startCreateTransition] = useTransition();
    const [isSavingSettings, startSaveSettingsTransition] = useTransition();
    const [isDeletingLibrary, startDeleteTransition] = useTransition();

    const editingLibrary = useMemo(
        () => libraries.find((library) => library.id === editingLibraryId) ?? null,
        [editingLibraryId, libraries],
    );
    const infoLibrary = useMemo(
        () => libraries.find((library) => library.id === infoLibraryId) ?? null,
        [infoLibraryId, libraries],
    );
    const deleteLibraryTarget = useMemo(
        () => libraries.find((library) => library.id === deleteLibraryId) ?? null,
        [deleteLibraryId, libraries],
    );
    const photoCoverMap = useMemo(() => buildPhotoCoverMap(photos), [photos]);
    const photoDisplaySource = preferences?.photo_display_source ?? "thumbnail";
    const activeCacheTaskLibraryIds = useMemo(() => {
        const next = new Set<string>();

        for (const task of tasks) {
            if (
                task.kind === "generate_cache" &&
                task.library_id &&
                (task.status === "queued" || task.status === "running")
            ) {
                next.add(task.library_id);
            }
        }

        return next;
    }, [tasks]);

    async function loadTasksOnly() {
        try {
            const taskData = await getTasks();
            setTasks(taskData);
        } catch {
            // Keep the current task list if polling fails.
        }
    }

    async function loadPageData() {
        try {
            setIsLoading(true);
            setError(null);
            const [libraryData, photoData, preferenceData, taskData] = await Promise.all([
                getMediaLibraries(),
                getPhotos(),
                getPreferences(),
                getTasks(),
            ]);

            setLibraries(libraryData);
            setPhotos(photoData);
            setPreferences(preferenceData);
            setTasks(taskData);
        } catch (loadError) {
            setError(getErrorMessage(loadError));
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void loadPageData();
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            void loadTasksOnly();
        }, 2000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    function updateCreateForm<Key extends keyof CreateFormState>(
        key: Key,
        value: CreateFormState[Key],
    ) {
        setCreateForm((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function updateSettingsForm<Key extends keyof LibrarySettingsFormState>(
        key: Key,
        value: LibrarySettingsFormState[Key],
    ) {
        setSettingsForm((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function openSettingsModal(library: LibraryResponse) {
        setEditingLibraryId(library.id);
        setSettingsForm({
            name: library.name,
            rootPath: library.root_path,
            thumbnailsEnabled: library.thumbnails_enabled,
        });
        settingsModalState.open();
    }

    function openInfoModal(library: LibraryResponse) {
        setInfoLibraryId(library.id);
        infoModalState.open();
    }

    function openDeleteModal(library: LibraryResponse) {
        setDeleteLibraryId(library.id);
        deleteModalState.open();
    }

    function submitLibrary() {
        const name = createForm.name.trim();
        const rootPath = createForm.rootPath.trim();

        if (!name || !rootPath) {
            setError("请填写媒体库名称和本地绝对路径。");
            return;
        }

        startCreateTransition(async () => {
            try {
                setError(null);
                setNotice(null);
                const library = await createMediaLibrary({
                    name,
                    root_path: rootPath,
                    media_type: createForm.mediaType,
                    thumbnails_enabled: createForm.thumbnailsEnabled,
                });
                const scanTask = await scanMediaLibrary({
                    library_id: library.id,
                });

                setLatestScan(scanTask);
                setNotice(
                    createForm.thumbnailsEnabled
                        ? "媒体库已创建，首次扫描完成，后续扫描会自动补齐 Thumb / Preview。"
                        : "媒体库已创建，首次扫描完成；缓存自动生成未开启，可稍后手动生成。",
                );
                setCreateForm(initialCreateForm);
                createModalState.close();
                await loadPageData();
            } catch (submitError) {
                setError(getErrorMessage(submitError));
            }
        });
    }

    async function runLibraryAction(libraryId: string, action: () => Promise<string>) {
        try {
            setWorkingLibraryId(libraryId);
            setError(null);
            setNotice(null);
            const nextNotice = await action();
            setNotice(nextNotice);
            await loadPageData();
        } catch (actionError) {
            setError(getErrorMessage(actionError));
        } finally {
            setWorkingLibraryId(null);
        }
    }

    async function startGenerateTask(library: LibraryResponse) {
        try {
            setWorkingLibraryId(library.id);
            setError(null);
            setNotice(null);
            await generateLibraryThumbnails(library.id);
            setNotice(`已为“${library.name}”创建缓存生成任务，请到任务页查看进度。`);
            await loadPageData();
        } catch (generateError) {
            setError(getErrorMessage(generateError));
        } finally {
            setWorkingLibraryId(null);
        }
    }

    function saveLibrarySettings() {
        if (!editingLibrary) {
            return;
        }

        const name = settingsForm.name.trim();
        const rootPath = settingsForm.rootPath.trim();

        if (!name || !rootPath) {
            setError("媒体库名称和路径不能为空。");
            return;
        }

        startSaveSettingsTransition(async () => {
            try {
                setError(null);
                setNotice(null);
                await updateMediaLibrary(editingLibrary.id, {
                    name,
                    root_path: rootPath,
                    thumbnails_enabled: settingsForm.thumbnailsEnabled,
                });
                settingsModalState.close();
                setNotice("媒体库设置已更新。");
                await loadPageData();
            } catch (saveError) {
                setError(getErrorMessage(saveError));
            }
        });
    }

    function confirmDeleteLibrary() {
        if (!deleteLibraryTarget) {
            return;
        }

        startDeleteTransition(async () => {
            try {
                setError(null);
                setNotice(null);
                await deleteMediaLibrary(deleteLibraryTarget.id);
                deleteModalState.close();
                setDeleteLibraryId(null);
                setInfoLibraryId((current) =>
                    current === deleteLibraryTarget.id ? null : current,
                );
                setEditingLibraryId((current) =>
                    current === deleteLibraryTarget.id ? null : current,
                );
                setNotice(`媒体库“${deleteLibraryTarget.name}”已删除。`);
                await loadPageData();
            } catch (deleteError) {
                setError(getErrorMessage(deleteError));
            }
        });
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                        媒体库
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-950">媒体库管理</h2>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
                        管理本地媒体目录，支持重新扫描、手动生成缓存、修改路径与名称。
                        资源信息和缓存占用统一放在“更多 - 信息”中查看，生成进度统一在任务页跟踪。
                    </p>
                </div>
                <Button
                    className="rounded-2xl bg-slate-950 px-5 text-white hover:bg-slate-800"
                    onPress={createModalState.open}
                >
                    新建媒体库
                </Button>
            </div>

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

            {latestScan ? (
                <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                    最近一次扫描完成：发现 {latestScan.discovered_files} 个文件，新增{" "}
                    {latestScan.inserted_items} 个条目，更新 {latestScan.updated_files} 个文件。
                </div>
            ) : null}

            <div className="mt-6 min-h-0 flex-1 overflow-auto">
                {libraries.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 text-sm text-slate-500">
                        {isLoading ? "正在加载媒体库..." : "暂时还没有媒体库。"}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                        {libraries.map((library) => {
                            const hasActiveCacheTask = activeCacheTaskLibraryIds.has(library.id);
                            const libraryBusy = workingLibraryId === library.id;

                            return (
                                <LibrarieCard
                                    key={library.id}
                                    library={library}
                                    coverPhotos={photoCoverMap.get(library.id)}
                                    photoDisplaySource={photoDisplaySource}
                                    hasActiveCacheTask={hasActiveCacheTask}
                                    isBusy={libraryBusy}
                                    onRescan={() =>
                                        runLibraryAction(library.id, async () => {
                                            const scanTask = await scanMediaLibrary({
                                                library_id: library.id,
                                            });
                                            setLatestScan(scanTask);

                                            return `媒体库“${library.name}”重新扫描完成：发现 ${scanTask.discovered_files} 个文件，新增 ${scanTask.inserted_items} 个条目，更新 ${scanTask.updated_files} 个文件。`;
                                        })
                                    }
                                    onGenerateThumbnails={() => void startGenerateTask(library)}
                                    onDeleteThumbnails={() =>
                                        runLibraryAction(library.id, async () => {
                                            const result = await deleteLibraryThumbnails(library.id);

                                            return `已删除 ${result.deleted_thumbnails} 个 Thumb、${result.deleted_previews} 个 Preview，回收 ${formatBytes(result.reclaimed_bytes)}。`;
                                        })
                                    }
                                    onOpenSettings={() => openSettingsModal(library)}
                                    onOpenInfo={() => openInfoModal(library)}
                                    onToggleEnabled={() =>
                                        runLibraryAction(library.id, async () => {
                                            const nextLibrary = await updateMediaLibrary(
                                                library.id,
                                                {
                                                    enabled: !library.enabled,
                                                },
                                            );

                                            return nextLibrary.enabled
                                                ? `媒体库“${nextLibrary.name}”已启用。`
                                                : `媒体库“${nextLibrary.name}”已停用。`;
                                        })
                                    }
                                    onDeleteLibrary={() => openDeleteModal(library)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            <Modal state={createModalState}>
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
                                    新建媒体库
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-slate-500">
                                    照片媒体库生成后的 `thumb` 与 `preview` 会保存到
                                    `api/data/thumb` 和 `api/data/preview`。
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-4 px-6 py-5">
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        媒体库名称
                                    </span>
                                    <Input
                                        value={createForm.name}
                                        placeholder="例如：家庭照片"
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                                        onChange={(event) =>
                                            updateCreateForm("name", event.target.value)
                                        }
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        本地绝对路径
                                    </span>
                                    <Input
                                        value={createForm.rootPath}
                                        placeholder="例如：D:\\Media\\Photos"
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                                        onChange={(event) =>
                                            updateCreateForm("rootPath", event.target.value)
                                        }
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        媒体类型
                                    </span>
                                    <select
                                        value={createForm.mediaType}
                                        className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                                        onChange={(event) =>
                                            updateCreateForm(
                                                "mediaType",
                                                event.target.value as "photo",
                                            )
                                        }
                                    >
                                        <option value="photo">照片 photo</option>
                                    </select>
                                </label>
                                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={createForm.thumbnailsEnabled}
                                        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                                        onChange={(event) =>
                                            updateCreateForm(
                                                "thumbnailsEnabled",
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    <span className="text-sm leading-6 text-slate-700">
                                        开启后，该媒体库每次扫描完成都会自动补齐 `thumb` / `preview`
                                        缓存。
                                    </span>
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
                                    {isSubmitting ? "创建中..." : "创建并扫描"}
                                </Button>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>

            <Modal state={settingsModalState}>
                <Modal.Backdrop
                    isDismissable
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
                >
                    <Modal.Container
                        placement="center"
                        className="w-[min(620px,calc(100vw-32px))] rounded-3xl border border-white/70 bg-white p-0 shadow-2xl"
                    >
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-slate-100 px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-slate-950">
                                    媒体库设置
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-slate-500">
                                    修改媒体库名称、路径和扫描后自动补齐缓存的行为。
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-4 px-6 py-5">
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        媒体库名称
                                    </span>
                                    <Input
                                        value={settingsForm.name}
                                        placeholder="请输入媒体库名称"
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                                        onChange={(event) =>
                                            updateSettingsForm("name", event.target.value)
                                        }
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">
                                        本地绝对路径
                                    </span>
                                    <Input
                                        value={settingsForm.rootPath}
                                        placeholder="请输入媒体库路径"
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                                        onChange={(event) =>
                                            updateSettingsForm("rootPath", event.target.value)
                                        }
                                    />
                                </label>
                                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={settingsForm.thumbnailsEnabled}
                                        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                                        onChange={(event) =>
                                            updateSettingsForm(
                                                "thumbnailsEnabled",
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    <span className="text-sm leading-6 text-slate-700">
                                        每次扫描完成后，自动为该媒体库补齐 `thumb` / `preview`
                                        缓存。
                                    </span>
                                </label>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">
                                    取消
                                </Modal.CloseTrigger>
                                <Button
                                    className="rounded-2xl bg-slate-950 px-5 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    isDisabled={isSavingSettings || !editingLibrary}
                                    onPress={saveLibrarySettings}
                                >
                                    {isSavingSettings ? "保存中..." : "保存设置"}
                                </Button>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>

            <Modal state={infoModalState}>
                <Modal.Backdrop
                    isDismissable
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
                >
                    <Modal.Container
                        placement="center"
                        className="w-[min(620px,calc(100vw-32px))] rounded-3xl border border-white/70 bg-white p-0 shadow-2xl"
                    >
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-slate-100 px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-slate-950">
                                    媒体库信息
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-slate-500">
                                    {infoLibrary ? infoLibrary.name : "当前媒体库"}
                                </p>
                            </Modal.Header>
                            <Modal.Body className="px-6 py-5">
                                {infoLibrary ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                            <p className="text-xs font-medium text-slate-500">
                                                资源总数
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-slate-950">
                                                {infoLibrary.thumbnail_status.total_assets}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                            <p className="text-xs font-medium text-slate-500">
                                                缓存待生成
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-slate-950">
                                                {infoLibrary.thumbnail_status.pending_assets}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                            <p className="text-xs font-medium text-slate-500">
                                                Thumb 占用
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-slate-950">
                                                {formatBytes(
                                                    infoLibrary.thumbnail_status.thumb_total_bytes,
                                                )}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                            <p className="text-xs font-medium text-slate-500">
                                                Preview 占用
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-slate-950">
                                                {formatBytes(
                                                    infoLibrary.thumbnail_status.preview_total_bytes,
                                                )}
                                            </p>
                                        </div>
                                        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
                                            <div className="flex items-center justify-between gap-3 text-sm">
                                                <span className="text-slate-500">Thumb 就绪</span>
                                                <span className="font-medium text-slate-900">
                                                    {infoLibrary.thumbnail_status.thumb_ready_assets}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-slate-500">Preview 就绪</span>
                                                <span className="font-medium text-slate-900">
                                                    {
                                                        infoLibrary.thumbnail_status
                                                            .preview_ready_assets
                                                    }
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-slate-500">最近生成时间</span>
                                                <span className="font-medium text-slate-900">
                                                    {formatDate(
                                                        infoLibrary.thumbnail_status
                                                            .last_generated_at,
                                                    )}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-slate-500">媒体库状态</span>
                                                <span className="font-medium text-slate-900">
                                                    {infoLibrary.enabled ? "已启用" : "已停用"}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-slate-500">创建时间</span>
                                                <span className="font-medium text-slate-900">
                                                    {formatDate(infoLibrary.created_at)}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-slate-500">更新时间</span>
                                                <span className="font-medium text-slate-900">
                                                    {formatDate(infoLibrary.updated_at)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                                        当前媒体库信息不可用。
                                    </div>
                                )}
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">
                                    关闭
                                </Modal.CloseTrigger>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>

            <Modal state={deleteModalState}>
                <Modal.Backdrop
                    isDismissable
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
                >
                    <Modal.Container
                        placement="center"
                        className="w-[min(520px,calc(100vw-32px))] rounded-3xl border border-white/70 bg-white p-0 shadow-2xl"
                    >
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-slate-100 px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-slate-950">
                                    删除媒体库
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-slate-500">
                                    {deleteLibraryTarget
                                        ? `即将删除“${deleteLibraryTarget.name}”的扫描索引与缓存。`
                                        : "即将删除当前媒体库。"}
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                                <p>
                                    删除后会移除媒体库记录、扫描结果，以及 `api/data/thumb` / `api/data/preview`
                                    下对应缓存。
                                </p>
                                <p className="font-medium text-slate-900">
                                    不会删除你原始目录中的照片文件。
                                </p>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">
                                    取消
                                </Modal.CloseTrigger>
                                <Button
                                    className="rounded-2xl bg-red-600 px-5 text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                                    isDisabled={isDeletingLibrary || !deleteLibraryTarget}
                                    onPress={confirmDeleteLibrary}
                                >
                                    {isDeletingLibrary ? "删除中..." : "确认删除"}
                                </Button>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>
        </div>
    );
}
