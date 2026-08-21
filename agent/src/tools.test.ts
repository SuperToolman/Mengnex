import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { RustApiService } from "./rust-api.js";
import { ToolRegistry, createCoreToolsPlugin } from "./tools.js";
import { createRustMediaCapabilitiesPlugin } from "./media-capabilities.js";
import { ExternalMediaSources, LibraryAccess, MediaCatalog, MediaScanner, MediaTasks, type ExternalMediaImport, type MediaLibrarySummary, type MediaItemSummary } from "./media-capabilities.js";
import type { ToolContext } from "./types.js";
import { StructuredToolError } from "./types.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";

test("media.search forwards the authenticated cookie to the Rust API", async () => {
  let receivedCookie = "";
  const server = createServer((request, response) => {
    receivedCookie = request.headers.cookie ?? "";
    assert.equal(request.url, "/api/media/items?limit=50");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify([
      { id: "1", title: "Neon Genesis Evangelion", media_type: "anime", library_id: "library-1" },
      { id: "2", title: "Arrival", media_type: "movie", library_id: "library-1" },
    ]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not expose a port");

  try {
    const app = new (cordis as any).Context() as Context;
    const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await install(RustApiService, `http://127.0.0.1:${address.port}`);
    await install(ToolRegistry);
    await install(createRustMediaCapabilitiesPlugin());
    await install(createCoreToolsPlugin());

    const result = await app.tools.execute("media.search", { query: "eva" }, { executionMode: "approve_high_risk", sessionCookie: "mengnex_session=verified" });
    assert.equal(receivedCookie, "mengnex_session=verified");
    assert.deepEqual(result, [{ id: "1", title: "Neon Genesis Evangelion", media_type: "anime", library_id: "library-1" }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("core tools consume replaceable media capabilities and enforce library access", async () => {
  class FakeLibraryAccess extends LibraryAccess {
    list(_context: ToolContext): Promise<MediaLibrarySummary[]> { return Promise.resolve([{ id: "allowed", name: "Allowed", media_type: "movie", enabled: true }]); }
    async assertAccessible(id: string, context: ToolContext) { const value = (await this.list(context)).find((library) => library.id === id); if (!value) throw new Error("media library is not accessible"); return value; }
  }
  class FakeCatalog extends MediaCatalog {
    search(_query: string, _limit: number, _context: ToolContext): Promise<MediaItemSummary[]> { return Promise.resolve([{ id: "fake-1", title: "From replacement", media_type: "movie", library_id: "allowed" }]); }
  }
  class FakeScanner extends MediaScanner {
    static inject = ["libraryAccess"];
    constructor(ctx: Context) { super(ctx); }
    list(_context: ToolContext) { return Promise.resolve([]); }
    async enqueue(libraryId: string, context: ToolContext) { await this.ctx.libraryAccess.assertAccessible(libraryId, context); return { queued: libraryId }; }
  }
  class FakeTasks extends MediaTasks {
    list(_active: boolean | undefined, _context: ToolContext) { return Promise.resolve([]); }
  }
  class FakeExternalSources extends ExternalMediaSources {
    static inject = ["libraryAccess"];
    async import(item: ExternalMediaImport, context: ToolContext) { await this.ctx.libraryAccess.assertAccessible(item.libraryId, context); return { imported: item.externalId }; }
  }
  const app = new (cordis as any).Context() as Context;
  const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
  await install(ToolRegistry);
  await install(FakeLibraryAccess);
  await install(FakeCatalog);
  await install(FakeScanner);
  await install(FakeTasks);
  await install(FakeExternalSources);
  await install(createCoreToolsPlugin());
  const context: ToolContext = { executionMode: "full_access" };
  assert.deepEqual(await app.tools.execute("media.search", { query: "anything" }, context), [{ id: "fake-1", title: "From replacement", media_type: "movie", library_id: "allowed" }]);
  await assert.rejects(() => app.tools.execute("tasks.create_scan", { library_id: "missing" }, context), /not accessible/);
  await assert.rejects(() => app.tools.execute("media.import_external", { library_id: "missing", title: "x", source: "x", external_id: "x" }, context), /not accessible/);
  assert.deepEqual(await app.tools.execute("tasks.create_scan", { library_id: "allowed" }, context), { queued: "allowed" });
});

test("tool execution protocol validates, cancels, spills, and replays idempotent calls", async () => {
  const app = new (cordis as any).Context() as Context;
  const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
  await install(ToolRegistry);
  await app.tools.register({ name: "protocol.echo", description: "echo", risk: "read", capabilities: [], inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } } }, maxOutputBytes: 12, idempotent: true, presentation: { label: "Echo" }, async execute(args) { return { value: args.value, extra: "large" }; } });
  const context: ToolContext = { executionMode: "full_access", idempotencyKey: "same" };
  await assert.rejects(() => app.tools.execute("protocol.echo", {}, context), (error: unknown) => error instanceof StructuredToolError && error.code === "INVALID_ARGUMENTS");
  const first = await app.tools.execute("protocol.echo", { value: "x" }, context) as { spilled: boolean; id: string };
  assert.equal(first.spilled, true);
  assert.deepEqual(await app.tools.execute("protocol.echo", { value: "x" }, context), first);
  await assert.rejects(() => app.tools.execute("protocol.echo", { value: "y" }, context), (error: unknown) => error instanceof StructuredToolError && error.code === "IDEMPOTENCY_CONFLICT");
  await rm(join(process.cwd(), "data", "tool-spill", `${first.id}.json`), { force: true });

  await app.tools.register({ name: "protocol.slow", description: "slow", risk: "read", capabilities: [], inputSchema: { type: "object" }, timeoutMs: 5, async execute(_args, toolContext) { await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 100); toolContext.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true }); }); return true; } });
  await assert.rejects(() => app.tools.execute("protocol.slow", {}, { executionMode: "full_access" }), (error: unknown) => error instanceof StructuredToolError && error.code === "TIMEOUT");
});
