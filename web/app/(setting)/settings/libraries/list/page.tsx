"use client";

import {
    Camera,
    ChevronDown,
    CloudGear,
    Filmstrip,
    Folder,
    MusicNote,
    Picture,
    Puzzle,
} from "@gravity-ui/icons";
import {
    Button,
    Input,
    ListBox,
    Modal,
    Select,
    Switch,
    TextField,
    useOverlayState,
} from "@heroui/react";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { ComponentType, SVGProps } from "react";
import {
    createMediaLibrary,
    deleteLibraryThumbnails,
    deleteMediaLibrary,
    generateLibraryThumbnails,
    getMediaLibraries,
    getPhotos,
    getTasks,
    scanMediaLibrary,
    updateMediaLibrary,
    type LibraryResponse,
    type MediaType,
    type PhotoAssetResponse,
    type ScanTaskResponse,
    type TaskResponse,
} from "@/src/api/client";
import LibrarieCard from "../components/LibrarieCard";

type LibrarySource = "local" | "webdav";

type CreateFormState = {
    name: string;
    sourceType: LibrarySource;
    rootPath: string;
    webdavServerId: string;
    webdavPath: string;
    mediaType: MediaType;
    thumbnailsEnabled: boolean;
};

type LibrarySettingsFormState = {
    name: string;
    rootPath: string;
    thumbnailsEnabled: boolean;
};

type SelectOption<T extends string> = {
    value: T;
    label: string;
    description?: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const fieldLabelClass =
    "mb-2 block text-sm font-medium text-[var(--theme-text-secondary)]";
const fieldTextClass =
    "w-full rounded-2xl border border-[var(--theme-border)] bg-white/12 px-4 py-3 text-sm text-[var(--theme-text-primary)] outline-none transition focus:border-[var(--theme-text-secondary)] focus:bg-white/16 [&_input]:text-[var(--theme-text-primary)] [&_input]:placeholder:text-[var(--theme-text-muted)]";
const selectTriggerClass =
    "flex h-12 w-full items-center justify-between rounded-2xl border border-[var(--theme-border)] bg-white/12 px-4 text-sm text-[var(--theme-text-primary)] outline-none transition hover:bg-white/14 focus:border-[var(--theme-text-secondary)]";
const modalSurfaceClass =
    "w-[min(620px,calc(100vw-32px))] rounded-3xl border border-[var(--theme-border-heavy)] bg-[var(--theme-bg-overlay-heavy)] p-0 text-[var(--theme-text-primary)] shadow-2xl backdrop-blur-2xl";
const settingPanelClass =
    "rounded-3xl border border-[var(--theme-border)] bg-white/8 p-4";

const mediaTypeOptions: SelectOption<MediaType>[] = [
    { value: "photo", label: "照片", description: "相册、摄影、图库", icon: Picture },
    { value: "game", label: "游戏", description: "主机、PC、掌机资源", icon: Puzzle },
    { value: "manga", label: "漫画", description: "单行本、图像章节", icon: Camera },
    { value: "anime", label: "动漫", description: "动画资源与剧场版", icon: Filmstrip },
    { value: "movie", label: "视频", description: "电影、录播、长视频", icon: Filmstrip },
    { value: "series", label: "剧集", description: "电视剧、连续剧集", icon: Filmstrip },
    { value: "music", label: "音乐", description: "专辑、单曲、音轨", icon: MusicNote },
    { value: "novel", label: "小说", description: "电子书与文本资源", icon: Folder },
    { value: "other", label: "其他", description: "暂未单独分类的资源", icon: Folder },
];

const sourceTypeOptions: SelectOption<LibrarySource>[] = [
    { value: "local", label: "Local", description: "读取本地目录", icon: Folder },
    { value: "webdav", label: "WebDAV", description: "连接远程 WebDAV 目录", icon: CloudGear },
];

const mockWebdavOptions: SelectOption<string>[] = [
    { value: "dav-home", label: "家庭 NAS", description: "测试数据", icon: CloudGear },
    { value: "dav-backup", label: "异地备份", description: "测试数据", icon: CloudGear },
];

const initialCreateForm: CreateFormState = {
    name: "",
    sourceType: "local",
    rootPath: "",
    webdavServerId: mockWebdavOptions[0].value,
    webdavPath: "",
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

function getLibrarySourceLabel() {
    return "Local";
}

function SelectField<T extends string>({
    label,
    selectedKey,
    options,
    onSelectionChange,
}: {
    label: string;
    selectedKey: T;
    options: SelectOption<T>[];
    onSelectionChange: (value: T) => void;
}) {
    return (
        <label className="block">
            <span className={fieldLabelClass}>{label}</span>
            <Select.Root
                selectedKey={selectedKey}
                onSelectionChange={(key) => {
                    if (key !== null && key !== undefined) {
                        onSelectionChange(String(key) as T);
                    }
                }}
            >
                <Select.Trigger className={selectTriggerClass}>
                    <Select.Value className="min-w-0 truncate text-left text-[var(--theme-text-primary)]" />
                    <Select.Indicator>
                        <ChevronDown className="h-4 w-4 text-[var(--theme-text-secondary)]" />
                    </Select.Indicator>
                </Select.Trigger>
                <Select.Popover className="max-h-[min(320px,calc(100vh-96px))] overflow-hidden rounded-2xl border border-[var(--theme-border-heavy)] bg-[var(--theme-bg-card)] p-1 text-[var(--theme-text-primary)] shadow-2xl backdrop-blur-xl">
                    <ListBox className="max-h-[min(312px,calc(100vh-104px))] overflow-y-auto outline-none pr-1">
                        {options.map((item) => (
                            <ListBox.Item
                                key={item.value}
                                id={item.value}
                                textValue={item.label}
                                className="rounded-2xl px-3 py-3 text-[var(--theme-text-primary)] outline-none transition data-[focused]:bg-white/10 data-[hovered]:bg-white/8"
                            >
                                <div className="flex items-center gap-3">
                                    <item.icon className="h-4 w-4 shrink-0 text-[var(--theme-text-secondary)]" />
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium">{item.label}</div>
                                        {item.description ? (
                                            <div className="mt-1 text-xs text-[var(--theme-text-secondary)]">
                                                {item.description}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </ListBox.Item>
                        ))}
                    </ListBox>
                </Select.Popover>
            </Select.Root>
        </label>
    );
}

function TextInputField({
    label,
    value,
    placeholder,
    onChange,
}: {
    label: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className={fieldLabelClass}>{label}</span>
            <TextField.Root value={value} onChange={onChange}>
                <Input placeholder={placeholder} className={fieldTextClass} />
            </TextField.Root>
        </label>
    );
}

function CacheSetting({
    value,
    onChange,
    description,
}: {
    value: boolean;
    onChange: (value: boolean) => void;
    description: string;
}) {
    return (
        <div className={settingPanelClass}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
                        生成图片缓存
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--theme-text-secondary)]">
                        {description}
                    </p>
                </div>
                <Switch
                    isSelected={value}
                    onChange={onChange}
                    className="shrink-0"
                >
                    自动生成
                </Switch>
            </div>
        </div>
    );
}

export default function MediaLibrariesPage() {
    const createModalState = useOverlayState({});
    const settingsModalState = useOverlayState({});
    const infoModalState = useOverlayState({});
    const deleteModalState = useOverlayState({});
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [photos, setPhotos] = useState<PhotoAssetResponse[]>([]);
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
    const activeCacheTaskLibraryIds = useMemo(() => {
        const next = new Set<string>();

        for (const task of tasks) {
            if (
                task.kind === "generate_cache" &&
                task.library_id &&
                (task.status === "queued" || task.status === "running" || task.status === "paused")
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
            const [libraryData, photoData, taskData] = await Promise.all([
                getMediaLibraries(),
                getPhotos({ limit: 200 }),
                getTasks(),
            ]);

            setLibraries(libraryData);
            setPhotos(photoData);
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

        if (!name) {
            setError("请填写媒体库名称。");
            return;
        }

        if (createForm.sourceType === "local" && !rootPath) {
            setError("选择 Local 时必须填写本地绝对路径。");
            return;
        }

        if (createForm.sourceType === "webdav") {
            setError("WebDAV 媒体源当前仅提供占位选项，尚未接入创建接口。");
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
                        ? "媒体库已创建，首次扫描任务已启动，后续扫描会自动补齐 Thumb / Preview。"
                        : "媒体库已创建，首次扫描任务已启动；缓存自动生成未开启，可稍后手动生成。",
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
        <div className="flex h-full min-h-0 flex-col text-[var(--theme-text-primary)]">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--theme-text-muted)]">
                        媒体库
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
                        媒体库列表
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-text-secondary)]">
                        管理本地媒体目录，支持重新扫描、手动生成缓存、修改路径与名称。
                        资源信息和缓存占用统一放在“更多 - 信息”中查看，生成进度统一在任务页跟踪。
                    </p>
                </div>
                <Button
                    className="rounded-2xl bg-[var(--theme-text-primary)] px-5 text-[var(--theme-bg-card)] hover:opacity-90"
                    onPress={createModalState.open}
                >
                    新建媒体库
                </Button>
            </div>

            {error ? (
                <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/12 px-4 py-3 text-sm text-red-100 dark:text-red-200">
                    {error}
                </div>
            ) : null}

            {notice ? (
                <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-50 dark:text-emerald-100">
                    {notice}
                </div>
            ) : null}

            {latestScan ? (
                <div className="mt-5 rounded-2xl border border-sky-400/25 bg-sky-500/12 px-4 py-3 text-sm text-sky-50 dark:text-sky-100">
                    最近一次扫描任务已启动：当前状态 {latestScan.status}，已处理{" "}
                    {latestScan.processed_files} / {latestScan.discovered_files}。
                </div>
            ) : null}

            <div className="mt-6 min-h-0 flex-1 overflow-auto">
                {libraries.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-[var(--theme-border)] bg-white/6 text-sm text-[var(--theme-text-secondary)]">
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
                                    hasActiveCacheTask={hasActiveCacheTask}
                                    isBusy={libraryBusy}
                                    onRescan={() =>
                                        runLibraryAction(library.id, async () => {
                                            const scanTask = await scanMediaLibrary({
                                                library_id: library.id,
                                            });
                                            setLatestScan(scanTask);

                                            return `媒体库“${library.name}”重新扫描任务已启动，请到任务页查看进度。`;
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
                    <Modal.Container placement="center" className={modalSurfaceClass}>
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-[var(--theme-border)] px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-[var(--theme-text-primary)]">
                                    新建媒体库
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">
                                    先选择媒体源与媒体类型。当前只有 Local 会真正调用创建接口；
                                    WebDAV 先展示交互与占位数据。
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-5 px-6 py-5">
                                <TextInputField
                                    label="媒体库名称"
                                    value={createForm.name}
                                    placeholder="例如：家庭照片"
                                    onChange={(value) => updateCreateForm("name", value)}
                                />

                                <div className="grid gap-4 md:grid-cols-2">
                                    <SelectField
                                        label="媒体源"
                                        selectedKey={createForm.sourceType}
                                        options={sourceTypeOptions}
                                        onSelectionChange={(value) =>
                                            updateCreateForm("sourceType", value)
                                        }
                                    />
                                    <SelectField
                                        label="媒体类型"
                                        selectedKey={createForm.mediaType}
                                        options={mediaTypeOptions}
                                        onSelectionChange={(value) =>
                                            updateCreateForm("mediaType", value)
                                        }
                                    />
                                </div>

                                {createForm.sourceType === "local" ? (
                                    <TextInputField
                                        label="本地绝对路径"
                                        value={createForm.rootPath}
                                        placeholder="例如：D:\\Media\\Photos"
                                        onChange={(value) => updateCreateForm("rootPath", value)}
                                    />
                                ) : (
                                    <div className="space-y-4">
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <SelectField
                                                label="WebDAV 连接"
                                                selectedKey={createForm.webdavServerId}
                                                options={mockWebdavOptions}
                                                onSelectionChange={(value) =>
                                                    updateCreateForm("webdavServerId", value)
                                                }
                                            />
                                            <TextInputField
                                                label="WebDAV 路径"
                                                value={createForm.webdavPath}
                                                placeholder="例如：/media/photos"
                                                onChange={(value) =>
                                                    updateCreateForm("webdavPath", value)
                                                }
                                            />
                                        </div>
                                        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/12 px-4 py-3 text-sm text-amber-50 dark:text-amber-100">
                                            当前为测试数据，仅展示下拉单选，不会写入真实 WebDAV 媒体库。
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <p className={fieldLabelClass}>媒体库设置</p>
                                    <CacheSetting
                                        value={createForm.thumbnailsEnabled}
                                        onChange={(value) =>
                                            updateCreateForm("thumbnailsEnabled", value)
                                        }
                                        description="开启后，该媒体库每次扫描完成都会自动补齐 thumb 和 preview 缓存。"
                                    />
                                </div>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--theme-border)] px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-[var(--theme-text-secondary)] transition hover:bg-white/10">
                                    取消
                                </Modal.CloseTrigger>
                                <Button
                                    className="rounded-2xl bg-[var(--theme-text-primary)] px-5 text-[var(--theme-bg-card)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                    <Modal.Container placement="center" className={modalSurfaceClass}>
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-[var(--theme-border)] px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-[var(--theme-text-primary)]">
                                    媒体库设置
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">
                                    修改媒体库名称、路径和缓存生成策略。
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-5 px-6 py-5">
                                <TextInputField
                                    label="媒体库名称"
                                    value={settingsForm.name}
                                    placeholder="请输入媒体库名称"
                                    onChange={(value) => updateSettingsForm("name", value)}
                                />
                                <TextInputField
                                    label="本地绝对路径"
                                    value={settingsForm.rootPath}
                                    placeholder="请输入媒体库路径"
                                    onChange={(value) => updateSettingsForm("rootPath", value)}
                                />
                                <div className="space-y-3">
                                    <p className={fieldLabelClass}>媒体库设置</p>
                                    <CacheSetting
                                        value={settingsForm.thumbnailsEnabled}
                                        onChange={(value) =>
                                            updateSettingsForm("thumbnailsEnabled", value)
                                        }
                                        description="每次扫描完成后，自动为该媒体库补齐 thumb 和 preview 缓存。"
                                    />
                                </div>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--theme-border)] px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-[var(--theme-text-secondary)] transition hover:bg-white/10">
                                    取消
                                </Modal.CloseTrigger>
                                <Button
                                    className="rounded-2xl bg-[var(--theme-text-primary)] px-5 text-[var(--theme-bg-card)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                    <Modal.Container placement="center" className={modalSurfaceClass}>
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-[var(--theme-border)] px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-[var(--theme-text-primary)]">
                                    媒体库信息
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">
                                    {infoLibrary ? infoLibrary.name : "当前媒体库"}
                                </p>
                            </Modal.Header>
                            <Modal.Body className="px-6 py-5">
                                {infoLibrary ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl border border-[var(--theme-border)] bg-white/8 p-4">
                                            <p className="text-xs font-medium text-[var(--theme-text-secondary)]">
                                                资源总数
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-[var(--theme-text-primary)]">
                                                {infoLibrary.thumbnail_status.total_assets}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-[var(--theme-border)] bg-white/8 p-4">
                                            <p className="text-xs font-medium text-[var(--theme-text-secondary)]">
                                                缓存待生成
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-[var(--theme-text-primary)]">
                                                {infoLibrary.thumbnail_status.pending_assets}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-[var(--theme-border)] bg-white/8 p-4">
                                            <p className="text-xs font-medium text-[var(--theme-text-secondary)]">
                                                Thumb 占用
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-[var(--theme-text-primary)]">
                                                {formatBytes(
                                                    infoLibrary.thumbnail_status.thumb_total_bytes,
                                                )}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-[var(--theme-border)] bg-white/8 p-4">
                                            <p className="text-xs font-medium text-[var(--theme-text-secondary)]">
                                                Preview 占用
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-[var(--theme-text-primary)]">
                                                {formatBytes(
                                                    infoLibrary.thumbnail_status.preview_total_bytes,
                                                )}
                                            </p>
                                        </div>
                                        <div className="col-span-2 rounded-2xl border border-[var(--theme-border)] bg-white/6 p-4">
                                            <div className="flex items-center justify-between gap-3 text-sm">
                                                <span className="text-[var(--theme-text-secondary)]">
                                                    Thumb 就绪
                                                </span>
                                                <span className="font-medium text-[var(--theme-text-primary)]">
                                                    {infoLibrary.thumbnail_status.thumb_ready_assets}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-[var(--theme-text-secondary)]">
                                                    Preview 就绪
                                                </span>
                                                <span className="font-medium text-[var(--theme-text-primary)]">
                                                    {infoLibrary.thumbnail_status.preview_ready_assets}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-[var(--theme-text-secondary)]">
                                                    最近生成时间
                                                </span>
                                                <span className="font-medium text-[var(--theme-text-primary)]">
                                                    {formatDate(
                                                        infoLibrary.thumbnail_status
                                                            .last_generated_at,
                                                    )}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-[var(--theme-text-secondary)]">
                                                    媒体源类型
                                                </span>
                                                <span className="font-medium text-[var(--theme-text-primary)]">
                                                    {getLibrarySourceLabel()}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-[var(--theme-text-secondary)]">
                                                    媒体库状态
                                                </span>
                                                <span className="font-medium text-[var(--theme-text-primary)]">
                                                    {infoLibrary.enabled ? "已启用" : "已停用"}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-[var(--theme-text-secondary)]">
                                                    创建时间
                                                </span>
                                                <span className="font-medium text-[var(--theme-text-primary)]">
                                                    {formatDate(infoLibrary.created_at)}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-[var(--theme-text-secondary)]">
                                                    更新时间
                                                </span>
                                                <span className="font-medium text-[var(--theme-text-primary)]">
                                                    {formatDate(infoLibrary.updated_at)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-[var(--theme-border)] bg-white/6 px-4 py-10 text-center text-sm text-[var(--theme-text-secondary)]">
                                        当前媒体库信息不可用。
                                    </div>
                                )}
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--theme-border)] px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-[var(--theme-text-secondary)] transition hover:bg-white/10">
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
                        className="w-[min(520px,calc(100vw-32px))] rounded-3xl border border-[var(--theme-border-heavy)] bg-[var(--theme-bg-overlay-heavy)] p-0 text-[var(--theme-text-primary)] shadow-2xl backdrop-blur-2xl"
                    >
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-[var(--theme-border)] px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-[var(--theme-text-primary)]">
                                    删除媒体库
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">
                                    {deleteLibraryTarget
                                        ? `即将删除“${deleteLibraryTarget.name}”的扫描索引与缓存。`
                                        : "即将删除当前媒体库。"}
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-3 px-6 py-5 text-sm leading-6 text-[var(--theme-text-secondary)]">
                                <p>
                                    删除后会移除媒体库记录、扫描结果，以及 `api/data/thumb` /
                                    `api/data/preview` 下对应缓存。
                                </p>
                                <p className="font-medium text-[var(--theme-text-primary)]">
                                    不会删除你原始目录中的照片文件。
                                </p>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--theme-border)] px-6 py-5">
                                <Modal.CloseTrigger className="rounded-2xl px-4 py-2 text-sm font-medium text-[var(--theme-text-secondary)] transition hover:bg-white/10">
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
