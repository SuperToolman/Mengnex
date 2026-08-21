"use client";

import {
  Check,
  CircleCheck,
  CirclePlus,
  FaceRobot,
  PaperPlane,
  Xmark,
} from "@gravity-ui/icons";
import {
  Button,
  Card,
  ListBox,
  ScrollShadow,
  SearchField,
  Select,
  TextArea,
  TextField,
} from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import ContentPageLayout from "@/app/components/ContentPageLayout";
import AgentMarkdown from "./components/AgentMarkdown";
import { AssistantMessage } from "./components/AgentMessage";
import { SessionItem } from "./components/SessionItem";
import { textBlocks, type RenderedMessage } from "./components/types";
import {
  createAgentSession,
  decideAgentApproval,
  getAgentSessions,
  streamAgentSessionMessage,
  type AgentApproval,
  type AgentExecutionMode,
  type AgentSession,
  type AgentStreamEvent,
  type AgentTurn,
} from "@/src/features/agent/api";

const json = (value: unknown) => JSON.stringify(value, null, 2);
const turnsOf = (session: AgentSession) =>
  Array.isArray(session.turns) ? session.turns : [];
const fromTurn = (turn: AgentTurn): RenderedMessage[] => [
  {
    id: `${turn.id}-user`,
    role: "user",
    content: turn.user?.content?.map((block) => block.text).join("") ?? "",
  },
  {
    id: `${turn.id}-assistant`,
    role: "assistant",
    content: textBlocks(turn.assistant?.content ?? []),
    blocks: turn.assistant?.content ?? [],
  },
];
const executionModes: Record<AgentExecutionMode, string> = {
  request_approval: "每次确认",
  approve_high_risk: "高风险确认",
  full_access: "完全访问",
};

export default function AgentPage() {
  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<AgentApproval | null>(
    null,
  );
  const [executionMode, setExecutionMode] =
    useState<AgentExecutionMode>("approve_high_risk");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setSessions((current) => current.filter((session) => session.id !== id));
      if (sessionId === id) {
        setSessionId(null);
        setMessages([]);
        setPendingApproval(null);
      }
    };
    window.addEventListener("agent-session-closed", handler);
    return () => window.removeEventListener("agent-session-closed", handler);
  }, [sessionId]);

  useEffect(() => {
    void getAgentSessions()
      .then(({ sessions: loaded }) => {
        const valid = loaded.filter((session) => Array.isArray(session.turns));
        setSessions(valid);
        const latest = valid[0];
        if (latest) {
          setSessionId(latest.id);
          setMessages(turnsOf(latest).flatMap(fromTurn));
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const saved = window.localStorage.getItem("mengnex.agent.execution-mode");
    if (saved && saved in executionModes)
      setExecutionMode(saved as AgentExecutionMode);
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, pendingApproval]);
  function updateStreaming(
    update: (message: RenderedMessage) => RenderedMessage,
  ) {
    setMessages((current) =>
      current.map((message, index) =>
        index === current.length - 1 && message.role === "assistant"
          ? update(message)
          : message,
      ),
    );
  }
  function applyEvent(event: AgentStreamEvent) {
    if (event.type === "reasoning-delta" || event.type === "text-delta")
      updateStreaming((message) => {
        const type = event.type === "reasoning-delta" ? "reasoning" : "text";
        const blocks = [...(message.blocks ?? [])];
        const last = blocks.at(-1);
        if (last?.type === type)
          blocks[blocks.length - 1] = { ...last, text: last.text + event.text };
        else blocks.push({ type, text: event.text });
        return { ...message, blocks, content: textBlocks(blocks) };
      });
    if (event.type === "tool/call")
      updateStreaming((message) => ({
        ...message,
        blocks: [
          ...(message.blocks ?? []),
          {
            type: "tool-call",
            callId: event.callId,
            name: event.name,
            args: event.args,
            status: "running",
            startedAt: new Date().toISOString(),
          },
        ],
      }));
    if (event.type === "tool/result")
      updateStreaming((message) => ({
        ...message,
        blocks: (message.blocks ?? []).map((block) =>
          block.type === "tool-call" && block.callId === event.callId
            ? {
              ...block,
              status: event.status,
              result: event.result,
              completedAt: new Date().toISOString(),
            }
            : block,
        ),
      }));
    if (event.type === "snapshot") {
      setPendingApproval(event.result.approval ?? null);
      updateStreaming((message) => ({
        ...message,
        content: event.result.content,
        blocks: event.result.blocks,
        streaming: false,
      }));
    }
  }
  function selectSession(session: AgentSession) {
    if (sending || session.id === sessionId) return;
    setSessionId(session.id);
    setMessages(turnsOf(session).flatMap(fromTurn));
    setPendingApproval(null);
    setError(null);
    setInput("");
  }
  function newSession() {
    if (sending) return;
    setSessionId(null);
    setMessages([]);
    setPendingApproval(null);
    setError(null);
    setInput("");
  }
  function changeExecutionMode(value: AgentExecutionMode) {
    setExecutionMode(value);
    window.localStorage.setItem("mengnex.agent.execution-mode", value);
  }
  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    let active = sessionId;
    setInput("");
    setError(null);
    setSending(true);
    try {
      if (!active) {
        const created = await createAgentSession();
        active = created.id;
        setSessionId(active);
      }
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          blocks: [],
          streaming: true,
        },
      ]);
      await streamAgentSessionMessage(
        active,
        content,
        executionMode,
        applyEvent,
      );
      const refreshed = await getAgentSessions();
      setSessions(refreshed.sessions);
    } catch (cause) {
      setMessages((current) => current.filter((message) => !message.streaming));
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
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            decision === "approve"
              ? `已批准并执行 \`${result.approval.toolName}\`。`
              : `已拒绝 \`${result.approval.toolName}\`。`,
        },
      ]);
      setPendingApproval(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审批操作失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <ContentPageLayout
      title="Agent"
      description="使用已配置的模型探索媒体库。当前对话只调用模型，不会自动修改媒体数据。"
    >
      <div className="flex h-full min-h-0">
        <Card.Root className="flex w-56 shrink-0 flex-col overflow-hidden">
          <Card.Header>
            <Card.Title>会话</Card.Title>
          </Card.Header>
          <Card.Content className="min-h-0 flex-1">
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="w-full"
                onPress={() => void newSession()}
                isDisabled={sending}
              >
                <CirclePlus />
                新会话
              </Button>
              <SearchField
                value={sessionQuery}
                onChange={setSessionQuery}
                aria-label="搜索会话"
                className="w-full"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="搜索会话..." />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            </div>
            <ScrollShadow className="mt-3 h-[calc(100%-5.5rem)]" hideScrollBar>
              {sessions.filter((session) =>
                `${session.title || "新对话"} ${turnsOf(session).length}`
                  .toLowerCase()
                  .includes(sessionQuery.trim().toLowerCase()),
              ).length === 0 ? (
                <p className="p-3 text-center text-xs text-muted">
                  {sessionQuery ? "没有匹配的会话" : "暂无会话"}
                </p>
              ) : (
                sessions
                  .filter((session) =>
                    `${session.title || "新对话"} ${turnsOf(session).length}`
                      .toLowerCase()
                      .includes(sessionQuery.trim().toLowerCase()),
                  )
                  .map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === sessionId}
                      disabled={sending}
                      onSelect={() => selectSession(session)}
                    />
                  ))
              )}
            </ScrollShadow>
          </Card.Content>
        </Card.Root>
        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          <ScrollShadow
            className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto max-w-5xl m-auto gap-3"
            hideScrollBar
          >
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted">
                <FaceRobot className="size-10" />
                <p className="text-sm">告诉 Agent 你想了解什么。</p>
              </div>
            ) : null}
            {messages.map((message) =>
              message.role === "user" ? (
                <Card.Root
                  key={message.id}
                  variant="tertiary"
                  className="shrink-0 self-end overflow-hidden bg-accent leading-6"
                >
                  <Card.Content className="min-w-0">
                    <AgentMarkdown content={message.content} />
                  </Card.Content>
                </Card.Root>
              ) : (
                <AssistantMessage key={message.id} message={message} />
              ),
            )}
            {pendingApproval ? (
              <Card.Root
                variant="secondary"
                className="w-full max-w-2xl shrink-0 self-start"
              >
                <Card.Content>
                  <div className="flex items-center gap-2 font-medium">
                    <CircleCheck className="text-warning" />
                    等待批准
                  </div>
                  <p className="mt-1 text-muted">
                    {pendingApproval.toolName} · {pendingApproval.risk}
                  </p>
                  <pre>{json(pendingApproval.args)}</pre>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="bg-accent text-accent-foreground"
                      isDisabled={sending}
                      onPress={() => void decideApproval("approve")}
                    >
                      <Check />
                      批准执行
                    </Button>
                    <Button
                      size="sm"
                      isDisabled={sending}
                      onPress={() => void decideApproval("reject")}
                    >
                      <Xmark />
                      拒绝
                    </Button>
                  </div>
                </Card.Content>
              </Card.Root>
            ) : null}
            <div ref={endRef} />
          </ScrollShadow>
          <div>
            {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}

            <Card className="w-full max-w-5xl m-auto">
              <Card.Content>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  <TextField.Root value={input} onChange={setInput} fullWidth>
                    <TextArea
                      placeholder="输入消息..."
                      rows={2}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                  </TextField.Root>
                  <div className="mt-2 flex items-center justify-between">
                    <Select.Root
                      aria-label="执行策略"
                      selectedKey={executionMode}
                      onSelectionChange={(key) =>
                        key &&
                        changeExecutionMode(String(key) as AgentExecutionMode)
                      }
                    >
                      <Select.Trigger className="h-8 w-36 text-xs">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {(
                            Object.keys(executionModes) as AgentExecutionMode[]
                          ).map((mode) => (
                            <ListBox.Item
                              key={mode}
                              id={mode}
                              textValue={executionModes[mode]}
                            >
                              {executionModes[mode]}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select.Root>
                    <Button
                      type="submit"
                      isDisabled={sending || !input.trim()}
                      isIconOnly
                      aria-label="发送消息"
                    >
                      <PaperPlane />
                    </Button>
                  </div>
                </form>
              </Card.Content>
            </Card>


          </div>
        </div>
      </div>
    </ContentPageLayout>
  );
}
