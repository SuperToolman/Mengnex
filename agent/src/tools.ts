import * as cordis from "cordis";
import type { Context } from "cordis";
import type { AgentTool, ToolContext } from "./types.js";
import { StructuredToolError, type ToolErrorCode, type ToolExecutionState } from "./types.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

declare module "cordis" {
  interface Context {
    tools: ToolRegistry;
  }
}

export class ToolRegistry extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly tools = new Map<string, AgentTool>();
  private readonly idempotency = new Map<string, { fingerprint: string; result: unknown }>();

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
  async readSpill(id: string) { if (!/^[0-9a-f-]{36}\.json$/i.test(id)) throw new Error("invalid spill id"); return JSON.parse(await readFile(join(process.cwd(), "data", "tool-spill", id), "utf8")); }

  async execute(name: string, args: Record<string, unknown>, context: ToolContext) {
    const tool = this.get(name);
    if (!tool) throw new Error(`unknown agent tool: ${name}`);
    const correlationId = context.correlationId ?? crypto.randomUUID();
    const eventContext = { correlationId, sessionId: context.sessionId, turnId: context.turnId, toolCallId: context.toolCallId, actorId: context.actorId ?? context.userId, pluginId: context.pluginId, parentJobId: context.parentJobId, parentSubagentId: context.parentSubagentId };
    const startedAt = performance.now();
    await this.state(name, "created", eventContext);
    if (context.idempotencyKey && !tool.idempotent) throw toolError({ code: "IDEMPOTENCY_CONFLICT", message: "tool does not support idempotency keys", tool: name });
    const key = tool.idempotent && context.idempotencyKey ? `${name}:${context.idempotencyKey}` : undefined;
    const fingerprint = JSON.stringify(args);
    if (key && this.idempotency.has(key)) { const cached = this.idempotency.get(key)!; if (cached.fingerprint !== fingerprint) throw toolError({ code: "IDEMPOTENCY_CONFLICT", message: "idempotency key was already used with different arguments", tool: name }); await this.state(name, "replayed", eventContext); return cached.result; }
    validateSchema(tool.inputSchema, args, name);
    await this.state(name, "validated", eventContext);
    await this.ctx.agentEvents?.audit("tool.execute", "tool", name, { args: redactArgs(args) }, eventContext);
    await this.ctx.agentEvents?.emit("tool:before", { name, args }, undefined, eventContext);
    const controller = new AbortController(); const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal; const timeout = tool.timeoutMs && tool.timeoutMs > 0 ? setTimeout(() => controller.abort(), tool.timeoutMs) : undefined;
    try {
      await this.state(name, "running", eventContext);
      const result = await tool.execute(args, { ...context, signal });
      const bounded = await boundOutput(result, tool.maxOutputBytes ?? 256 * 1024, name);
      if (key) this.idempotency.set(key, { fingerprint, result: bounded });
      const durationMs = performance.now() - startedAt;
      await this.ctx.agentEvents?.emit("tool:after", { name, args, result, durationMs, outcome: "completed" }, undefined, eventContext);
      await this.state(name, "completed", eventContext);
      await this.ctx.agentEvents?.audit("tool.completed", "tool", name, { durationMs }, eventContext);
      return bounded;
    } catch (error) {
      const structured = normalizeToolError(error, name, signal.aborted && context.signal?.aborted ? "CANCELLED" : signal.aborted ? "TIMEOUT" : undefined);
      const durationMs = performance.now() - startedAt;
      await this.ctx.agentEvents?.emit("tool:after", { name, args, error: { code: structured.code, message: structured.message, retryable: structured.code === "TIMEOUT" }, durationMs, outcome: structured.code === "CANCELLED" ? "cancelled" : "failed" }, undefined, eventContext);
      await this.state(name, structured.code === "CANCELLED" ? "cancelled" : structured.code === "TIMEOUT" ? "timed_out" : "failed", eventContext);
      await this.ctx.agentEvents?.audit("tool.failed", "tool", name, { durationMs, errorCode: structured.code, error: structured.message }, eventContext);
      throw structured;
    } finally { if (timeout) clearTimeout(timeout); }
  }

  private async state(name: string, state: ToolExecutionState, context: import("./events.js").EventContext) {
    await this.ctx.agentEvents?.emit("tool:state", { name, state }, undefined, context);
  }
}

function toolError(error: { code: ToolErrorCode; message: string; tool: string; details?: Record<string, unknown> }): StructuredToolError { return new StructuredToolError(error.code, error.message, error.tool, error.details); }
function normalizeToolError(error: unknown, tool: string, forced?: ToolErrorCode): StructuredToolError { if (error instanceof StructuredToolError) return error; const code = forced ?? "EXECUTION_FAILED"; return new StructuredToolError(code, error instanceof Error ? error.message : "tool execution failed", tool); }
function validateSchema(schema: Record<string, unknown>, value: unknown, tool: string, path = "arguments") { const type = schema.type; if (type === "object") { if (!value || Array.isArray(value) || typeof value !== "object") throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} must be an object`, tool }); const record = value as Record<string, unknown>; for (const required of Array.isArray(schema.required) ? schema.required : []) if (typeof required === "string" && !(required in record)) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path}.${required} is required`, tool }); const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, Record<string, unknown>> : {}; for (const [key, child] of Object.entries(properties)) if (key in record) validateSchema(child, record[key], tool, `${path}.${key}`); if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!properties[key]) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path}.${key} is not allowed`, tool }); return; } if (type === "array") { if (!Array.isArray(value)) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} must be an array`, tool }); if (typeof schema.minItems === "number" && value.length < schema.minItems) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} must contain at least ${schema.minItems} items`, tool }); return; } if (type && type !== "number" && typeof value !== type || type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} must be ${String(type)}`, tool }); if (typeof schema.minLength === "number" && typeof value === "string" && value.length < schema.minLength) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} must not be empty`, tool }); if (typeof schema.minimum === "number" && typeof value === "number" && value < schema.minimum) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} must be at least ${schema.minimum}`, tool }); if (typeof schema.maximum === "number" && typeof value === "number" && value > schema.maximum) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} must be at most ${schema.maximum}`, tool }); if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) throw toolError({ code: "INVALID_ARGUMENTS", message: `${path} is not an allowed value`, tool }); }
async function boundOutput(value: unknown, maxBytes: number, tool: string) { const encoded = JSON.stringify(value ?? null); if (Buffer.byteLength(encoded, "utf8") <= maxBytes) return value; const directory = join(process.cwd(), "data", "tool-spill"); await mkdir(directory, { recursive: true }); const id = crypto.randomUUID(); await writeFile(join(directory, `${id}.json`), encoded, { encoding: "utf8", mode: 0o600 }); return { spilled: true, id, tool, bytes: Buffer.byteLength(encoded, "utf8"), preview: encoded.slice(0, Math.max(0, Math.min(4096, maxBytes))) };
}

function redactArgs(args: Record<string, unknown>) { return Object.fromEntries(Object.entries(args).map(([key, value]) => /key|secret|token|password|cookie|credential/i.test(key) ? [key, "[REDACTED]"] : [key, value])); }

export function registerCoreTools(registry: ToolRegistry, root: Context) {
  const cleanups = [
    registry.register({
      name: "media.search",
      description: "Search indexed media visible to the current user.",
      risk: "read",
      // Search is available to every signed-in user; the media adapter scopes results to accessible libraries.
      capabilities: [],
      inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", minLength: 1 }, limit: { type: "number", minimum: 1, maximum: 100 }, library_id: { type: "string", minLength: 1 } }, required: ["query"] },
      timeoutMs: 10_000, maxOutputBytes: 128 * 1024, presentation: { label: "搜索媒体", icon: "search", group: "media" },
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
      timeoutMs: 10_000, maxOutputBytes: 128 * 1024, presentation: { label: "查看任务", icon: "list", group: "tasks" },
      async execute(args, context) {
        return root.mediaTasks.list(typeof args.active === "boolean" ? args.active : undefined, context);
      },
    }),
    registry.register({
      name: "tasks.create_scan",
      description: "Create a media library scan task.",
      risk: "high",
      capabilities: ["media.scan.start"],
      inputSchema: { type: "object", additionalProperties: false, properties: { library_id: { type: "string", minLength: 1 } }, required: ["library_id"] },
      timeoutMs: 15_000, idempotent: true, presentation: { label: "创建扫描任务", icon: "scan", group: "tasks", confirmation: "将为媒体库创建扫描任务" },
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
      timeoutMs: 15_000, idempotent: true, presentation: { label: "导入外部媒体", icon: "download", group: "media", confirmation: "将向媒体库写入外部媒体占位记录" },
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

export function createWebToolsPlugin() {
  return {
    name: "mengnex-web-tools",
    inject: ["tools", "web"],
    apply(ctx: Context) {
      const cleanups = [
        ctx.tools.register({ name: "web.search", description: "Search the public web for current information and return source URLs and snippets.", risk: "read", capabilities: ["web.read"], inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", minLength: 1 } }, required: ["query"] }, timeoutMs: 30_000, maxOutputBytes: 128 * 1024, presentation: { label: "搜索网页", icon: "search", group: "web" }, async execute(args, context) { return ctx.web.search(String(args.query ?? ""), context); } }),
        ctx.tools.register({ name: "web.fetch", description: "Fetch a public HTTP(S) webpage and return its text content.", risk: "read", capabilities: ["web.read"], inputSchema: { type: "object", additionalProperties: false, properties: { url: { type: "string", minLength: 1 } }, required: ["url"] }, timeoutMs: 30_000, maxOutputBytes: 512 * 1024, presentation: { label: "读取网页", icon: "globe", group: "web" }, async execute(args, context) { return ctx.web.fetchPage(String(args.url ?? ""), context); } }),
        ctx.tools.register({ name: "web.download", description: "Download a public HTTP(S) resource into the Agent downloads directory and return its local path.", risk: "medium", capabilities: ["web.download"], inputSchema: { type: "object", additionalProperties: false, properties: { url: { type: "string", minLength: 1 } }, required: ["url"] }, timeoutMs: 60_000, maxOutputBytes: 16 * 1024, presentation: { label: "下载资源", icon: "download", group: "web" }, async execute(args, context) { return ctx.web.download(String(args.url ?? ""), context); } }),
      ];
      return () => cleanups.forEach((cleanup) => cleanup());
    },
  };
}
