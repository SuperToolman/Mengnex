import assert from "node:assert/strict";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { ApprovalService } from "./approvals.js";
import { AgentRuntime } from "./runtime.js";
import { FileExecutionPolicy } from "./execution-policy.js";
import { ToolRegistry, createCoreToolsPlugin } from "./tools.js";
import { createRustMediaCapabilitiesPlugin } from "./media-capabilities.js";
import { RustApiService } from "./rust-api.js";

test("Cordis installs core Agent services and tools", async () => {
  const app = new (cordis as any).Context() as Context;
  const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
  await install(ToolRegistry);
  await install(ApprovalService);
  await install(FileExecutionPolicy);
  await app.policy.update({ executionMode: "approve_high_risk", allowedCapabilities: [] });
  await install(AgentRuntime, app.policy);
  await install(RustApiService, "http://127.0.0.1:7587");
  await install(createRustMediaCapabilitiesPlugin());
  await install(createCoreToolsPlugin());

  assert.deepEqual(app.agent.listTools().map((tool) => tool.name), ["media.search", "tasks.list", "tasks.create_scan", "media.import_external"]);
});
