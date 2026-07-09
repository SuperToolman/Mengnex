"use client";

import { CircleInfo, Stopwatch } from "@gravity-ui/icons";
import { useEffect, useMemo, useState } from "react";
import {
    cancelTask,
    getTasks,
    pauseTask,
    resumeTask,
    type TaskResponse,
} from "@/src/api/client";

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "object" && error && "message" in error) {
        return String(error.message);
    }

    return "请求失败，请确认 API 服务已启动。";
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
        second: "2-digit",
    }).format(new Date(value));
}

function getStatusStyle(status: string) {
    switch (status) {
        case "running":
            return "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300";
        case "queued":
            return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
        case "paused":
            return "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300";
        case "completed":
            return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
        case "canceled":
            return "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
        case "failed":
            return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
        default:
            return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
    }
}

function getStatusLabel(status: string) {
    switch (status) {
        case "running":
            return "运行中";
        case "queued":
            return "排队中";
        case "paused":
            return "已暂停";
        case "completed":
            return "已完成";
        case "canceled":
            return "已取消";
        case "failed":
            return "失败";
        default:
            return status;
    }
}

function getKindLabel(kind: TaskResponse["kind"]) {
    switch (kind) {
        case "scan_library":
            return "媒体库扫描";
        case "generate_cache":
            return "缓存生成";
        default:
            return kind;
    }
}

export default function TasksPage() {
    const [tasks, setTasks] = useState<TaskResponse[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [actingTaskId, setActingTaskId] = useState<string | null>(null);

    async function loadTasks() {
        try {
            const taskData = await getTasks();
            setTasks(taskData);
            setError(null);
        } catch (loadError) {
            setError(getErrorMessage(loadError));
        } finally {
            setIsLoading(false);
        }
    }

    async function runTaskAction(
        taskId: string,
        action: "pause" | "resume" | "cancel",
    ) {
        setActingTaskId(taskId);

        try {
            if (action === "pause") {
                await pauseTask(taskId);
            } else if (action === "resume") {
                await resumeTask(taskId);
            } else {
                await cancelTask(taskId);
            }

            await loadTasks();
        } catch (actionError) {
            setError(getErrorMessage(actionError));
        } finally {
            setActingTaskId(null);
        }
    }

    useEffect(() => {
        void loadTasks();

        const timer = window.setInterval(() => {
            void loadTasks();
        }, 1500);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const summary = useMemo(() => {
        return {
            total: tasks.length,
            active: tasks.filter((task) =>
                task.status === "queued" || task.status === "running" || task.status === "paused"
            ).length,
            failed: tasks.filter((task) => task.status === "failed").length,
        };
    }, [tasks]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div>
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                    任务
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-100">任务中心</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                    在这里统一查看媒体库扫描、缓存生成以及其他后台任务的进度。
                </p>
            </div>

            {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white/70 px-5 py-4 shadow-sm backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/30">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">任务总数</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-100">{summary.total}</p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white/70 px-5 py-4 shadow-sm backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/30">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">进行中</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-100">{summary.active}</p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white/70 px-5 py-4 shadow-sm backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/30">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">失败任务</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-100">{summary.failed}</p>
                </div>
            </div>

            <div className="mt-6 min-h-0 flex-1 overflow-auto">
                {isLoading && tasks.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-900/25 dark:text-slate-400">
                        正在加载任务...
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center dark:border-slate-600 dark:bg-slate-900/25">
                        <Stopwatch className="h-7 w-7 text-slate-400 dark:text-slate-500" />
                        <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">暂时还没有任务</p>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            当扫描或缓存生成任务开始后，会显示在这里。
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {tasks.map((task) => (
                            <div
                                key={task.id}
                                className="rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-sm backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/30"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                                {getKindLabel(task.kind)}
                                            </span>
                                            <span
                                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusStyle(task.status)}`}
                                            >
                                                {getStatusLabel(task.status)}
                                            </span>
                                        </div>
                                        <h2 className="mt-3 text-base font-semibold text-slate-950 dark:text-slate-100">
                                            {task.title}
                                        </h2>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                            {task.library_name ?? "未关联媒体库"}
                                        </p>
                                    </div>
                                    <div className="text-right text-xs text-slate-400 dark:text-slate-500">
                                        <p>更新时间</p>
                                        <p className="mt-1">{formatDate(task.updated_at)}</p>
                                    </div>
                                </div>

                                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                    <div
                                        className={`h-full rounded-full transition-[width] duration-300 ${
                                            task.status === "failed"
                                                ? "bg-red-500"
                                                : task.status === "paused"
                                                    ? "bg-violet-500"
                                                    : task.status === "canceled"
                                                        ? "bg-slate-400"
                                                        : "bg-sky-500"
                                        }`}
                                        style={{ width: `${task.progress_percent}%` }}
                                    />
                                </div>

                                <div className="mt-3 grid gap-3 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-3">
                                    <div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">进度</p>
                                        <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                                            {task.progress_percent}%
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">已处理</p>
                                        <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                                            {task.processed_items} / {task.total_items}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">完成时间</p>
                                        <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                                            {formatDate(task.finished_at)}
                                        </p>
                                    </div>
                                </div>

                                {task.detail ? (
                                    <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                                        {task.detail}
                                    </div>
                                ) : null}

                                {task.error_message ? (
                                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-300">
                                        <div className="flex items-start gap-2">
                                            <CircleInfo className="mt-0.5 h-4 w-4 shrink-0" />
                                            <span>{task.error_message}</span>
                                        </div>
                                    </div>
                                ) : null}

                                {task.status === "queued" || task.status === "running" || task.status === "paused" ? (
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {(task.status === "queued" || task.status === "running") ? (
                                            <button
                                                type="button"
                                                className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                                                disabled={actingTaskId === task.id}
                                                onClick={() => void runTaskAction(task.id, "pause")}
                                            >
                                                暂停
                                            </button>
                                        ) : null}
                                        {task.status === "paused" ? (
                                            <button
                                                type="button"
                                                className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:border-sky-400 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:border-sky-600 dark:hover:bg-sky-500/20"
                                                disabled={actingTaskId === task.id}
                                                onClick={() => void runTaskAction(task.id, "resume")}
                                            >
                                                恢复
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            className="rounded-full border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:border-red-600 dark:hover:bg-red-500/10"
                                            disabled={actingTaskId === task.id}
                                            onClick={() => void runTaskAction(task.id, "cancel")}
                                        >
                                            取消
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
