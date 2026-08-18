import { spawn } from "node:child_process";

class StdioMcpClient {
  constructor(server) {
    if (!server || typeof server.id !== "string" || !/^[a-z0-9-]+$/.test(server.id) || typeof server.command !== "string") throw new Error("each MCP server needs a lowercase id and command");
    this.id = server.id;
    this.process = spawn(server.command, Array.isArray(server.args) ? server.args.map(String) : [], {
      env: { ...process.env, ...(server.env && typeof server.env === "object" ? server.env : {}) },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.nextId = 1;
    this.pending = new Map();
    let buffer = "";
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { const message = JSON.parse(line); const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message ?? "MCP error")) : pending.resolve(message.result); } } catch { /* MCP stderr/protocol noise is ignored */ }
      }
    });
    this.process.once("exit", () => { for (const pending of this.pending.values()) pending.reject(new Error(`MCP server ${this.id} exited`)); this.pending.clear(); });
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 20_000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  async initialize() { await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mengnex-agent", version: "0.1.0" } }); this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`); }
  dispose() { this.process.kill(); }
}

export function createPlugin(config) {
  const servers = Array.isArray(config.servers) ? config.servers : [];
  return {
    name: "mengnex-mcp-client-package",
    inject: ["tools"],
    async apply(ctx) {
      const clients = [];
      const cleanups = [];
      try {
        for (const server of servers) {
          const client = new StdioMcpClient(server); clients.push(client);
          await client.initialize();
          const listed = await client.request("tools/list", {});
          for (const tool of listed.tools ?? []) {
            if (typeof tool.name !== "string") continue;
            const name = `mcp.${client.id}.${tool.name}`;
            cleanups.push(ctx.tools.register({ name, description: tool.description ?? `MCP tool ${tool.name}`, risk: "high", capabilities: ["mcp.invoke"], inputSchema: tool.inputSchema ?? { type: "object" }, execute: (args) => client.request("tools/call", { name: tool.name, arguments: args }) }));
          }
        }
      } catch (error) { clients.forEach((client) => client.dispose()); throw error; }
      return () => { cleanups.reverse().forEach((cleanup) => cleanup()); clients.reverse().forEach((client) => client.dispose()); };
    },
  };
}
