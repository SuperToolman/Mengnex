"use client";

import { Check, FaceRobot, PaperPlane, Xmark } from "@gravity-ui/icons";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import ContentPageLayout from "@/app/components/ContentPageLayout";
import { createAgentSession, decideAgentApproval, getAgentSessions, sendAgentSessionMessage, type AgentApproval, type AgentChatMessage } from "@/src/features/agent/api";

export default function AgentPage() {
    const [messages, setMessages] = useState<AgentChatMessage[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingApproval, setPendingApproval] = useState<AgentApproval | null>(null);

    useEffect(() => {
        void getAgentSessions().then(({ sessions }) => {
            const latest = sessions[0];
            if (!latest) return;
            setSessionId(latest.id);
            setMessages(latest.messages.filter((message) => message.role !== "system"));
        }).catch(() => undefined);
    }, []);

    async function send() {
        const content = input.trim();
        if (!content || sending) return;
        const next = [...messages, { role: "user" as const, content }];
        setMessages(next);
        setInput("");
        setError(null);
        setSending(true);
        try {
            let activeSessionId = sessionId;
            if (!activeSessionId) {
                const created = await createAgentSession(content.slice(0, 48));
                activeSessionId = created.id;
                setSessionId(activeSessionId);
            }
            const response = await sendAgentSessionMessage(activeSessionId, content);
            setMessages([...next, { role: "assistant", content: response.content }]);
            setPendingApproval(response.approval ?? null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Agent 请求失败");
        } finally {
            setSending(false);
        }
    }

    async function decideApproval(decision: "approve" | "reject") {
        if (!pendingApproval || sending) return;
        setSending(true);
        setError(null);
        try {
            const result = await decideAgentApproval(pendingApproval.id, decision);
            setMessages((current) => [...current, { role: "assistant", content: decision === "approve" ? `已批准并执行 ${result.approval.toolName}。` : `已拒绝 ${result.approval.toolName}。` }]);
            setPendingApproval(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "审批操作失败");
        } finally {
            setSending(false);
        }
    }

    return <ContentPageLayout title="Agent" description="使用已配置的模型探索媒体库。当前对话只调用模型，不会自动修改媒体数据。">
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex max-w-[1280px] mx-auto flex-1 flex-col gap-3 overflow-auto">
                {messages.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted"><FaceRobot className="h-10 w-10" /><p className="text-sm">告诉 Agent 你想了解什么。</p></div> : null}
                {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "self-end bg-accent text-accent-foreground" : "self-start bg-default text-foreground"}`}><p className="mb-1 text-xs opacity-60">{message.role === "user" ? "你" : "Agent"}</p><p className="whitespace-pre-wrap">{message.content}</p></div>)}
                {pendingApproval ? <div className="max-w-[85%] self-start rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"><p className="font-medium">等待批准</p><p className="mt-1 text-muted">{pendingApproval.toolName} · {pendingApproval.risk}</p><pre className="mt-2 overflow-auto rounded-md bg-background/60 p-2 text-xs">{JSON.stringify(pendingApproval.args, null, 2)}</pre><div className="mt-3 flex gap-2"><Button size="sm" className="bg-accent text-accent-foreground" isDisabled={sending} onPress={() => void decideApproval("approve")}><Check />批准执行</Button><Button size="sm" className="border border-danger/40 text-danger" isDisabled={sending} onPress={() => void decideApproval("reject")}><Xmark />拒绝</Button></div></div> : null}
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <form className="flex items-end gap-3" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="输入消息..." rows={2} className="min-h-12 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" /><Button type="submit" isDisabled={sending || !input.trim()} isIconOnly aria-label="发送消息"><PaperPlane /></Button></form>
        </div>
    </ContentPageLayout>;
}
