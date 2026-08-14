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
    Xmark,
} from "@gravity-ui/icons";
import {
    Autocomplete,
    Button,
    EmptyState,
    Input,
    ListBox,
    Modal,
    SearchField,
    Select,
    Switch,
    Tag,
    TagGroup,
    TextField,
    toast,
    useFilter,
    useOverlayState,
} from "@heroui/react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Key } from "@heroui/react";
import type { ComponentType, SVGProps } from "react";
import {
    createMediaLibrary,
    deleteLibraryPreviews,
    deleteVideoCovers,
    deleteMediaLibrary,
    generateVideoCovers,
    generateLibraryPreviews,
    startVideoAnalysis,
    getMediaLibraries,
    getLibraryCovers,
    getMangaSeries,
    getTasks,
    getVideoCatalog,
    getWebdavConnections,
    scanMediaLibrary,
    updateMediaLibrary,
    type LibraryResponse,
    type MediaType,
    type MangaSeriesResponse,
    type PhotoAssetResponse,
    type TaskResponse,
    type VideoAssetResponse,
    type WebdavConnectionResponse,
} from "@/src/api/client";
import LibrarieCard from "../components/LibrarieCard";
import LibraryScanSettingsDialog from "../components/LibraryScanSettingsDialog";
import SettingsPage from "../../components/SettingsPage";

type LibrarySource = "local" | "webdav";

type CreateFormState = {
    name: string;
    sourceType: LibrarySource;
    rootPath: string;
    webdavServerId: string;
    webdavPath: string;
    mediaType: MediaType;
    scanExtensions: string[];
    collectionsEnabled: boolean;
    collectionType: "normal" | "difference";
    previewsEnabled: boolean;
};

type LibrarySettingsFormState = {
    name: string;
    sourceType: LibrarySource;
    rootPath: string;
    webdavConnectionId: string;
    previewsEnabled: boolean;
};

type SelectOption<T extends string> = {
    value: T;
    label: string;
    description?: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const fieldLabelClass =
    "mb-2 block text-sm font-medium text-muted";
const fieldTextClass =
    "w-full rounded-field border border-border bg-field px-4 py-3 text-sm text-field-foreground outline-none transition focus:border-focus [&_input]:text-field-foreground [&_input]:placeholder:text-muted";
const selectTriggerClass =
    "flex h-12 w-full items-center justify-between rounded-field border border-border bg-field px-4 text-sm text-field-foreground outline-none transition focus:border-focus";
const modalSurfaceClass =
    "w-[min(760px,calc(100vw-32px))] p-0";
const settingPanelClass =
    "rounded-3xl border border-border bg-white/8 p-4";
const createSectionClass =
    "space-y-4 border-b border-border pb-6 last:border-b-0 last:pb-0";

const mediaTypeOptions: SelectOption<MediaType>[] = [
    { value: "photo", label: "照片", description: "相册、摄影、图库", icon: Picture },
    { value: "video", label: "视频", description: "单视频、录像、短片", icon: Filmstrip },
    { value: "mixed_video", label: "混合视频", description: "通用视频资源，保留后续归类空间", icon: Filmstrip },
    { value: "game", label: "游戏", description: "主机、PC、掌机资源", icon: Puzzle },
    { value: "manga", label: "漫画", description: "单行本、图像章节", icon: Camera },
    { value: "anime", label: "动漫", description: "动画资源与剧场版", icon: Filmstrip },
    { value: "movie", label: "电影", description: "电影作品与电影数据库元数据", icon: Filmstrip },
    { value: "series", label: "剧集", description: "电视剧、连续剧集", icon: Filmstrip },
    { value: "music", label: "音乐", description: "专辑、单曲、音轨", icon: MusicNote },
    { value: "novel", label: "小说", description: "电子书与文本资源", icon: Folder },
    { value: "other", label: "其他", description: "暂未单独分类的资源", icon: Folder },
];

const sourceTypeOptions: SelectOption<LibrarySource>[] = [
    { value: "local", label: "Local", description: "读取本地目录", icon: Folder },
    { value: "webdav", label: "WebDAV", description: "连接远程 WebDAV 目录", icon: CloudGear },
];

const initialCreateForm: CreateFormState = {
    name: "",
    sourceType: "local",
    rootPath: "",
    webdavServerId: "",
    webdavPath: "",
    mediaType: "photo",
    scanExtensions: ["mp4", "mkv", "webm", "mov", "avi"],
    collectionsEnabled: false,
    collectionType: "normal",
    previewsEnabled: true,
};

const videoCollectionTypeOptions: SelectOption<"normal" | "difference">[] = [
    { value: "normal", label: "普通集合", description: "预留模式，本阶段不执行归组", icon: Filmstrip },
    { value: "difference", label: "差异视频集合", description: "同一时间轴下切换不同视频版本", icon: Filmstrip },
];

const videoFormatOptions = [
    { id: "mp4", name: "MP4", description: "最常用的通用视频容器" },
    { id: "mkv", name: "MKV", description: "常见高清与多音轨容器" },
    { id: "webm", name: "WebM", description: "Web 视频容器" },
    { id: "mov", name: "MOV", description: "QuickTime 视频容器" },
    { id: "avi", name: "AVI", description: "传统视频容器" },
    { id: "m4v", name: "M4V", description: "MPEG-4 视频容器" },
    { id: "ts", name: "TS", description: "MPEG 传输流" },
    { id: "m2ts", name: "M2TS", description: "蓝光传输流" },
];

function VideoFormatAutocomplete({
    value,
    onChange,
}: {
    value: string[];
    onChange: (value: string[]) => void;
}) {
    const { contains } = useFilter({ sensitivity: "base" });

    function removeTags(keys: Set<Key>) {
        onChange(value.filter((extension) => !keys.has(extension)));
    }

    return (
        <Autocomplete
            className="w-full"
            aria-label="扫描媒体格式"
            placeholder="选择需要扫描的视频格式"
            selectionMode="multiple"
            value={value}
            onChange={(keys: Key | Key[] | null) =>
                onChange(Array.isArray(keys) ? keys.map(String) : [])}
        >
            <Autocomplete.Trigger className="min-h-12 w-full rounded-field border border-border bg-field px-3 py-2 text-field-foreground outline-none transition focus-within:border-focus">
                <Autocomplete.Value>
                    {({ defaultChildren, isPlaceholder, state }) => {
                        if (isPlaceholder || state.selectedItems.length === 0) {
                            return defaultChildren;
                        }
                        return (
                            <TagGroup size="sm" onRemove={removeTags}>
                                <TagGroup.List className="flex flex-wrap gap-1">
                                    {state.selectedItems.map((selectedItem) => {
                                        const item = videoFormatOptions.find(
                                            (option) => option.id === String(selectedItem.key),
                                        );
                                        return item ? (
                                            <Tag key={item.id} id={item.id}>{item.name}</Tag>
                                        ) : null;
                                    })}
                                </TagGroup.List>
                            </TagGroup>
                        );
                    }}
                </Autocomplete.Value>
                <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover>
                <Autocomplete.Filter filter={contains}>
                    <SearchField autoFocus name="video-format-search" variant="secondary">
                        <SearchField.Group>
                            <SearchField.SearchIcon />
                            <SearchField.Input placeholder="搜索视频格式" />
                            <SearchField.ClearButton />
                        </SearchField.Group>
                    </SearchField>
                    <ListBox renderEmptyState={() => <EmptyState>没有匹配的视频格式</EmptyState>}>
                        {videoFormatOptions.map((item) => (
                            <ListBox.Item key={item.id} id={item.id} textValue={`${item.name} ${item.description}`}>
                                <div className="min-w-0">
                                    <span className="block text-sm font-medium">{item.name}</span>
                                    <span className="block text-xs text-muted">{item.description}</span>
                                </div>
                                <ListBox.ItemIndicator />
                            </ListBox.Item>
                        ))}
                    </ListBox>
                </Autocomplete.Filter>
            </Autocomplete.Popover>
        </Autocomplete>
    );
}

const initialSettingsForm: LibrarySettingsFormState = {
    name: "",
    sourceType: "local",
    rootPath: "",
    webdavConnectionId: "",
    previewsEnabled: true,
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
    optionLayout = "list",
}: {
    label: string;
    selectedKey: T;
    options: SelectOption<T>[];
    onSelectionChange: (value: T) => void;
    optionLayout?: "list" | "grid";
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
                <Select.Trigger aria-label={label} className={selectTriggerClass}>
                    <Select.Value className="min-w-0 truncate text-left text-foreground" />
                    <Select.Indicator>
                        <ChevronDown className="h-4 w-4 text-muted" />
                    </Select.Indicator>
                </Select.Trigger>
                <Select.Popover
                    className={`max-h-[min(420px,calc(100vh-96px))] overflow-hidden rounded-2xl border border-border bg-surface p-1 text-foreground shadow-2xl backdrop-blur-xl ${optionLayout === "grid" ? "w-[min(28rem,calc(100vw-32px))]" : ""}`}
                >
                    <ListBox
                        className={`max-h-[min(412px,calc(100vh-104px))] overflow-y-auto outline-none ${optionLayout === "grid" ? "grid grid-cols-2 gap-1 p-1" : "pr-1"}`}
                    >
                        {options.map((item) => (
                            <ListBox.Item
                                key={item.value}
                                id={item.value}
                                textValue={item.label}
                                className={`rounded-xl px-3 text-foreground outline-none transition data-[focused]:bg-white/10 data-[hovered]:bg-white/8 ${optionLayout === "grid" ? "min-h-16 py-2.5" : "py-3"}`}
                            >
                                <div className="flex items-center gap-3">
                                    <item.icon className={`${optionLayout === "grid" ? "h-6 w-6" : "h-4 w-4"} shrink-0 text-muted`} />
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium leading-5">{item.label}</div>
                                        {item.description ? (
                                            <div className="text-xs leading-5 text-muted">
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

function SettingSwitch({
    title,
    value,
    onChange,
    description,
}: {
    title: string;
    value: boolean;
    onChange: (value: boolean) => void;
    description: string;
}) {
    return (
        <Switch
            isSelected={value}
            onChange={onChange}
            className={`${settingPanelClass} flex w-full cursor-pointer items-center justify-between gap-5 text-left transition hover:bg-white/12`}
        >
            <Switch.Content className="min-w-0 flex-1">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                        {title}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                        {description}
                    </p>
                </div>
            </Switch.Content>
            <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs font-medium text-muted">
                    {value ? "已开启" : "已关闭"}
                </span>
                <Switch.Control>
                    <Switch.Thumb />
                </Switch.Control>
            </div>
        </Switch>
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
        <SettingSwitch
            title="生成浏览缓存"
            value={value}
            onChange={onChange}
            description={description}
        />
    );
}

export default function MediaLibrariesPage() {
    const createModalState = useOverlayState({});
    const settingsModalState = useOverlayState({});
    const infoModalState = useOverlayState({});
    const deleteModalState = useOverlayState({});
    const [libraries, setLibraries] = useState<LibraryResponse[]>([]);
    const [photos, setPhotos] = useState<PhotoAssetResponse[]>([]);
    const [mangaSeries, setMangaSeries] = useState<MangaSeriesResponse[]>([]);
    const [coverVideos, setCoverVideos] = useState<VideoAssetResponse[]>([]);
    const [webdavConnections, setWebdavConnections] = useState<WebdavConnectionResponse[]>([]);
    const [tasks, setTasks] = useState<TaskResponse[]>([]);
    const [createForm, setCreateForm] = useState<CreateFormState>(initialCreateForm);
    const [settingsForm, setSettingsForm] =
        useState<LibrarySettingsFormState>(initialSettingsForm);
    const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
    const [infoLibraryId, setInfoLibraryId] = useState<string | null>(null);
    const [deleteLibraryId, setDeleteLibraryId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [workingLibraryId, setWorkingLibraryId] = useState<string | null>(null);
    const [isSubmitting, startCreateTransition] = useTransition();
    const [isSavingSettings, startSaveSettingsTransition] = useTransition();
    const [isDeletingLibrary, startDeleteTransition] = useTransition();
    const activeVideoCoverTasksRef = useRef<Set<string>>(new Set());

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
    const mangaCoverMap = useMemo(() => {
        const map = new Map<string, MangaSeriesResponse[]>();
        for (const series of mangaSeries) {
            const librarySeries = map.get(series.library_id) ?? [];
            librarySeries.push(series);
            map.set(series.library_id, librarySeries);
        }
        return map;
    }, [mangaSeries]);
    const videoCoverMap = useMemo(() => {
        const map = new Map<string, VideoAssetResponse[]>();
        for (const video of coverVideos) {
            const libraryVideos = map.get(video.library_id) ?? [];
            libraryVideos.push(video);
            map.set(video.library_id, libraryVideos);
        }
        return map;
    }, [coverVideos]);
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
            const activeVideoCoverLibraryIds = new Set(
                taskData
                    .filter((task) =>
                        task.kind === "generate_cache"
                        && task.library_id
                        && ["queued", "running", "paused"].includes(task.status))
                    .map((task) => task.library_id!),
            );
            const finishedLibraryIds = [...activeVideoCoverTasksRef.current]
                .filter((libraryId) => !activeVideoCoverLibraryIds.has(libraryId));

            activeVideoCoverTasksRef.current = activeVideoCoverLibraryIds;
            setTasks(taskData);

            if (finishedLibraryIds.length > 0) {
                const refreshedCovers = await Promise.all(
                    finishedLibraryIds.map((libraryId) => getVideoCatalog({
                        libraryId,
                        sort: "created",
                        order: "desc",
                        limit: 3,
                        offset: 0,
                    }).then((catalog) => catalog.items)),
                );
                const finishedLibraryIdSet = new Set(finishedLibraryIds);
                setCoverVideos((current) => [
                    ...current.filter((video) => !finishedLibraryIdSet.has(video.library_id)),
                    ...refreshedCovers.flat(),
                ]);
            }
        } catch {
            // Keep the current task list if polling fails.
        }
    }

async function loadPageData() {
        try {
            setIsLoading(true);
            const [libraryData, taskData, connectionData, mangaData, covers] = await Promise.all([
                getMediaLibraries(),
                getTasks(),
                getWebdavConnections(),
                getMangaSeries(),
                getLibraryCovers(),
            ]);

            setLibraries(libraryData);
            setPhotos(covers.photos);
            setMangaSeries(mangaData);
            setCoverVideos(covers.videos);
            setTasks(taskData);
            activeVideoCoverTasksRef.current = new Set(
                taskData
                    .filter((task) =>
                        task.kind === "generate_cache"
                        && task.library_id
                        && ["queued", "running", "paused"].includes(task.status))
                    .map((task) => task.library_id!),
            );
            setWebdavConnections(connectionData);
        } catch (loadError) {
            toast.danger(getErrorMessage(loadError));
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

    function updateCreateMediaType(mediaType: MediaType) {
        setCreateForm((current) => ({
            ...current,
            mediaType,
            scanExtensions:
                mediaType === "video" && current.scanExtensions.length === 0
                    ? initialCreateForm.scanExtensions
                    : current.scanExtensions,
            collectionsEnabled:
                mediaType === "video" ? current.collectionsEnabled : false,
            collectionType:
                mediaType === "video" ? current.collectionType : "normal",
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
            sourceType: library.source_type === "webdav" ? "webdav" : "local",
            rootPath: library.root_path,
            webdavConnectionId: library.webdav_connection_id ?? "",
            previewsEnabled: library.previews_enabled,
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
            toast.warning("请填写媒体库名称。");
            return;
        }

        if (createForm.sourceType === "local" && !rootPath) {
            toast.warning("选择 Local 时必须填写本地绝对路径。");
            return;
        }

        if (createForm.sourceType === "webdav" && !createForm.webdavServerId) {
            toast.warning("请选择 WebDAV 连接。");
            return;
        }

        if (createForm.mediaType === "video" && createForm.scanExtensions.length === 0) {
            toast.warning("请至少选择一种需要扫描的视频格式。");
            return;
        }

        startCreateTransition(async () => {
            try {
                const library = await createMediaLibrary({
                    name,
                    root_path: createForm.sourceType === "webdav" ? createForm.webdavPath.trim() : rootPath,
                    media_type: createForm.mediaType,
                    scan_extensions: createForm.mediaType === "video"
                        ? createForm.scanExtensions
                        : undefined,
                    collections_enabled: createForm.mediaType === "video"
                        ? createForm.collectionsEnabled
                        : false,
                    collection_type: createForm.mediaType === "video" && createForm.collectionsEnabled
                        ? createForm.collectionType
                        : undefined,
                    previews_enabled: createForm.previewsEnabled,
                    source_type: createForm.sourceType,
                    webdav_connection_id: createForm.sourceType === "webdav" ? createForm.webdavServerId : undefined,
                });
                await scanMediaLibrary({
                    library_id: library.id,
                });

                toast.success(
                    createForm.previewsEnabled
                        ? "媒体库已创建，首次扫描任务已启动，后续扫描会自动补齐浏览缓存。"
                        : "媒体库已创建，首次扫描任务已启动；缓存自动生成未开启，可稍后手动生成。",
                );
                setCreateForm(initialCreateForm);
                createModalState.close();
                await loadPageData();
            } catch (submitError) {
                toast.danger(getErrorMessage(submitError));
            }
        });
    }

    async function runLibraryAction(libraryId: string, action: () => Promise<string>) {
        try {
            setWorkingLibraryId(libraryId);
            const nextNotice = await action();
            toast.success(nextNotice);
            await loadPageData();
        } catch (actionError) {
            toast.danger(getErrorMessage(actionError));
        } finally {
            setWorkingLibraryId(null);
        }
    }

    async function startGenerateTask(library: LibraryResponse) {
        try {
            setWorkingLibraryId(library.id);
            await generateLibraryPreviews(library.id);
            toast.success(`已为“${library.name}”创建缓存生成任务，请到任务页查看进度。`);
            await loadPageData();
        } catch (generateError) {
            toast.danger(getErrorMessage(generateError));
        } finally {
            setWorkingLibraryId(null);
        }
    }

    async function startVideoAnalysisTask(library: LibraryResponse) {
        try {
            setWorkingLibraryId(library.id);
            await startVideoAnalysis(library.id);
            toast.success(`已为“${library.name}”创建视频技术信息读取任务，请到任务页查看进度。`);
            await loadPageData();
        } catch (analysisError) {
            toast.danger(getErrorMessage(analysisError));
        } finally {
            setWorkingLibraryId(null);
        }
    }

    async function startVideoCoverTask(library: LibraryResponse, force: boolean) {
        try {
            setWorkingLibraryId(library.id);
            await generateVideoCovers(library.id, force);
            toast.success(
                force
                    ? `已为“${library.name}”创建封面重新生成任务，请到任务页查看进度。`
                    : `已为“${library.name}”创建封面生成任务，请到任务页查看进度。`,
            );
            await loadPageData();
        } catch (coverError) {
            toast.danger(getErrorMessage(coverError));
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

        if (!name || (settingsForm.sourceType === "local" && !rootPath)) {
            toast.warning("媒体库名称和路径不能为空。");
            return;
        }

        if (settingsForm.sourceType === "webdav" && !settingsForm.webdavConnectionId) {
            toast.warning("请选择 WebDAV 连接。");
            return;
        }

        startSaveSettingsTransition(async () => {
            try {
                await updateMediaLibrary(editingLibrary.id, {
                    name,
                    root_path: rootPath,
                    previews_enabled: settingsForm.previewsEnabled,
                    source_type: settingsForm.sourceType,
                    webdav_connection_id: settingsForm.sourceType === "webdav" ? settingsForm.webdavConnectionId : undefined,
                });
                settingsModalState.close();
                toast.success("媒体库设置已更新。");
                await loadPageData();
            } catch (saveError) {
                toast.danger(getErrorMessage(saveError));
            }
        });
    }

    function confirmDeleteLibrary() {
        if (!deleteLibraryTarget) {
            return;
        }

        startDeleteTransition(async () => {
            try {
                await deleteMediaLibrary(deleteLibraryTarget.id);
                deleteModalState.close();
                setDeleteLibraryId(null);
                setInfoLibraryId((current) =>
                    current === deleteLibraryTarget.id ? null : current,
                );
                setEditingLibraryId((current) =>
                    current === deleteLibraryTarget.id ? null : current,
                );
                toast.success(`媒体库“${deleteLibraryTarget.name}”已删除。`);
                await loadPageData();
            } catch (deleteError) {
                toast.danger(getErrorMessage(deleteError));
            }
        });
    }

    return (
        <SettingsPage
            className="flex h-full min-h-0 flex-col text-foreground"
            contentClassName="min-h-0 flex-1 overflow-auto"
            group="媒体库"
            title="媒体库列表"
            description="管理本地媒体目录，支持重新扫描、手动生成缓存、修改路径与名称。资源信息和缓存占用统一放在“更多 - 信息”中查看，生成进度统一在任务页跟踪。"
            actions={<><Button
                className="rounded-2xl bg-accent px-5 text-accent-foreground hover:opacity-90"
                onPress={createModalState.open}
            >
                新建媒体库
            </Button><LibraryScanSettingsDialog /></>}
        >

            <div>
                {libraries.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-border bg-white/6 text-sm text-muted">
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
                                    coverManga={mangaCoverMap.get(library.id)}
                                    coverVideos={videoCoverMap.get(library.id)}
                                    hasActiveCacheTask={hasActiveCacheTask}
                                    isBusy={libraryBusy}
                                    onRescan={() =>
                                        runLibraryAction(library.id, async () => {
                                            await scanMediaLibrary({
                                                library_id: library.id,
                                            });
                                            return `媒体库“${library.name}”重新扫描任务已启动，请到任务页查看进度。`;
                                        })
                                    }
                                    onGeneratePreviews={() => void startGenerateTask(library)}
                                    onAnalyzeVideos={() => void startVideoAnalysisTask(library)}
                                    onRegenerateVideoCovers={() => void startVideoCoverTask(library, true)}
                                    onDeletePreviews={() =>
                                        runLibraryAction(library.id, async () => {
                                            if (["video", "mixed_video"].includes(library.media_type)) {
                                                const result = await deleteVideoCovers(library.id);
                                                return `已删除 ${result.deleted_covers} 个视频封面缓存，回收 ${formatBytes(result.reclaimed_bytes)}。`;
                                            }
                                            const result = await deleteLibraryPreviews(library.id);

                                            return `已删除 ${result.deleted_previews} 个预览图缓存，回收 ${formatBytes(result.reclaimed_bytes)}。`;
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
                <Modal.Trigger aria-label="打开新建媒体库对话框" className="sr-only">
                    <button type="button" aria-label="打开新建媒体库对话框" />
                </Modal.Trigger>
                <Modal.Backdrop
                    isDismissable
                    variant="blur"
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                >
                    <Modal.Container
                        placement="center"
                        className="max-h-[calc(100dvh-32px)]"
                    >
                        <Modal.Dialog className="!w-[min(900px,calc(100vw-32px))] !max-w-[900px] flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden border border-[var(--border)] p-0 outline-none">
                            <Modal.Header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
                                <div className="min-w-0">
                                    <Modal.Heading className="text-lg font-semibold text-foreground">
                                        新建媒体库
                                    </Modal.Heading>
                                    <p className="mt-1 text-sm leading-6 text-muted">
                                        配置媒体类型和内容来源，创建后将立即启动首次扫描。
                                    </p>
                                </div>
                                <Modal.CloseTrigger
                                    aria-label="关闭"
                                    className="shrink-0 rounded-xl p-2 text-muted transition hover:bg-white/10"
                                >
                                    <Xmark className="h-5 w-5" />
                                </Modal.CloseTrigger>
                            </Modal.Header>
                            <Modal.Body className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
                                <section className={createSectionClass}>
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">基本设置</h3>
                                        <p className="mt-1 text-xs leading-5 text-muted">设置媒体库的名称、内容类型与媒体来源。</p>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <TextInputField
                                            label="媒体库名称"
                                            value={createForm.name}
                                            placeholder="例如：家庭照片"
                                            onChange={(value) => updateCreateForm("name", value)}
                                        />
                                        <SelectField
                                            label="媒体类型"
                                            selectedKey={createForm.mediaType}
                                            options={mediaTypeOptions}
                                            optionLayout="grid"
                                            onSelectionChange={updateCreateMediaType}
                                        />
                                    </div>
                                    {createForm.mediaType === "manga" ? (
                                        <div className="rounded-xl border border-sky-300/30 bg-sky-500/10 px-4 py-3 text-sm leading-6 text-muted">
                                            图片父目录默认识别为单篇漫画。目录名包含“第…章 / 话 / 节”、Chapter 或 Ch. 时，该目录识别为章节，其上一级目录识别为漫画标题。仅扫描图片目录。
                                        </div>
                                    ) : null}
                                    {createForm.sourceType === "local" ? (
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <SelectField
                                                label="媒体源"
                                                selectedKey={createForm.sourceType}
                                                options={sourceTypeOptions}
                                                onSelectionChange={(value) =>
                                                    updateCreateForm("sourceType", value)
                                                }
                                            />
                                            <TextInputField
                                                label="本地绝对路径"
                                                value={createForm.rootPath}
                                                placeholder="例如：D:\\Media\\Photos"
                                                onChange={(value) => updateCreateForm("rootPath", value)}
                                            />
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid gap-4 md:grid-cols-3">
                                                <SelectField
                                                    label="媒体源"
                                                    selectedKey={createForm.sourceType}
                                                    options={sourceTypeOptions}
                                                    onSelectionChange={(value) =>
                                                        updateCreateForm("sourceType", value)
                                                    }
                                                />
                                                <SelectField
                                                    label="WebDAV 连接"
                                                    selectedKey={createForm.webdavServerId}
                                                    options={webdavConnections.map((connection) => ({ value: connection.id, label: connection.name, description: connection.url, icon: CloudGear }))}
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
                                            <p className="text-xs leading-5 text-muted">
                                                路径相对于所选连接的地址拼接；填写 <code>/</code> 扫描连接根目录，填写 <code>/media/photos</code> 扫描该子目录。不能填写本机绝对路径或另一个 URL。
                                            </p>
                                            {webdavConnections.length === 0 ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/12 px-4 py-3 text-sm text-amber-700 dark:text-amber-100">请先在“远程数据源”中添加 WebDAV 连接。</div> : null}
                                        </div>
                                    )}
                                </section>

                                {createForm.mediaType === "video" ? (
                                    <section className={createSectionClass}>
                                        <div>
                                            <h3 className="text-sm font-semibold text-foreground">视频专属设置</h3>
                                            <p className="mt-1 text-xs leading-5 text-muted">配置视频文件识别范围与目录集合规则。</p>
                                        </div>

                                        <div className="space-y-2">
                                            <p className={fieldLabelClass}>扫描媒体格式</p>
                                            <VideoFormatAutocomplete
                                                value={createForm.scanExtensions}
                                                onChange={(value) => updateCreateForm("scanExtensions", value)}
                                            />
                                            <p className="text-xs leading-5 text-muted">
                                                扫描时只索引选中的视频容器格式；默认已选择常用格式。
                                            </p>
                                        </div>

                                        <div className="space-y-3">
                                            <p className={fieldLabelClass}>视频集合</p>
                                            <SettingSwitch
                                                title="启用视频集合"
                                                value={createForm.collectionsEnabled}
                                                onChange={(value) => updateCreateForm("collectionsEnabled", value)}
                                                description="默认关闭。开启后，扫描器会按选择的集合规则归组视频。"
                                            />
                                            {createForm.collectionsEnabled ? (
                                                <div className="space-y-4 border-l-2 border-border pl-4">
                                                    <SelectField
                                                        label="媒体集合类型"
                                                        selectedKey={createForm.collectionType}
                                                        options={videoCollectionTypeOptions}
                                                        onSelectionChange={(value) => updateCreateForm("collectionType", value)}
                                                    />
                                                    {createForm.collectionType === "normal" ? (
                                                        <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
                                                            普通集合为预留模式，本阶段保存该设置但不会执行视频归组。
                                                        </div>
                                                    ) : (
                                                        <div className="rounded-xl border border-sky-300/30 bg-sky-500/10 px-4 py-3 text-xs leading-6 text-muted">
                                                            <p className="font-medium text-foreground">差异视频集合扫描规则</p>
                                                            <p className="mt-1">递归扫描目录；同一目录至少存在两个名称为 <code>video.ext</code> 或 <code>video数字.ext</code> 的视频时，将这些匹配项识别为一个集合。</p>
                                                            <p><code>video.ext</code> 优先作为默认播放视频，其他成员按文件名数字排序；集合标题使用目录名。</p>
                                                            <p>同目录中不符合命名规则的视频不会加入集合，仍作为独立视频展示。</p>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    </section>
                                ) : null}

                                <section className={createSectionClass}>
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">扫描与缓存</h3>
                                        <p className="mt-1 text-xs leading-5 text-muted">控制每次扫描完成后的缓存生成行为。</p>
                                    </div>
                                    <CacheSetting
                                        value={createForm.previewsEnabled}
                                        onChange={(value) =>
                                            updateCreateForm("previewsEnabled", value)
                                        }
                                        description={createForm.mediaType === "video"
                                            ? "开启后，每次扫描完成都会自动使用 FFmpeg 抽取视频封面，并保存到 api/data/preview/媒体库ID。"
                                            : "开启后，该媒体库每次扫描完成都会自动补齐预览图缓存。"}
                                    />
                                </section>
                            </Modal.Body>
                            <Modal.Footer className="flex shrink-0 justify-end gap-3 border-t border-border px-6 py-5">
                                <Button
                                    className="h-11 min-w-32 rounded-xl border border-border bg-white/8 px-5 text-foreground transition hover:bg-white/12"
                                    isDisabled={isSubmitting}
                                    onPress={createModalState.close}
                                >
                                    取消
                                </Button>
                                <Button
                                    className="h-11 min-w-32 rounded-xl border border-accent bg-accent px-5 text-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <Modal.Trigger aria-label="打开媒体库设置对话框" className="sr-only">
                    <button type="button" aria-label="打开媒体库设置对话框" />
                </Modal.Trigger>
                <Modal.Backdrop
                    isDismissable
                    variant="blur"
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                >
                    <Modal.Container placement="center" className={modalSurfaceClass}>
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-border px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-foreground">
                                    媒体库设置
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-muted">
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
                                <SelectField
                                    label="媒体源"
                                    selectedKey={settingsForm.sourceType}
                                    options={sourceTypeOptions}
                                    onSelectionChange={(value) => updateSettingsForm("sourceType", value)}
                                />
                                {settingsForm.sourceType === "local" ? (
                                    <TextInputField
                                        label="本地绝对路径"
                                        value={settingsForm.rootPath}
                                        placeholder="例如：D:\\Media\\Photos"
                                        onChange={(value) => updateSettingsForm("rootPath", value)}
                                    />
                                ) : (
                                    <div className="space-y-3">
                                        <SelectField
                                            label="WebDAV 连接"
                                            selectedKey={settingsForm.webdavConnectionId}
                                            options={webdavConnections.map((connection) => ({ value: connection.id, label: connection.name, description: connection.url, icon: CloudGear }))}
                                            onSelectionChange={(value) => updateSettingsForm("webdavConnectionId", value)}
                                        />
                                        <TextInputField
                                            label="WebDAV 路径"
                                            value={settingsForm.rootPath}
                                            placeholder="/ 或 /media/photos"
                                            onChange={(value) => updateSettingsForm("rootPath", value)}
                                        />
                                        <p className="text-xs leading-5 text-muted">
                                            路径相对于所选连接的地址拼接；<code>/</code> 为连接根目录。
                                        </p>
                                    </div>
                                )}
                                <div className="space-y-3">
                                    <p className={fieldLabelClass}>媒体库设置</p>
                                    <CacheSetting
                                        value={settingsForm.previewsEnabled}
                                        onChange={(value) =>
                                            updateSettingsForm("previewsEnabled", value)
                                        }
                                        description={editingLibrary?.media_type === "video"
                                            ? "每次扫描完成后，自动使用 FFmpeg 抽取视频封面并写入视频封面缓存。"
                                            : "每次扫描完成后，自动为该媒体库补齐预览图缓存。"}
                                    />
                                </div>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-border px-6 py-5">
                                <Modal.CloseTrigger aria-label="关闭" className="rounded-xl p-2 text-muted transition hover:bg-white/10">
                                    <Xmark className="h-5 w-5" />
                                </Modal.CloseTrigger>
                                <Button
                                    className="rounded-2xl bg-accent px-5 text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <Modal.Trigger aria-label="打开媒体库信息对话框" className="sr-only">
                    <button type="button" aria-label="打开媒体库信息对话框" />
                </Modal.Trigger>
                <Modal.Backdrop
                    isDismissable
                    variant="blur"
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                >
                    <Modal.Container placement="center" className={modalSurfaceClass}>
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-border px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-foreground">
                                    媒体库信息
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-muted">
                                    {infoLibrary ? infoLibrary.name : "当前媒体库"}
                                </p>
                            </Modal.Header>
                            <Modal.Body className="px-6 py-5">
                                {infoLibrary ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl border border-border bg-white/8 p-4">
                                            <p className="text-xs font-medium text-muted">
                                                资源总数
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-foreground">
                                                {infoLibrary.resource_count}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-border bg-white/8 p-4">
                                            <p className="text-xs font-medium text-muted">
                                                缓存待生成
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-foreground">
                                                {infoLibrary.preview_status.pending_assets}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-border bg-white/8 p-4">
                                            <p className="text-xs font-medium text-muted">
                                                Preview 占用
                                            </p>
                                            <p className="mt-2 text-lg font-semibold text-foreground">
                                                {formatBytes(
                                                    infoLibrary.preview_status.preview_total_bytes,
                                                )}
                                            </p>
                                        </div>
                                        <div className="col-span-2 rounded-2xl border border-border bg-white/6 p-4">
                                            <div className="flex items-center justify-between gap-3 text-sm">
                                                <span className="text-muted">
                                                    Preview 就绪
                                                </span>
                                                <span className="font-medium text-foreground">
                                                    {infoLibrary.preview_status.preview_ready_assets}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-muted">
                                                    最近生成时间
                                                </span>
                                                <span className="font-medium text-foreground">
                                                    {formatDate(
                                                        infoLibrary.preview_status
                                                            .last_generated_at,
                                                    )}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-muted">
                                                    媒体源类型
                                                </span>
                                                <span className="font-medium text-foreground">
                                                    {getLibrarySourceLabel()}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-muted">
                                                    媒体库状态
                                                </span>
                                                <span className="font-medium text-foreground">
                                                    {infoLibrary.enabled ? "已启用" : "已停用"}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-muted">
                                                    创建时间
                                                </span>
                                                <span className="font-medium text-foreground">
                                                    {formatDate(infoLibrary.created_at)}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                                <span className="text-muted">
                                                    更新时间
                                                </span>
                                                <span className="font-medium text-foreground">
                                                    {formatDate(infoLibrary.updated_at)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-border bg-white/6 px-4 py-10 text-center text-sm text-muted">
                                        当前媒体库信息不可用。
                                    </div>
                                )}
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-border px-6 py-5">
                                <Modal.CloseTrigger aria-label="关闭" className="rounded-xl p-2 text-muted transition hover:bg-white/10">
                                    <Xmark className="h-5 w-5" />
                                </Modal.CloseTrigger>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>

            <Modal state={deleteModalState}>
                <Modal.Trigger aria-label="打开删除媒体库确认对话框" className="sr-only">
                    <button type="button" aria-label="打开删除媒体库确认对话框" />
                </Modal.Trigger>
                <Modal.Backdrop
                    isDismissable
                    variant="blur"
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                >
                    <Modal.Container
                        placement="center"
                        className="w-[min(520px,calc(100vw-32px))] p-0"
                    >
                        <Modal.Dialog className="outline-none">
                            <Modal.Header className="border-b border-border px-6 py-5">
                                <Modal.Heading className="text-lg font-semibold text-foreground">
                                    删除媒体库
                                </Modal.Heading>
                                <p className="mt-1 text-sm text-muted">
                                    {deleteLibraryTarget
                                        ? `即将删除“${deleteLibraryTarget.name}”的扫描索引与缓存。`
                                        : "即将删除当前媒体库。"}
                                </p>
                            </Modal.Header>
                            <Modal.Body className="space-y-3 px-6 py-5 text-sm leading-6 text-muted">
                                <p>
                                    删除后会移除媒体库记录、扫描结果，以及 `api/data/preview` 下对应缓存。
                                </p>
                                <p className="font-medium text-foreground">
                                    不会删除你原始目录中的照片文件。
                                </p>
                            </Modal.Body>
                            <Modal.Footer className="flex justify-end gap-3 border-t border-border px-6 py-5">
                                <Modal.CloseTrigger aria-label="关闭" className="rounded-xl p-2 text-muted transition hover:bg-white/10">
                                    <Xmark className="h-5 w-5" />
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
        </SettingsPage>
    );
}
