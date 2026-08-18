import * as cordis from "cordis";
import type { Context } from "cordis";

type Handler = (input: Record<string, unknown>) => unknown | Promise<unknown>;

declare module "cordis" { interface Context { pluginApi: PluginApiService; } }

/** Generic action seam used by browser plugins; the host never names plugin actions. */
export class PluginApiService extends (cordis as any).Service {
  private readonly actions = new Map<string, Handler>();
  constructor(ctx: Context) { super(ctx, "pluginApi"); }
  register(pluginId: string, action: string, handler: Handler) {
    const key = `${pluginId}:${action}`;
    if (this.actions.has(key)) throw new Error(`plugin action already registered: ${key}`);
    this.actions.set(key, handler);
    return () => this.actions.delete(key);
  }
  async invoke(pluginId: string, action: string, input: Record<string, unknown>) {
    const handler = this.actions.get(`${pluginId}:${action}`);
    if (!handler) throw new Error(`plugin action not available: ${pluginId}/${action}`);
    return handler(input);
  }
}
