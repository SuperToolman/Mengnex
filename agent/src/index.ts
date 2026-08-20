import * as cordis from "cordis";
import type { Context } from "cordis";
import { createServer } from "node:http";
import { RustApiClient } from "./rust-api.js";
import type { ChatMessage } from "./llm.js";
import { PluginManagerService } from "./plugin-manager.js";
import { PluginUiRegistryService } from "./plugin-ui.js";
import { corePluginDefinitions } from "./plugins/core-plugins.js";
import { discoverLocalPlugins } from "./plugin-loader.js";
import { loadComposition } from "./composition.js";

const port = Number(process.env.AGENT_PORT ?? 7590);
const api = new RustApiClient(
  process.env.RUST_API_URL ?? "http://127.0.0.1:7587",
);
const app = new (cordis as any).Context() as Context;
const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
await install(PluginUiRegistryService);
await install(PluginManagerService);
await app.pluginManager.load();
for (const plugin of corePluginDefinitions(api)) app.pluginManager.register(plugin);
for (const plugin of await discoverLocalPlugins()) app.pluginManager.register(plugin);
app.pluginManager.applyComposition(await loadComposition());
await app.pluginManager.startEnabled();
const gateway = app.gateway;

function send(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, status: number, value: unknown) {
  const origin = request.headers.origin;
  const allowedOrigin = origin === "http://localhost:7589" || origin === "http://127.0.0.1:7589" ? origin : "http://localhost:7589";
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  response.end(JSON.stringify(value));
}

async function body(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
}

async function requireManager(request: import("node:http").IncomingMessage) {
  const current = await requireAuthenticated(request);
  if (!matchesManagerRole(current.user.role)) throw new Error("agent settings require owner or admin access");
}

async function requireAuthenticated(request: import("node:http").IncomingMessage) {
  return api.request<{ user: { id: string; role: string } }>("/api/auth/me", {}, request.headers.cookie);
}

function matchesManagerRole(role: string) {
  return role === "owner" || role === "admin";
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return send(request, response, 204, undefined);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/health") return send(request, response, 200, gateway.health());
    if (request.method === "GET" && url.pathname === "/v1/tools") return send(request, response, 200, { tools: gateway.listTools() });
    if (request.method === "GET" && url.pathname === "/v1/plugins") {
      await requireManager(request);
      return send(request, response, 200, { plugins: gateway.listPlugins() });
    }
    if (request.method === "GET" && url.pathname === "/v1/plugin-settings") {
      await requireManager(request);
      return send(request, response, 200, { settings: gateway.listPluginSettings() });
    }
    const clientMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/client$/);
    if (request.method === "GET" && clientMatch) {
      await requireManager(request);
      const client = await gateway.pluginClient(clientMatch[1]);
      if (client === undefined) return send(request, response, 404, { message: "plugin client module not found" });
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": request.headers.origin ?? "http://localhost:7589", "Access-Control-Allow-Credentials": "true" });
      return response.end(client);
    }
    const actionMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/actions\/([^/]+)$/);
    if (request.method === "POST" && actionMatch) {
      await requireManager(request);
      return send(request, response, 200, await gateway.invokePluginAction(actionMatch[1], actionMatch[2], await body(request)));
    }
    const pluginMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)$/);
    if (request.method === "PUT" && pluginMatch) {
      await requireManager(request);
      const input = await body(request);
      const config = typeof input.config === "object" && input.config !== null && !Array.isArray(input.config) ? input.config as Record<string, unknown> : {};
      const enabled = input.enabled !== false;
      return send(request, response, 200, await gateway.updatePlugin(pluginMatch[1], config, enabled));
    }
    const pluginUpdateMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/update$/);
    if (request.method === "POST" && pluginUpdateMatch) {
      await requireManager(request);
      return send(request, response, 200, await gateway.updatePluginPackage(pluginUpdateMatch[1]));
    }
    const pluginRollbackMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/rollback\/([^/]+)$/);
    if (request.method === "POST" && pluginRollbackMatch) {
      await requireManager(request);
      return send(request, response, 200, await gateway.rollbackPlugin(pluginRollbackMatch[1], pluginRollbackMatch[2]));
    }
    if (request.method === "GET" && url.pathname === "/v1/jobs") {
      const current = await requireAuthenticated(request);
      return send(request, response, 200, { jobs: gateway.listJobs(current.user.id) });
    }
    if (request.method === "POST" && url.pathname === "/v1/jobs") {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      return send(request, response, 201, await gateway.scheduleJob({ owner: current.user.id, handler: String(input.handler ?? ""), payload: typeof input.payload === "object" && input.payload !== null ? input.payload as Record<string, unknown> : {}, runAt: typeof input.run_at === "string" ? input.run_at : undefined, maxAttempts: typeof input.max_attempts === "number" ? input.max_attempts : undefined }));
    }
    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (request.method === "POST" && jobMatch) {
      await requireAuthenticated(request);
      return send(request, response, 200, await gateway.cancelJob(jobMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/v1/events") {
      await requireManager(request);
      return send(request, response, 200, { events: await gateway.replayEvents(Number(url.searchParams.get("limit") ?? 100)) });
    }
    if (request.method === "GET" && url.pathname === "/v1/sessions") {
      const current = await requireAuthenticated(request);
      return send(request, response, 200, { sessions: gateway.listSessions(current.user.id) });
    }
    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      return send(request, response, 201, await gateway.createSession(current.user.id, typeof input.title === "string" ? input.title.trim() || "新对话" : "新对话"));
    }
    const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionMatch) {
      const current = await requireAuthenticated(request);
      return send(request, response, 200, gateway.getSession(sessionMatch[1], current.user.id));
    }
    const messageMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
    if (request.method === "POST" && messageMatch) {
      const current = await requireAuthenticated(request);
      gateway.getSession(messageMatch[1], current.user.id);
      const input = await body(request);
      const content = typeof input.content === "string" ? input.content.trim() : "";
      if (!content) return send(request, response, 400, { message: "message content is required" });
      const result = await gateway.sendMessage(messageMatch[1], current.user.id, content, { userId: current.user.id, sessionCookie: request.headers.cookie });
      return send(request, response, result.status === "approval_required" ? 202 : 200, { ...result, sessionId: messageMatch[1] });
    }
    if (request.method === "POST" && url.pathname === "/v1/chat") {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      const messages = Array.isArray(input.messages) ? input.messages as ChatMessage[] : [];
      if (!messages.length) return send(request, response, 400, { message: "messages are required" });
      const result = await gateway.chat(messages, { userId: current.user.id, sessionCookie: request.headers.cookie });
      return send(request, response, result.status === "approval_required" ? 202 : 200, result);
    }
    if (request.method === "POST" && url.pathname === "/v1/runs") {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      const result = await gateway.runTool(String(input.tool ?? ""), (input.args ?? {}) as Record<string, unknown>, { userId: current.user.id, libraryId: typeof input.library_id === "string" ? input.library_id : undefined, sessionCookie: request.headers.cookie });
      return send(request, response, result.status === "approval_required" ? 202 : 200, result);
    }
    const approval = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
    if (request.method === "POST" && approval) {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      if (input.decision !== "approve" && input.decision !== "reject") return send(request, response, 400, { message: "decision must be approve or reject" });
      const result = await gateway.decideApproval(approval[1], input.decision, { userId: current.user.id, sessionCookie: request.headers.cookie });
      return send(request, response, 200, result);
    }
    return send(request, response, 404, { message: "not found" });
  } catch (error) {
    return send(request, response, 400, { message: error instanceof Error ? error.message : "agent request failed" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mengnex Agent listening on http://127.0.0.1:${port}`);
});
