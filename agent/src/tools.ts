import * as cordis from "cordis";
import type { Context } from "cordis";
import type { AgentTool, ToolContext } from "./types.js";
import { RustApiClient } from "./rust-api.js";

declare module "cordis" {
  interface Context {
    tools: ToolRegistry;
  }
}

export class ToolRegistry extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly tools = new Map<string, AgentTool>();

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  register(tool: AgentTool) {
    if (this.tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return () => this.tools.delete(tool.name);
  }

  get(name: string) { return this.tools.get(name); }
  list() { return [...this.tools.values()].map(({ execute: _execute, ...metadata }) => metadata); }

  async execute(name: string, args: Record<string, unknown>, context: ToolContext) {
    const tool = this.get(name);
    if (!tool) throw new Error(`unknown agent tool: ${name}`);
    await this.ctx.events?.emit("tool:before", { name, args });
    try {
      const result = await tool.execute(args, context);
      await this.ctx.events?.emit("tool:after", { name, args, result });
      return result;
    } catch (error) {
      await this.ctx.events?.emit("tool:after", { name, args, error: error instanceof Error ? error.message : "tool execution failed" });
      throw error;
    }
  }
}

type MediaItem = { id: string; title: string; media_type: string; library_id: string };

export function registerCoreTools(registry: ToolRegistry, api: RustApiClient) {
  const cleanups = [
    registry.register({
      name: "media.search",
      description: "Search indexed media visible to the current user.",
      risk: "read",
      capabilities: ["media.search"],
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      async execute(args, context) {
        const query = String(args.query ?? "").trim().toLowerCase();
        const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 100);
        const items = await api.request<MediaItem[]>(`/api/media/items?limit=${limit}`, {}, context.sessionCookie);
        return items.filter((item) => !query || item.title.toLowerCase().includes(query));
      },
    }),
    registry.register({
      name: "tasks.list",
      description: "List persisted Mengnex background tasks.",
      risk: "read",
      capabilities: ["tasks.read"],
      inputSchema: { type: "object", properties: { active: { type: "boolean" } } },
      async execute(args, context) {
        const active = args.active === undefined ? "" : `?active=${Boolean(args.active)}`;
        return api.request(`/api/tasks${active}`, {}, context.sessionCookie);
      },
    }),
    registry.register({
      name: "tasks.create_scan",
      description: "Create a media library scan task.",
      risk: "high",
      capabilities: ["tasks.create"],
      inputSchema: { type: "object", properties: { library_id: { type: "string" } }, required: ["library_id"] },
      async execute(args, context) {
        return api.request("/api/scans", { method: "POST", body: JSON.stringify({ library_id: String(args.library_id) }) }, context.sessionCookie);
      },
    }),
    registry.register({
      name: "media.import_external",
      description: "Import or update an external media placeholder in a library.",
      risk: "high",
      capabilities: ["media.import"],
      inputSchema: {
        type: "object",
        properties: {
          library_id: { type: "string" },
          title: { type: "string" },
          source: { type: "string" },
          external_id: { type: "string" },
          source_url: { type: "string" },
          year: { type: "number" },
          metadata: { type: "object" },
        },
        required: ["library_id", "title", "source", "external_id"],
      },
      async execute(args, context) {
        return api.request("/api/media/import", {
          method: "POST",
          body: JSON.stringify({
            library_id: String(args.library_id ?? ""),
            title: String(args.title ?? ""),
            source: String(args.source ?? ""),
            external_id: String(args.external_id ?? ""),
            source_url: typeof args.source_url === "string" ? args.source_url : undefined,
            year: typeof args.year === "number" ? args.year : undefined,
            metadata: typeof args.metadata === "object" && args.metadata !== null ? args.metadata : undefined,
          }),
        }, context.sessionCookie);
      },
    }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}

export function createCoreToolsPlugin(api: RustApiClient) {
  return {
    name: "mengnex-core-tools",
    inject: ["tools"],
    apply(ctx: Context) {
      return registerCoreTools(ctx.tools, api);
    },
  };
}
