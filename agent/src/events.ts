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
};

declare module "cordis" { interface Context { events: AgentEventService; } }

/** Typed, serial event seam for plugin cooperation and observability. */
export class AgentEventService extends (cordis as any).Service {
  private readonly listeners = new Map<keyof AgentEventMap, Set<(event: any) => void | Promise<void>>>();
  constructor(ctx: Context) { super(ctx, "events"); }
  on<K extends keyof AgentEventMap>(name: K, listener: (event: AgentEventMap[K]) => void | Promise<void>) { const set = this.listeners.get(name) ?? new Set(); set.add(listener as any); this.listeners.set(name, set); return () => set.delete(listener as any); }
  async emit<K extends keyof AgentEventMap>(name: K, event: AgentEventMap[K]) { for (const listener of this.listeners.get(name) ?? []) await listener(event); }
}
