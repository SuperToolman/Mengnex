"use client";

import { Archive, ArrowRotateLeft } from "@gravity-ui/icons";
import { Button, Card } from "@heroui/react";
import { useEffect, useState } from "react";
import SettingsPage from "@/app/settings/components/SettingsPage";
import { archiveAgentSession, getArchivedAgentSessions, type AgentSession } from "@/src/features/agent/api";

export default function AgentArchivesPage() {
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { void getArchivedAgentSessions().then(({ sessions: value }) => setSessions(value)).catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取归档会话")).finally(() => setLoading(false)); }, []);
    async function restore(session: AgentSession) {
        setWorking(session.id); setError(null);
        try { await archiveAgentSession(session.id, false); setSessions((current) => current.filter((item) => item.id !== session.id)); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "恢复会话失败"); }
        finally { setWorking(null); }
    }
    return <SettingsPage group="Agent" title="归档会话" description="归档不会删除会话数据。恢复后会话将重新出现在 Agent 主列表中。" contentClassName="">
        {error ? <p className="mb-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        {loading ? <p className="py-10 text-center text-sm text-muted">正在加载...</p> : sessions.length === 0 ? <Card.Root variant="secondary"><Card.Content className="flex flex-col items-center gap-2 py-12 text-center"><Archive className="size-8 text-muted" /><p className="font-medium">暂无归档会话</p><p className="text-sm text-muted">在 Agent 会话列表中悬停并点击归档即可收纳会话。</p></Card.Content></Card.Root> : <div className="grid gap-3 md:grid-cols-2">{sessions.map((session) => <Card.Root key={session.id} variant="secondary"><Card.Content className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{session.title || "新对话"}</p><p className="mt-1 text-xs text-muted">{session.turns.length} 条对话 · {new Date(session.updatedAt).toLocaleString()}</p></div><Button size="sm" variant="secondary" isDisabled={working === session.id} onPress={() => void restore(session)}><ArrowRotateLeft />恢复</Button></Card.Content></Card.Root>)}</div>}
    </SettingsPage>;
}
