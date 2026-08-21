import { appendFile, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";

export const AGENT_EVENT_SCHEMA_VERSION = 2 as const;
export type EventContext = { correlationId?: string; sessionId?: string; turnId?: string; toolCallId?: string; actorId?: string; pluginId?: string; parentJobId?: string; parentSubagentId?: string };
export type StructuredEventError = { code: string; message: string; retryable?: boolean };
export type EventOutcome = "started" | "completed" | "failed" | "cancelled" | "waiting";
export type TimedEvent = { durationMs?: number; outcome?: EventOutcome; error?: StructuredEventError };

export type AgentEventMap = {
  "audit": { action: string; entity: string; entityId?: string; outcome: EventOutcome; details?: Record<string, unknown> } & TimedEvent;
  "plugin:starting": { pluginId: string }; "plugin:started": { pluginId: string }; "plugin:stopping": { pluginId: string }; "plugin:stopped": { pluginId: string };
  "plugin:blocked": { pluginId: string; reason: string; error?: StructuredEventError }; "plugin:reloaded": { pluginId: string; revision: string }; "plugin:config-reloaded": { pluginId: string; revision: string }; "plugin:state-quarantined": { path: string; error: string };
  "tool:before": { name: string; args: Record<string, unknown> };
  "tool:after": { name: string; args: Record<string, unknown>; result?: unknown; error?: StructuredEventError; durationMs: number; outcome: "completed" | "failed" | "cancelled" };
  "tool:state": { name: string; state: import("./types.js").ToolExecutionState };
  "llm:completed": { providerId: string; model: string; profile?: string; durationMs: number; outcome: "completed" };
  "llm:failed": { providerId: string; model: string; profile?: string; durationMs: number; outcome: "failed"; error: StructuredEventError };
  "approval:decided": { approvalId: string; toolName: string; decision: "approve" | "reject"; waitMs: number; outcome: "completed" };
  "agent:turn": { turn: number; toolCount: number };
  "scheduler:queued": { job: unknown }; "scheduler:started": { job: unknown }; "scheduler:completed": { job: unknown }; "scheduler:retrying": { job: unknown; delayMs: number }; "scheduler:failed": { job: unknown }; "scheduler:cancelled": { job: unknown }; "scheduler:heartbeat": { job: unknown; message?: string }; "scheduler:checkpoint": { job: unknown }; "scheduler:waiting_review": { job: unknown; message?: string };
  "sandbox:completed": { result: unknown };
  "event:listener_failed": { eventName: string; listenerId: string; error: StructuredEventError };
};
export type AgentEventName = keyof AgentEventMap;
export type AgentEventEnvelope<K extends AgentEventName = AgentEventName> = { id: string; schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION; name: K; occurredAt: string; source: string; payload: AgentEventMap[K]; context: EventContext };
export type EventFilter = EventContext & { names?: AgentEventName[]; source?: string };
type Listener<K extends AgentEventName> = { id: string; filter: EventFilter; fn: (event: AgentEventEnvelope<K>) => void | Promise<void> };
type MetricBucket = { count: number; totalMs: number; minMs?: number; maxMs?: number };
export type ObservabilityMetrics = { llmLatency: MetricBucket; toolLatency: MetricBucket; retries: number; approvalWait: MetricBucket; failures: { total: number; byOperation: Record<string, number> } };

declare module "cordis" { interface Context { agentEvents: AgentEventService; } }

export class AgentEventService extends (cordis as any).Service {
  private readonly listeners = new Map<AgentEventName, Set<Listener<any>>>();
  private readonly eventPath: string; private readonly source: string; private sequence = 0; private writeQueue: Promise<void> = Promise.resolve(); private metrics: ObservabilityMetrics = emptyMetrics();
  constructor(ctx: Context, options: { filePath?: string; source?: string } = {}) { super(ctx, "agentEvents"); this.eventPath = options.filePath ?? join(process.cwd(), "data", "events.jsonl"); this.source = options.source ?? "agent"; }
  async load() {
    try { const events = await this.readPersisted(); this.sequence = events.length; this.metrics = emptyMetrics(); events.forEach((event) => this.recordMetrics(event)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; await this.quarantineCorruptLog(error); }
  }
  on<K extends AgentEventName>(name: K, listener: (event: AgentEventEnvelope<K>) => void | Promise<void>, filter: EventFilter = {}) { const id = this.source + ":listener:" + (++this.sequence) + ":" + String(name); const entry: Listener<K> = { id, filter, fn: listener }; const set = this.listeners.get(name) ?? new Set(); set.add(entry); this.listeners.set(name, set); return () => set.delete(entry); }
  subscribe<K extends AgentEventName>(name: K, listener: (event: AgentEventEnvelope<K>) => void | Promise<void>, filter: EventFilter = {}) { return this.on(name, listener, filter); }
  async emit<K extends AgentEventName>(name: K, payload: AgentEventMap[K], source = this.source, context: EventContext = {}) {
    const event: AgentEventEnvelope<K> = { id: crypto.randomUUID(), schemaVersion: AGENT_EVENT_SCHEMA_VERSION, name, occurredAt: new Date().toISOString(), source, payload, context };
    await this.append(event); this.recordMetrics(event); const failures: string[] = [];
    for (const listener of this.listeners.get(name) ?? []) { if (!matches(event, listener.filter)) continue; try { await listener.fn(event); } catch (error) { const message = error instanceof Error ? error.message : "event listener failed"; failures.push(listener.id); if (name !== "event:listener_failed") { const failed: AgentEventEnvelope<"event:listener_failed"> = { id: crypto.randomUUID(), schemaVersion: AGENT_EVENT_SCHEMA_VERSION, name: "event:listener_failed", occurredAt: new Date().toISOString(), source: this.source, payload: { eventName: String(name), listenerId: listener.id, error: { code: "EVENT_LISTENER_FAILED", message } }, context: event.context }; await this.append(failed); this.recordMetrics(failed); } } }
    return { event, failures };
  }
  async audit(action: string, entity: string, entityId?: string, details?: Record<string, unknown>, context: EventContext = {}) { const resolved = { correlationId: context.correlationId ?? crypto.randomUUID(), ...context }; await this.emit("audit", { action, entity, ...(entityId ? { entityId } : {}), outcome: "completed", ...(details ? { details } : {}) }, this.source, resolved); return resolved.correlationId!; }
  async replay(filter: EventFilter = {}, limit = 100) { return (await this.readPersisted()).filter((event) => matches(event, filter)).slice(-Math.max(1, Math.min(limit, 1000))); }
  snapshotMetrics(): ObservabilityMetrics { return structuredClone(this.metrics); }
  private async readPersisted(): Promise<AgentEventEnvelope[]> { try { const raw = await readFile(this.eventPath, "utf8"); const lines = raw.split(/\r?\n/).filter(Boolean); const events: AgentEventEnvelope[] = []; for (let index = 0; index < lines.length; index += 1) { let parsed: AgentEventEnvelope; try { parsed = JSON.parse(lines[index]) as AgentEventEnvelope; } catch (error) { throw new Error(`corrupt event log at line ${index + 1}: ${error instanceof Error ? error.message : "invalid JSON"}`); } if (parsed.schemaVersion !== AGENT_EVENT_SCHEMA_VERSION || !parsed.id || !parsed.name || !parsed.occurredAt || !parsed.source || !parsed.context || typeof parsed.context !== "object") throw new Error(`unsupported event schema at line ${index + 1}`); events.push(parsed); } return events; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
  private async quarantineCorruptLog(error: unknown) { const quarantine = `${this.eventPath}.corrupt-${Date.now()}`; await rename(this.eventPath, quarantine); this.sequence = 0; this.metrics = emptyMetrics(); process.stderr.write(`[agent-events] quarantined invalid event log (${error instanceof Error ? error.message : "unknown error"}) to ${quarantine}\n`); }
  private append(event: AgentEventEnvelope) { const write = this.writeQueue.catch(() => undefined).then(async () => { await mkdir(dirname(this.eventPath), { recursive: true }); await appendFile(this.eventPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 }); }); this.writeQueue = write; return write; }
  private recordMetrics(event: AgentEventEnvelope) { const payload = event.payload as TimedEvent; if (event.name === "llm:completed" || event.name === "llm:failed") addDuration(this.metrics.llmLatency, payload.durationMs); if (event.name === "tool:after") addDuration(this.metrics.toolLatency, payload.durationMs); if (event.name === "approval:decided") addDuration(this.metrics.approvalWait, (event.payload as AgentEventMap["approval:decided"]).waitMs); if (event.name === "scheduler:retrying") this.metrics.retries += 1; if (payload.outcome === "failed" || event.name === "scheduler:failed" || event.name === "plugin:blocked") { this.metrics.failures.total += 1; this.metrics.failures.byOperation[event.name] = (this.metrics.failures.byOperation[event.name] ?? 0) + 1; } }
}

function matches(event: AgentEventEnvelope, filter: EventFilter) { if (filter.names?.length && !filter.names.includes(event.name)) return false; if (filter.source && event.source !== filter.source) return false; const context = event.context ?? {}; return (["correlationId", "sessionId", "turnId", "toolCallId", "actorId", "pluginId", "parentJobId", "parentSubagentId"] as const).every((key) => filter[key] === undefined || context[key] === filter[key]); }
function emptyMetrics(): ObservabilityMetrics { return { llmLatency: { count: 0, totalMs: 0 }, toolLatency: { count: 0, totalMs: 0 }, retries: 0, approvalWait: { count: 0, totalMs: 0 }, failures: { total: 0, byOperation: {} } }; }
function addDuration(bucket: MetricBucket, durationMs: number | undefined) { if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return; bucket.count += 1; bucket.totalMs += durationMs; bucket.minMs = bucket.minMs === undefined ? durationMs : Math.min(bucket.minMs, durationMs); bucket.maxMs = bucket.maxMs === undefined ? durationMs : Math.max(bucket.maxMs, durationMs); }
