import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";
import type { AssistantBlock, ContentBlock, ConversationTurn, ToolCallBlock } from "./conversation.js";
import type { ToolCallRecord } from "./agent-loop.js";

export type AgentSession = { id: string; title: string; createdAt: string; updatedAt: string; closedAt?: string; archivedAt?: string; turns: ConversationTurn[] };
export type SessionHeader = { type: "session"; version: 0; id: string; createdAt: number; cwd: string; delegationDepth: 0 };
type SessionEvent = { type: string; seq: number; time: number; data: Record<string, unknown>; surfaceOp?: "append"; sourceEventSeqs?: number[] };
type StoredSession = { header: SessionHeader; events: SessionEvent[]; userId: string; title: string; closedAt?: string; archivedAt?: string };
type ChatResult = { status: "completed" | "approval_required"; model: string; blocks: AssistantBlock[]; toolCalls: ToolCallRecord[] };

const sessionsRoot = join(process.cwd(), "data", "sessions");
const logName = "session.jsonl";
const knownEventTypes = new Set(["session/owner", "session/title", "session/archived", "session/closed", "turn/start", "turn/end", "step/start", "step/end", "user/message", "assistant/message", "tool/call", "tool/result"]);
const liveOwners = new Map<string, symbol>();

declare module "cordis" { interface Context { sessions: SessionStore; } }

/** DSH-style versioned append-only JSONL session store. */
export class SessionStore extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private sessions = new Map<string, StoredSession>();
  private writeQueues = new Map<string, Promise<void>>();
  private readonly ownerToken = Symbol("session-store");
  constructor(ctx: Context, private readonly rootDir = sessionsRoot) { super(ctx, "sessions"); }

  async load() {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const loaded = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => this.readLog(join(this.rootDir, entry.name, logName))));
    for (const session of loaded) this.claim(session.header.id);
    this.sessions = new Map(loaded.map((session) => [session.header.id, session]));
  }

  list(userId: string, archived = false) { return [...this.sessions.values()].filter((session) => session.userId === userId && Boolean(session.archivedAt) === archived && !session.closedAt).sort((a, b) => lastEventTime(b).localeCompare(lastEventTime(a))).map(projectSession); }

  async create(userId: string, title = "新对话") {
    const id = crypto.randomUUID(); const now = Date.now();
    const header: SessionHeader = { type: "session", version: 0, id, createdAt: now, cwd: process.cwd(), delegationDepth: 0 };
    const events = [event("session/owner", 0, now, { userId }), event("session/title", 1, now, { title })];
    const stored = { header, events, userId, title } satisfies StoredSession;
    const directory = this.sessionDir(id); await mkdir(directory, { recursive: false });
    await writeFile(join(directory, logName), `${JSON.stringify(header)}\n${events.map((item) => JSON.stringify(item)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    this.claim(id); this.sessions.set(id, stored); return projectSession(stored);
  }

  getOwned(id: string, userId: string) { return projectSession(this.requireOwned(id, userId)); }
  async archive(id: string, userId: string, archived: boolean) {
    const session = this.requireOwned(id, userId, true);
    if (session.closedAt) throw new Error("closed session cannot be archived");
    await this.enqueue(session, () => [event("session/archived", session.events.length, Date.now(), { archived })], (events) => { if (events.length) session.archivedAt = archived ? new Date(events[0].time).toISOString() : undefined; });
    await this.flush(id);
    return projectSession(session);
  }
  async flush(id?: string) { if (id) { await (this.writeQueues.get(id) ?? Promise.resolve()); return; } await Promise.all([...this.writeQueues.values()]); }
  async close(id: string, userId: string) {
    const session = this.requireOwned(id, userId, true);
    if (session.closedAt) return projectSession(session);
    // Fence work first: cancelled jobs cannot emit more lifecycle events after close resolves.
    await this.ctx.jobs?.cancelBySession(id, "session closed");
    await this.enqueue(session, () => {
      if (session.closedAt) return [];
      const now = Date.now(); return [event("session/closed", session.events.length, now, { reason: "user_closed" })];
    }, (events) => { if (events.length) session.closedAt = new Date(events[0].time).toISOString(); });
    await this.flush(id);
    return projectSession(session);
  }

  async appendInteraction(id: string, userId: string, content: string, result: ChatResult) {
    const session = this.requireOwned(id, userId);
    await this.enqueue(session, () => interactionEvents(session, content, result), (events) => { const title = events.find((item) => item.type === "session/title")?.data.title; if (typeof title === "string") session.title = title; });
    return projectSession(session);
  }

  async dispose() { await this.flush(); for (const id of this.sessions.keys()) if (liveOwners.get(id) === this.ownerToken) liveOwners.delete(id); }
  private requireOwned(id: string, userId: string, allowClosed = false) { const session = this.sessions.get(id); if (!session || session.userId !== userId) throw new Error("agent session not found"); if (session.closedAt && !allowClosed) throw new Error("agent session is closed"); return session; }
  private claim(id: string) { const current = liveOwners.get(id); if (current && current !== this.ownerToken) throw new Error(`session ${id} is already owned by another live session store`); liveOwners.set(id, this.ownerToken); }
  private sessionDir(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid session id"); return join(this.rootDir, id); }
  private async enqueue(session: StoredSession, build: () => SessionEvent[], committed?: (events: SessionEvent[]) => void) {
    const id = session.header.id; const path = join(this.sessionDir(id), logName); const queued = this.writeQueues.get(id) ?? Promise.resolve();
    const write = queued.catch(() => undefined).then(async () => { const events = build(); if (!events.length) return; events.forEach((item, index) => { if (item.seq !== session.events.length + index) throw new Error(`non-monotonic session event sequence for ${id}`); }); await appendFile(path, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 }); session.events.push(...events); committed?.(events); });
    this.writeQueues.set(id, write); try { await write; } finally { if (this.writeQueues.get(id) === write) this.writeQueues.delete(id); }
  }
  private async readLog(path: string): Promise<StoredSession> {
    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean); if (!lines.length) throw new Error(`empty session log: ${path}`);
    const header = JSON.parse(lines[0]) as SessionHeader; if (header.type !== "session" || header.version !== 0 || !header.id || !Number.isSafeInteger(header.createdAt)) throw new Error(`unsupported or corrupt session header: ${path}`);
    const events = lines.slice(1).map((line) => JSON.parse(line) as SessionEvent); events.forEach((item, index) => validateEvent(item, index, path));
    const owner = events.find((item) => item.type === "session/owner")?.data.userId; const title = events.filter((item) => item.type === "session/title").at(-1)?.data.title;
    const closed = events.filter((item) => item.type === "session/closed").at(-1); const archived = events.filter((item) => item.type === "session/archived").at(-1); const archivedAt = archived?.data.archived === true ? new Date(archived.time).toISOString() : undefined;
    if (typeof owner !== "string" || typeof title !== "string") throw new Error(`session log lacks owner or title: ${path}`); return { header, events, userId: owner, title, ...(closed ? { closedAt: new Date(closed.time).toISOString() } : {}), ...(archivedAt ? { archivedAt } : {}) };
  }
}

function event(type: string, seq: number, time: number, data: Record<string, unknown>, surface?: Pick<SessionEvent, "surfaceOp" | "sourceEventSeqs">): SessionEvent { return { type, seq, time, data, ...surface }; }
function interactionEvents(session: StoredSession, content: string, result: ChatResult) {
  if (session.closedAt) throw new Error("agent session is closed");
  const turn = session.events.filter((item) => item.type === "turn/start").length + 1; const step = 1; const startedAt = Date.now(); const next = session.events.length;
  const titleEvent = session.title === "新对话" ? [event("session/title", next, startedAt, { title: content.replace(/\s+/g, " ").trim().slice(0, 48) || "新对话" })] : [];
  const offset = titleEvent.length;
  const events: SessionEvent[] = [...titleEvent, event("turn/start", next + offset, startedAt, { turn }), event("step/start", next + offset + 1, startedAt, { turn, step }), event("user/message", next + offset + 2, startedAt, dshUserMessage(crypto.randomUUID(), content), { surfaceOp: "append" }), event("assistant/message", next + offset + 3, Date.now(), { turn, step, message: dshAssistantMessage(crypto.randomUUID(), result.model, result.blocks) }, { surfaceOp: "append" })];
  for (const call of result.toolCalls) { events.push(event("tool/call", next + events.length, isoTime(call.createdAt), { turn, step, callId: call.id, name: call.toolName, arguments: JSON.stringify(call.args), meta: { executionState: call.executionState, ...(call.correlationId ? { correlationId: call.correlationId } : {}) } })); if (call.status === "completed") events.push(event("tool/result", next + events.length, isoTime(call.completedAt ?? call.createdAt), { turn, step, message: dshToolResultMessage(call.id, call.result), meta: { status: call.status, executionState: call.executionState, result: call.result, completedAt: call.completedAt, ...(call.correlationId ? { correlationId: call.correlationId } : {}) } }, { surfaceOp: "append" })); }
  events.push(event("step/end", next + events.length, Date.now(), { turn, step }), event("turn/end", next + events.length + 1, Date.now(), { turn, reason: result.status === "completed" ? { kind: "completed" } : { kind: "blocked" } })); return events;
}
function validateEvent(item: SessionEvent, index: number, path: string) { if (!knownEventTypes.has(item.type) || item.seq !== index || !Number.isSafeInteger(item.time) || !item.data || typeof item.data !== "object") throw new Error(`corrupt session event ${index}: ${path}`); }
function projectSession(session: StoredSession): AgentSession {
  const turns = new Map<number, ConversationTurn>();
  let currentTurn: ConversationTurn | undefined;
  for (const item of session.events) {
    const turn = numberValue(item.data.turn); if (item.type === "turn/start" && turn !== undefined) { turns.set(turn, { id: `${session.header.id}:${turn}`, createdAt: new Date(item.time).toISOString(), user: { content: [] }, assistant: { content: [], model: "", status: "completed" } }); currentTurn = turns.get(turn); continue; }
    const target = turn === undefined ? currentTurn : turns.get(turn); if (!target) continue;
    if (item.type === "user/message") target.user.content = contentBlocks(item.data.content);
    if (item.type === "assistant/message") { const message = recordValue(item.data.message); target.assistant.content = assistantBlocks(message?.content); target.assistant.model = stringValue(recordValue(message?.source)?.model) ?? "unknown"; }
    if (item.type === "tool/result") applyToolResult(target, item);
    if (item.type === "turn/end" && recordValue(item.data.reason)?.kind === "blocked") target.assistant.status = "approval_required";
  }
  return { id: session.header.id, title: session.title, createdAt: new Date(session.header.createdAt).toISOString(), updatedAt: lastEventTime(session), ...(session.closedAt ? { closedAt: session.closedAt } : {}), ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}), turns: [...turns.values()] };
}
function dshUserMessage(id: string, text: string) { return { id, role: "user", source: { kind: "user" }, content: [{ type: "text", text }] }; }
function dshAssistantMessage(id: string, model: string, blocks: AssistantBlock[]) { return { id, role: "assistant", source: { kind: "model", provider: "openai-compatible", model }, content: blocks.map((block) => block.type === "tool-call" ? { type: "tool-call", id: block.callId, name: block.name, arguments: JSON.stringify(block.args) } : block) }; }
function dshToolResultMessage(callId: string, result: unknown) { return { id: crypto.randomUUID(), role: "user", source: { kind: "tool", callId }, content: [{ type: "tool-result", toolCallId: callId, isError: false, content: [{ type: "text", text: JSON.stringify(result ?? null) }] }] }; }
function contentBlocks(value: unknown): ContentBlock[] { if (!Array.isArray(value)) return []; return value.flatMap((item) => { const block = recordValue(item); const type = stringValue(block?.type); const text = stringValue(block?.text); return (type === "text" || type === "reasoning") && text !== undefined ? [{ type, text }] : []; }); }
function assistantBlocks(value: unknown): AssistantBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<AssistantBlock>((item) => {
    const block = recordValue(item);
    if (!block) return [];
    const type = stringValue(block.type);
    if ((type === "text" || type === "reasoning") && typeof block.text === "string") return [{ type, text: block.text }];
    if (type !== "tool-call") return [];
    const id = stringValue(block.id);
    const name = stringValue(block.name);
    return id && name ? [{ type: "tool-call", callId: id, name, args: parseArgs(stringValue(block.arguments)), status: "completed", startedAt: new Date().toISOString() }] : [];
  });
}
function applyToolResult(turn: ConversationTurn, event: SessionEvent) { const callId = stringValue(recordValue(recordValue(event.data.message)?.source)?.callId); const meta = recordValue(event.data.meta); const block = turn.assistant.content.find((item): item is ToolCallBlock => item.type === "tool-call" && item.callId === callId); if (!block) return; block.status = meta?.status === "approval_required" ? "approval_required" : "completed"; block.result = meta?.result; block.completedAt = stringValue(meta?.completedAt) ?? new Date(event.time).toISOString(); }
function lastEventTime(session: StoredSession) { return new Date(session.events.at(-1)?.time ?? session.header.createdAt).toISOString(); }
function isoTime(value: string) { const time = Date.parse(value); return Number.isNaN(time) ? Date.now() : time; }
function recordValue(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown) { return typeof value === "string" ? value : undefined; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined; }
function parseArgs(value: string | undefined): Record<string, unknown> { try { const parsed = JSON.parse(value ?? "{}"); return recordValue(parsed) ?? {}; } catch { return {}; } }
