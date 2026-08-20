import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";

export type AgentEventMap = {
  "plugin:starting": { pluginId: string };
  "plugin:started": { pluginId: string };
  "plugin:stopping": { pluginId: string };
  "plugin:stopped": { pluginId: string };
  "tool:before": { name: string; args: Record<string, unknown> };
  "tool:after": { name: string; args: Record<string, unknown>; result?: unknown; error?: string };
  "agent:turn": { turn: number; toolCount: number };
  "scheduler:queued": { job: unknown };
  "scheduler:started": { job: unknown };
  "scheduler:completed": { job: unknown };
  "scheduler:retrying": { job: unknown; delayMs: number };
  "scheduler:failed": { job: unknown };
  "scheduler:cancelled": { job: unknown };
  "sandbox:completed": { result: unknown };
  "event:listener_failed": { eventName: string; listenerId: string; error: string };
};

export type AgentEventName = keyof AgentEventMap;
export type AgentEventEnvelope<K extends AgentEventName = AgentEventName> = {
  id: string;
  version: 1;
  name: K;
  occurredAt: string;
  source: string;
  payload: AgentEventMap[K];
};
type Listener<K extends AgentEventName> = { id: string; fn: (event: AgentEventEnvelope<K>) => void | Promise<void> };
type EventFilter = { names?: AgentEventName[]; source?: string };

declare module "cordis" { interface Context { agentEvents: AgentEventService; } }

export class AgentEventService extends (cordis as any).Service {
  private readonly listeners = new Map<AgentEventName, Set<Listener<any>>>();
  private readonly eventPath: string;
  private readonly source: string;
  private sequence = 0;
  constructor(ctx: Context, options: { filePath?: string; source?: string } = {}) {
    super(ctx, "agentEvents");
    this.eventPath = options.filePath ?? join(process.cwd(), "data", "events.jsonl");
    this.source = options.source ?? "agent";
  }

  async load() {
    try { const lines = (await readFile(this.eventPath, "utf8")).split(/\r?\n/).filter(Boolean); this.sequence = lines.length; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  on<K extends AgentEventName>(name: K, listener: (event: AgentEventEnvelope<K>) => void | Promise<void>, filter?: EventFilter) {
    const id = this.source + ":" + (++this.sequence) + ":" + String(name);
    const entry: Listener<K> = { id, fn: listener };
    const set = this.listeners.get(name) ?? new Set(); set.add(entry); this.listeners.set(name, set);
    return () => set.delete(entry);
  }

  subscribe<K extends AgentEventName>(name: K, listener: (event: AgentEventEnvelope<K>) => void | Promise<void>, filter?: EventFilter) {
    return this.on(name, async (event) => { if (filter?.source && event.source !== filter.source) return; await listener(event); }, filter);
  }

  async emit<K extends AgentEventName>(name: K, payload: AgentEventMap[K], source = this.source) {
    const event: AgentEventEnvelope<K> = { id: crypto.randomUUID(), version: 1, name, occurredAt: new Date().toISOString(), source, payload };
    await this.append(event);
    const failures: string[] = [];
    for (const listener of this.listeners.get(name) ?? []) {
      try { await listener.fn(event); }
      catch (error) {
        const message = error instanceof Error ? error.message : "event listener failed";
        failures.push(listener.id);
        if (name !== "event:listener_failed") await this.append({ id: crypto.randomUUID(), version: 1, name: "event:listener_failed", occurredAt: new Date().toISOString(), source: this.source, payload: { eventName: String(name), listenerId: listener.id, error: message } });
      }
    }
    return { event, failures };
  }

  async replay(filter: EventFilter = {}, limit = 100) {
    try {
      const lines = (await readFile(this.eventPath, "utf8")).split(/\r?\n/).filter(Boolean);
      return lines.map((line) => JSON.parse(line) as AgentEventEnvelope).filter((event) => (!filter.names?.length || filter.names.includes(event.name)) && (!filter.source || event.source === filter.source)).slice(-Math.max(1, Math.min(limit, 1000)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async append(event: AgentEventEnvelope) {
    await mkdir(dirname(this.eventPath), { recursive: true });
    await appendFile(this.eventPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
