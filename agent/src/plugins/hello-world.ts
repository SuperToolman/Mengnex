import type { Context } from "cordis";
import { RustApiClient } from "../rust-api.js";
import { ToolRegistry } from "../tools.js";

export function createHelloWorldPlugin(api: RustApiClient) {
  return {
    name: "mengnex-hello-world",
    inject: ["tools"],
    apply(ctx: Context) {
      const registry = ctx.tools as ToolRegistry;
      return registry.register({
        name: "hello-world.health",
        description: "Verify that a Cordis plugin can reach the Mengnex Rust API health endpoint.",
        risk: "read",
        capabilities: ["system.health"],
        inputSchema: { type: "object", properties: {} },
        execute: (_args, context) => api.request("/health", {}, context.sessionCookie),
      });
    },
  };
}
