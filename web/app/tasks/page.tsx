"use client";

import { ArrowsRotateRight, CircleInfo, CirclePause, CirclePlay, CircleStop, Stopwatch, TrashBin } from "@gravity-ui/icons";
import { Alert, Button, Chip, Modal, ProgressBar, Skeleton, Tabs, Tooltip } from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    cancelTask,
    clearCompletedTasks,
    deleteTask,
    getTasks,
    getTaskSummary,
    pauseTask,
    resumeTask,
    retryTask,
    type TaskResponse,
    type TaskSummaryResponse,
} from "@/src/api/client";
import ContentPageLayout from "@/app/components/ContentPageLayout";

type View = "active" | "history";
type TaskColor = "accent" | "warning" | "success" | "danger" | "default";

const activeTask = (task: TaskResponse) => ["queued", "running", "paused"].includes(task.status);

function getStatus(status: string): [string, TaskColor] {
    const labels: Record<string, [string, TaskColor]> = {
        running: ["进行中", "accent"],
        queued: ["等待中", "warning"],
        paused: ["已暂停", "default"],
        completed: ["已完成", "success"],
        canceled: ["已取消", "default"],
        failed: ["失败", "danger"],
    };
    return labels[status] ?? [status, "default"];
}

function getKind(task: TaskResponse) {
    if (task.kind === "generate_cache") {
        return { label: "生成媒体信息", icon: <CirclePlay className="h-4 w-4" /> };
    }
    if (task.kind === "scan_library") {
        return { label: "媒体库扫描", icon: <Stopwatch className="h-4 w-4" /> };
    }
    return { label: "后台处理", icon: <Stopwatch className="h-4 w-4" /> };
}

function formatTime(value?: string | null) {
    return value
        ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
        : "--";
}

function formatDuration(createdAt: string, finishedAt: string | null | undefined, now: number) {
    const durationMs = Math.max(0, (finishedAt ? new Date(finishedAt).getTime() : now) - new Date(createdAt).getTime());
    if (finishedAt && durationMs < 1000) return "少于 1 秒";
    const seconds = Math.floor(durationMs / 1000);
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function TasksPage() {
    const [tasks, setTasks] = useState<TaskResponse[]>([]);
    const [summary, setSummary] = useState<TaskSummaryResponse>({ total: 0, active: 0, history: 0, failed: 0 });
    const [view, setView] = useState<View>("active");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState<string | null>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [detailTask, setDetailTask] = useState<TaskResponse | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [now, setNow] = useState(Date.now);
    const lock = useRef(false);

    const load = useCallback(async () => {
        if (lock.current) return;
        lock.current = true;
        try {
            const [taskData, taskSummary] = await Promise.all([
                getTasks(view === "active"),
                getTaskSummary(),
            ]);
            setTasks(taskData);
            setSummary(taskSummary);
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "请求失败");
        } finally {
            lock.current = false;
            setLoading(false);
        }
    }, [view]);

    useEffect(() => {
        const refreshWhenVisible = () => {
            if (!document.hidden) void load();
        };
        refreshWhenVisible();
        document.addEventListener("visibilitychange", refreshWhenVisible);
        const pollingTimer = window.setInterval(refreshWhenVisible, 1500);
        const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => {
            document.removeEventListener("visibilitychange", refreshWhenVisible);
            window.clearInterval(pollingTimer);
            window.clearInterval(clockTimer);
        };
    }, [load]);

    const visible = useMemo(
        () => tasks.filter((task) => view === "active" ? activeTask(task) : !activeTask(task)),
        [tasks, view],
    );
    const detailErrors = detailTask
        ? Array.from(new Set([
            detailTask.error_message,
            ...detailTask.error_details,
        ].filter((value): value is string => Boolean(value && value.trim()))))
        : [];

    async function run(id: string, action: "pause" | "resume" | "cancel") {
        setActing(id);
        try {
            if (action === "pause") await pauseTask(id);
            else if (action === "resume") await resumeTask(id);
            else await cancelTask(id);
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "请求失败");
        } finally {
            setActing(null);
        }
    }

    async function retry(id: string) {
        setActing(id);
        try { await retryTask(id); await load(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "请求失败"); }
        finally { setActing(null); }
    }

    async function clearHistory() {
        setDeleting(true);
        try {
            await clearCompletedTasks();
            await load();
        } finally {
            setDeleting(false);
        }
    }

    return (
        <ContentPageLayout
            title="任务中心"
            description="传输与处理"
            actions={<><Chip variant="soft">全部 {summary.total}</Chip><Chip color="danger" variant="soft">失败 {summary.failed}</Chip><Button size="sm" variant="secondary" isDisabled={deleting || summary.history === 0} onPress={() => void clearHistory()}>清除历史记录</Button><Tabs.Root aria-label="任务视图" selectedKey={view} onSelectionChange={(key) => setView(key as View)} className="w-64 shrink-0"><Tabs.ListContainer className="w-full"><Tabs.List className="grid w-full grid-cols-2"><Tabs.Tab id="active" className="justify-center whitespace-nowrap">进行中 <Chip size="sm">{summary.active}</Chip><Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="history" className="justify-center whitespace-nowrap">历史记录 <Chip size="sm">{summary.history}</Chip><Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer></Tabs.Root></>}
        >
        <div className="min-w-[760px]">
            {error ? <Alert status="danger" className="mx-5 mt-4"><Alert.Indicator /><Alert.Content><Alert.Title>任务请求失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
            <div className="px-5">
                    <div className="grid grid-cols-[minmax(260px,1.6fr)_minmax(180px,1fr)_105px_88px_96px] gap-5 border-b border-border py-4 text-xs text-muted"><span>任务</span><span>进度</span><span>状态</span><span>更新时间</span><span /></div>
                    {loading && !tasks.length ? <div className="space-y-3 py-5">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-lg" />)}</div> : null}
                    {!loading && !visible.length ? <div className="my-5 flex h-56 flex-col items-center justify-center border border-border text-center"><Stopwatch className="h-7 w-7 text-muted" /><p className="mt-3 text-sm">暂无任务</p></div> : null}
                    {visible.map((task) => {
                        const kind = getKind(task);
                        const [label, color] = getStatus(task.status);
                        const progress = Math.max(0, Math.min(100, task.progress_percent));
                        return (
                            <div key={task.id} className="grid grid-cols-[minmax(260px,1.6fr)_minmax(180px,1fr)_105px_88px_96px] items-center gap-5 border-b border-border py-4 hover:bg-surface-secondary">
                                <div className="flex min-w-0 items-center gap-3"><Chip color={color} variant="soft" className="flex h-9 w-9 shrink-0 items-center justify-center p-0">{kind.icon}</Chip><div className="min-w-0"><p className="truncate text-sm font-medium">{task.title}</p><p className="truncate text-xs text-muted">{kind.label} · {task.library_name || "未关联媒体库"}</p>{task.error_message ? <p className="truncate text-xs text-danger" title={task.error_message}>{task.error_message}</p> : task.detail ? <p className="truncate text-xs text-muted" title={task.detail}>{task.detail}</p> : null}</div></div>
                                <div><div className="flex items-center gap-3"><ProgressBar value={progress} maxValue={100} color={color} size="sm" className="flex-1" aria-label="任务进度" /><span className="text-xs text-muted">{progress}%</span></div><p className="mt-1 text-xs text-muted">{formatDuration(task.created_at, activeTask(task) ? null : task.finished_at, now)}</p></div>
                                <Chip color={color} variant="soft" size="sm">{label}</Chip>
                                <time className="text-xs text-muted">{formatTime(task.updated_at)}</time>
                                <div className="flex justify-end gap-1">
                                    <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly onPress={() => setDetailTask(task)}><CircleInfo /></Button></Tooltip.Trigger><Tooltip.Content>查看详情</Tooltip.Content></Tooltip>
                                    {task.status === "failed" && task.kind === "generate_cache" ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly isDisabled={acting === task.id} onPress={() => void retry(task.id)}><ArrowsRotateRight /></Button></Tooltip.Trigger><Tooltip.Content>重试失败项</Tooltip.Content></Tooltip> : null}
                                    {(task.status === "queued" || task.status === "running") ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly isDisabled={acting === task.id} onPress={() => void run(task.id, "pause")}><CirclePause /></Button></Tooltip.Trigger><Tooltip.Content>暂停</Tooltip.Content></Tooltip> : null}
                                    {task.status === "paused" ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly onPress={() => void run(task.id, "resume")}><CirclePlay /></Button></Tooltip.Trigger><Tooltip.Content>继续</Tooltip.Content></Tooltip> : null}
                                    {activeTask(task) ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly onPress={() => void run(task.id, "cancel")}><CircleStop /></Button></Tooltip.Trigger><Tooltip.Content>取消</Tooltip.Content></Tooltip> : null}
                                    {!activeTask(task) ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly onPress={() => setDeleteId(task.id)}><TrashBin /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip> : null}
                                </div>
                            </div>
                        );
                    })}
            </div>
            <Modal isOpen={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
                <Modal.Trigger aria-label="打开删除任务记录确认对话框" className="sr-only"><span /></Modal.Trigger>
                <Modal.Backdrop variant="blur"><Modal.Container placement="center"><Modal.Dialog><Modal.Header><Modal.Heading>删除任务记录</Modal.Heading></Modal.Header><Modal.Body>删除后无法恢复。</Modal.Body><Modal.Footer><Button variant="secondary" onPress={() => setDeleteId(null)}>取消</Button><Button variant="danger" isDisabled={deleting} onPress={async () => { if (deleteId) { setDeleting(true); try { await deleteTask(deleteId); setDeleteId(null); await load(); } finally { setDeleting(false); } } }}>删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
            </Modal>
            <Modal isOpen={detailTask !== null} onOpenChange={(open) => !open && setDetailTask(null)}>
                <Modal.Trigger aria-label="任务详情" className="sr-only"><span /></Modal.Trigger>
                <Modal.Backdrop variant="blur"><Modal.Container placement="center"><Modal.Dialog><Modal.Header><Modal.Heading>任务详情</Modal.Heading></Modal.Header><Modal.Body>
                    {detailTask ? <div className="space-y-3 text-sm"><p>{detailTask.title}</p><p className="text-muted">{detailTask.detail || "无处理详情"}</p>{detailErrors.length ? <div><p className="mb-2 font-medium text-danger">错误记录（{detailErrors.length}）</p><ol className="max-h-72 list-decimal space-y-2 overflow-auto pl-5 text-danger">{detailErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ol></div> : <p className="text-muted">未记录错误。</p>}</div> : null}
                </Modal.Body><Modal.Footer><Button variant="secondary" onPress={() => setDetailTask(null)}>关闭</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
            </Modal>
        </div>
        </ContentPageLayout>
    );
}
