import * as cordis from "cordis";
import type { Context } from "cordis";
import type { AgentTool, ToolContext } from "./types.js";

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
    await this.ctx.agentEvents?.emit("tool:before", { name, args });
    try {
      const result = await tool.execute(args, context);
      await this.ctx.agentEvents?.emit("tool:after", { name, args, result });
      return result;
    } catch (error) {
      await this.ctx.agentEvents?.emit("tool:after", { name, args, error: error instanceof Error ? error.message : "tool execution failed" });
      throw error;
    }
  }
}

export function registerCoreTools(registry: ToolRegistry, root: Context) {
  const cleanups = [
    registry.register({
      name: "media.search",
      description: "Search indexed media visible to the current user.",
      risk: "read",
      capabilities: ["media.catalog.read"],
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      async execute(args, context) {
        const query = String(args.query ?? "").trim();
        const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 100);
        const libraryId = typeof args.library_id === "string" ? args.library_id : context.libraryId;
        if (libraryId) await root.libraryAccess.assertAccessible(libraryId, context);
        return root.mediaCatalog.search(query, limit, context, libraryId);
      },
    }),
    registry.register({
      name: "tasks.list",
      description: "List persisted Mengnex background tasks.",
      risk: "read",
      capabilities: ["media.tasks.read"],
      inputSchema: { type: "object", properties: { active: { type: "boolean" } } },
      async execute(args, context) {
        return root.mediaTasks.list(typeof args.active === "boolean" ? args.active : undefined, context);
      },
    }),
    registry.register({
      name: "tasks.create_scan",
      description: "Create a media library scan task.",
      risk: "high",
      capabilities: ["media.scan.start"],
      inputSchema: { type: "object", properties: { library_id: { type: "string" } }, required: ["library_id"] },
      async execute(args, context) {
        return root.mediaScanner.enqueue(String(args.library_id), context);
      },
    }),
    registry.register({
      name: "media.import_external",
      description: "Import or update an external media placeholder in a library.",
      risk: "high",
      capabilities: ["media.external.import"],
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
        return root.externalMediaSources.import({
          libraryId: String(args.library_id ?? ""), title: String(args.title ?? ""), source: String(args.source ?? ""), externalId: String(args.external_id ?? ""),
          sourceUrl: typeof args.source_url === "string" ? args.source_url : undefined,
          year: typeof args.year === "number" ? args.year : undefined,
          metadata: typeof args.metadata === "object" && args.metadata !== null ? args.metadata as Record<string, unknown> : undefined,
        }, context);
      },
    }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}

export function createCoreToolsPlugin() {
  return {
    name: "mengnex-core-tools",
    inject: ["tools", "mediaCatalog", "libraryAccess", "mediaScanner", "mediaTasks", "externalMediaSources"],
    apply(ctx: Context) {
      return registerCoreTools(ctx.tools, ctx);
    },
  };
}
