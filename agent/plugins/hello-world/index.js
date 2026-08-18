export function createPlugin() {
  return {
    name: "mengnex-hello-world-package",
    inject: ["tools", "rustApi"],
    apply(ctx) {
      return ctx.tools.register({
        name: "hello-world.health",
        description: "Verify that a local Cordis package can reach the Mengnex Rust API health endpoint.",
        risk: "read",
        capabilities: ["system.health"],
        inputSchema: { type: "object", properties: {} },
        execute: (_args, context) => ctx.rustApi.request("/health", {}, context.sessionCookie),
      });
    },
  };
}
