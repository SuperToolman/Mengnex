"use client";

import { CircleInfo, Stopwatch } from "@gravity-ui/icons";
import { useEffect, useMemo, useState } from "react";
import { getTasks, type TaskResponse } from "@/src/api/client";

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
            return "bg-sky-100 text-sky-700";
        case "queued":
            return "bg-amber-100 text-amber-700";
        case "completed":
            return "bg-emerald-100 text-emerald-700";
        case "failed":
            return "bg-red-100 text-red-700";
        default:
            return "bg-slate-100 text-slate-600";
    }
}

function getStatusLabel(status: string) {
    switch (status) {
        case "running":
            return "进行中";
        case "queued":
            return "排队中";
        case "completed":
            return "已完成";
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
            active: tasks.filter((task) => task.status === "queued" || task.status === "running")
                .length,
            failed: tasks.filter((task) => task.status === "failed").length,
        };
    }, [tasks]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div>
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                    任务
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">任务中心</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
                    统一查看扫描、缓存生成等后台任务。后续上传媒体库、下载等长任务也会继续接入这里。
                </p>
            </div>

            {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <p className="text-xs font-medium text-slate-500">任务总数</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{summary.total}</p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <p className="text-xs font-medium text-slate-500">进行中</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{summary.active}</p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <p className="text-xs font-medium text-slate-500">失败任务</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{summary.failed}</p>
                </div>
            </div>

            <div className="mt-6 min-h-0 flex-1 overflow-auto">
                {isLoading && tasks.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 text-sm text-slate-500">
                        正在加载任务...
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center">
                        <Stopwatch className="h-7 w-7 text-slate-400" />
                        <p className="mt-4 text-sm font-medium text-slate-700">暂无任务</p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                            当你重新扫描媒体库或生成缩略图时，任务会出现在这里。
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {tasks.map((task) => (
                            <div
                                key={task.id}
                                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                                {getKindLabel(task.kind)}
                                            </span>
                                            <span
                                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusStyle(task.status)}`}
                                            >
                                                {getStatusLabel(task.status)}
                                            </span>
                                        </div>
                                        <h2 className="mt-3 text-base font-semibold text-slate-950">
                                            {task.title}
                                        </h2>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {task.library_name ?? "未关联媒体库"}
                                        </p>
                                    </div>
                                    <div className="text-right text-xs text-slate-400">
                                        <p>更新时间</p>
                                        <p className="mt-1">{formatDate(task.updated_at)}</p>
                                    </div>
                                </div>

                                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                                    <div
                                        className={`h-full rounded-full transition-[width] duration-300 ${
                                            task.status === "failed" ? "bg-red-500" : "bg-sky-500"
                                        }`}
                                        style={{ width: `${task.progress_percent}%` }}
                                    />
                                </div>

                                <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                                    <div>
                                        <p className="text-xs text-slate-400">进度</p>
                                        <p className="mt-1 font-medium text-slate-900">
                                            {task.progress_percent}%
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-400">处理数量</p>
                                        <p className="mt-1 font-medium text-slate-900">
                                            {task.processed_items} / {task.total_items}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-400">完成时间</p>
                                        <p className="mt-1 font-medium text-slate-900">
                                            {formatDate(task.finished_at)}
                                        </p>
                                    </div>
                                </div>

                                {task.detail ? (
                                    <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                                        {task.detail}
                                    </div>
                                ) : null}

                                {task.error_message ? (
                                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                        <div className="flex items-start gap-2">
                                            <CircleInfo className="mt-0.5 h-4 w-4 shrink-0" />
                                            <span>{task.error_message}</span>
                                        </div>
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
