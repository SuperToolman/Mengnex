import assert from "node:assert/strict";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { ApprovalService } from "./approvals.js";
import { parseCapabilities } from "./policy.js";
import { RustApiClient } from "./rust-api.js";
import { AgentRuntime } from "./runtime.js";
import { ToolRegistry, createCoreToolsPlugin } from "./tools.js";

test("Cordis installs core Agent services and tools", async () => {
  const app = new (cordis as any).Context() as Context;
  const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
  await install(ToolRegistry);
  await install(ApprovalService);
  await install(AgentRuntime, { executionMode: "approve_high_risk", capabilities: parseCapabilities(undefined) });
  await install(createCoreToolsPlugin(new RustApiClient("http://127.0.0.1:3001")));

  assert.deepEqual(app.agent.listTools().map((tool) => tool.name), ["media.search", "tasks.list", "tasks.create_scan", "media.import_external"]);
});
