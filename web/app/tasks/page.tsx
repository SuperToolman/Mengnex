"use client";

import { ArrowsRotateRight, CircleInfo, CirclePause, CirclePlay, CircleStop, Stopwatch, TrashBin } from "@gravity-ui/icons";
import { Alert, Button, Chip, EmptyState, Modal, ProgressBar, Skeleton, Table, Tabs, Tooltip } from "@heroui/react";
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
        return { label: "生成媒体信息", icon: <CirclePlay /> };
    }
    if (task.kind === "scan_library") {
        return { label: "媒体库扫描", icon: <Stopwatch /> };
    }
    return { label: "后台处理", icon: <Stopwatch /> };
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
            actions={<><Chip variant="soft">全部 {summary.total}</Chip><Chip color="danger" variant="soft">失败 {summary.failed}</Chip><Button size="sm" variant="secondary" isDisabled={deleting || summary.history === 0} onPress={() => void clearHistory()}>清除历史记录</Button><Tabs.Root aria-label="任务视图" selectedKey={view} onSelectionChange={(key) => setView(key as View)}><Tabs.ListContainer><Tabs.List><Tabs.Tab id="active">进行中 <Chip size="sm">{summary.active}</Chip><Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="history">历史记录 <Chip size="sm">{summary.history}</Chip><Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer></Tabs.Root></>}
        >
        <div className="flex min-h-full flex-col gap-3 p-4">
            {error ? <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>任务请求失败</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
            <div className="min-w-0 flex-1">
                {loading && !tasks.length ? <div className="flex flex-col gap-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-lg" />)}</div> : null}
                {!loading && !visible.length ? <div className="flex min-h-64 items-center justify-center"><EmptyState><Stopwatch /><p>暂无任务</p></EmptyState></div> : null}
                {!loading && visible.length ? <Table.Root variant="secondary" className="min-w-[760px]">
                    <Table.Content>
                        <Table.Header>
                            <Table.Column isRowHeader>任务</Table.Column>
                            <Table.Column>进度</Table.Column>
                            <Table.Column>状态</Table.Column>
                            <Table.Column>更新时间</Table.Column>
                            <Table.Column>操作</Table.Column>
                        </Table.Header>
                        <Table.Body>
                            {visible.map((task) => {
                                const kind = getKind(task);
                                const [label, color] = getStatus(task.status);
                                const progress = Math.max(0, Math.min(100, task.progress_percent));
                                return <Table.Row key={task.id}>
                                    <Table.Cell><div className="flex min-w-0 items-start gap-3"><Chip color={color} variant="soft" size="lg" className="shrink-0">{kind.icon}</Chip><div className="min-w-0 space-y-0.5"><p className="truncate font-medium">{task.title}</p><p className="truncate text-sm text-muted">{kind.label} · {task.library_name || "未关联媒体库"}</p>{task.error_message ? <p className="line-clamp-2 text-sm text-danger" title={task.error_message}>{task.error_message}</p> : task.detail ? <p className="line-clamp-2 text-sm text-muted" title={task.detail}>{task.detail}</p> : null}</div></div></Table.Cell>
                                    <Table.Cell><div className="flex min-w-40 items-center gap-2"><ProgressBar className="min-w-0 flex-1" value={progress} maxValue={100} color={color} size="sm" aria-label="任务进度" /><span className="w-10 shrink-0 text-right text-sm tabular-nums">{progress}%</span></div><p className="mt-1 text-xs text-muted">{formatDuration(task.created_at, activeTask(task) ? null : task.finished_at, now)}</p></Table.Cell>
                                    <Table.Cell><Chip color={color} variant="soft" size="sm">{label}</Chip></Table.Cell>
                                    <Table.Cell><time>{formatTime(task.updated_at)}</time></Table.Cell>
                                    <Table.Cell><div className="flex items-center justify-end gap-1">
                                        <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly aria-label="查看详情" onPress={() => setDetailTask(task)}><CircleInfo /></Button></Tooltip.Trigger><Tooltip.Content>查看详情</Tooltip.Content></Tooltip>
                                        {task.status === "failed" && task.kind === "generate_cache" ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly aria-label="重试失败项" isDisabled={acting === task.id} onPress={() => void retry(task.id)}><ArrowsRotateRight /></Button></Tooltip.Trigger><Tooltip.Content>重试失败项</Tooltip.Content></Tooltip> : null}
                                        {(task.status === "queued" || task.status === "running") ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly aria-label="暂停" isDisabled={acting === task.id} onPress={() => void run(task.id, "pause")}><CirclePause /></Button></Tooltip.Trigger><Tooltip.Content>暂停</Tooltip.Content></Tooltip> : null}
                                        {task.status === "paused" ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly aria-label="继续" onPress={() => void run(task.id, "resume")}><CirclePlay /></Button></Tooltip.Trigger><Tooltip.Content>继续</Tooltip.Content></Tooltip> : null}
                                        {activeTask(task) ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly aria-label="取消" onPress={() => void run(task.id, "cancel")}><CircleStop /></Button></Tooltip.Trigger><Tooltip.Content>取消</Tooltip.Content></Tooltip> : null}
                                        {!activeTask(task) ? <Tooltip><Tooltip.Trigger><Button size="sm" variant="ghost" isIconOnly aria-label="删除" onPress={() => setDeleteId(task.id)}><TrashBin /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip> : null}
                                    </div></Table.Cell>
                                </Table.Row>;
                            })}
                        </Table.Body>
                    </Table.Content>
                </Table.Root> : null}
            </div>
            <Modal isOpen={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
                <Modal.Backdrop variant="blur"><Modal.Container placement="center"><Modal.Dialog><Modal.Header><Modal.Heading>删除任务记录</Modal.Heading></Modal.Header><Modal.Body>删除后无法恢复。</Modal.Body><Modal.Footer><Button variant="secondary" onPress={() => setDeleteId(null)}>取消</Button><Button variant="danger" isDisabled={deleting} onPress={async () => { if (deleteId) { setDeleting(true); try { await deleteTask(deleteId); setDeleteId(null); await load(); } finally { setDeleting(false); } } }}>删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
            </Modal>
            <Modal isOpen={detailTask !== null} onOpenChange={(open) => !open && setDetailTask(null)}>
                <Modal.Backdrop variant="blur"><Modal.Container placement="center"><Modal.Dialog><Modal.Header><Modal.Heading>任务详情</Modal.Heading></Modal.Header><Modal.Body>
                    {detailTask ? <div className="space-y-3"><p className="font-medium">{detailTask.title}</p><p className="text-sm text-muted">{detailTask.detail || "无处理详情"}</p>{detailErrors.length ? <div className="space-y-1"><p className="font-medium">错误记录（{detailErrors.length}）</p><ol className="list-decimal space-y-1 pl-5 text-sm text-danger">{detailErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ol></div> : <p className="text-sm text-muted">未记录错误。</p>}</div> : null}
                </Modal.Body><Modal.Footer><Button variant="secondary" onPress={() => setDetailTask(null)}>关闭</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
            </Modal>
        </div>
        </ContentPageLayout>
    );
}
