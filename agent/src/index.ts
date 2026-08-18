import * as cordis from "cordis";
import type { Context } from "cordis";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { RustApiClient } from "./rust-api.js";
import type { ChatMessage } from "./llm.js";
import { PluginManagerService } from "./plugin-manager.js";
import { PluginUiRegistryService } from "./plugin-ui.js";
import { builtInPlugins } from "./plugins/builtins.js";
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
for (const plugin of builtInPlugins(api)) app.pluginManager.register(plugin);
for (const plugin of await discoverLocalPlugins()) app.pluginManager.register(plugin);
app.pluginManager.applyComposition(await loadComposition());
await app.pluginManager.startInstalled();
const runtime = app.agent;
const sessions = app.sessions;

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
    if (request.method === "GET" && url.pathname === "/health") return send(request, response, 200, { status: "ok", mode: app.policy.view().executionMode });
    if (request.method === "GET" && url.pathname === "/v1/tools") return send(request, response, 200, { tools: runtime.listTools() });
    if (request.method === "GET" && url.pathname === "/v1/plugins") {
      await requireManager(request);
      return send(request, response, 200, { plugins: app.pluginManager.list() });
    }
    if (request.method === "GET" && url.pathname === "/v1/plugin-settings") {
      await requireManager(request);
      return send(request, response, 200, { settings: app.pluginUi.listSettings() });
    }
    const clientMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/client$/);
    if (request.method === "GET" && clientMatch) {
      await requireManager(request);
      const client = app.pluginManager.clientModule(clientMatch[1]);
      if (!client) return send(request, response, 404, { message: "plugin client module not found" });
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": request.headers.origin ?? "http://localhost:7589", "Access-Control-Allow-Credentials": "true" });
      return response.end(await readFile(client.entryPath, "utf8"));
    }
    const actionMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/actions\/([^/]+)$/);
    if (request.method === "POST" && actionMatch) {
      await requireManager(request);
      return send(request, response, 200, await app.pluginApi.invoke(actionMatch[1], actionMatch[2], await body(request)));
    }
    const pluginMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)$/);
    if (request.method === "PUT" && pluginMatch) {
      await requireManager(request);
      const input = await body(request);
      const config = typeof input.config === "object" && input.config !== null && !Array.isArray(input.config) ? input.config as Record<string, unknown> : {};
      const enabled = input.enabled !== false;
      return send(request, response, 200, await app.pluginManager.update(pluginMatch[1], config, enabled));
    }
    if (request.method === "GET" && url.pathname === "/v1/sessions") {
      const current = await requireAuthenticated(request);
      return send(request, response, 200, { sessions: sessions.list(current.user.id) });
    }
    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      return send(request, response, 201, await sessions.create(current.user.id, typeof input.title === "string" ? input.title.trim() || "新对话" : "新对话"));
    }
    const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionMatch) {
      const current = await requireAuthenticated(request);
      return send(request, response, 200, sessions.getOwned(sessionMatch[1], current.user.id));
    }
    const messageMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
    if (request.method === "POST" && messageMatch) {
      const current = await requireAuthenticated(request);
      const session = sessions.getOwned(messageMatch[1], current.user.id);
      const input = await body(request);
      const content = typeof input.content === "string" ? input.content.trim() : "";
      if (!content) return send(request, response, 400, { message: "message content is required" });
      const userMessage = { role: "user" as const, content };
      await sessions.append(session.id, current.user.id, [userMessage]);
      const result = await app.agentLoop.chat(session.messages, { userId: current.user.id, sessionCookie: request.headers.cookie });
      await sessions.appendToolCalls(session.id, current.user.id, result.toolCalls);
      await sessions.append(session.id, current.user.id, [{ role: "assistant", content: result.content }]);
      return send(request, response, result.status === "approval_required" ? 202 : 200, { ...result, sessionId: session.id });
    }
    if (request.method === "POST" && url.pathname === "/v1/chat") {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      const messages = Array.isArray(input.messages) ? input.messages as ChatMessage[] : [];
      if (!messages.length) return send(request, response, 400, { message: "messages are required" });
      const result = await app.agentLoop.chat(messages, { userId: current.user.id, sessionCookie: request.headers.cookie });
      return send(request, response, result.status === "approval_required" ? 202 : 200, result);
    }
    if (request.method === "POST" && url.pathname === "/v1/runs") {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      const result = await runtime.invoke(String(input.tool ?? ""), (input.args ?? {}) as Record<string, unknown>, { userId: current.user.id, libraryId: typeof input.library_id === "string" ? input.library_id : undefined, sessionCookie: request.headers.cookie });
      return send(request, response, result.status === "approval_required" ? 202 : 200, result);
    }
    const approval = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
    if (request.method === "POST" && approval) {
      const current = await requireAuthenticated(request);
      const input = await body(request);
      if (input.decision !== "approve" && input.decision !== "reject") return send(request, response, 400, { message: "decision must be approve or reject" });
      const result = await runtime.decideApproval(approval[1], input.decision, { userId: current.user.id, sessionCookie: request.headers.cookie });
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
