import assert from "node:assert/strict";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { AGENT_EVENT_SCHEMA_VERSION, AgentEventService } from "./events.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("typed agent events dispatch listeners serially", async () => {
  const app = new (cordis as any).Context() as Context;
  const events = new AgentEventService(app);
  const received: string[] = [];
  events.on("tool:before", async (event) => { received.push(`first:${event.payload.name}`); });
  events.on("tool:before", (event) => { received.push(`second:${event.payload.name}`); });
  await events.emit("tool:before", { name: "media.search", args: {} });
  assert.deepEqual(received, ["first:media.search", "second:media.search"]);
});

test("events are versioned, persisted, and isolate listener failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-events-"));
  try {
    const app = new (cordis as any).Context() as Context;
    const events = new AgentEventService(app, { filePath: join(directory, "events.jsonl"), source: "test" });
    const failures: string[] = [];
    events.on("tool:after", () => { throw new Error("listener broke"); });
    events.on("tool:after", () => { failures.push("second"); });
    const result = await events.emit("tool:after", { name: "test", args: {}, result: true, durationMs: 1, outcome: "completed" });
    assert.deepEqual(failures, ["second"]);
    assert.equal(result.failures.length, 1);
    const line = JSON.parse((await readFile(join(directory, "events.jsonl"), "utf8")).split("\n")[0]);
    assert.equal(line.schemaVersion, AGENT_EVENT_SCHEMA_VERSION);
    assert.equal((await events.replay({ names: ["tool:after"] })).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("filters apply to on registrations and include trace context", async () => {
  const app = new (cordis as any).Context() as Context;
  const events = new AgentEventService(app);
  const received: string[] = [];
  events.on("tool:before", (event) => { received.push(event.context.toolCallId!); }, { source: "tools", sessionId: "session-1" });
  await events.emit("tool:before", { name: "skip", args: {} }, "other", { sessionId: "session-1", toolCallId: "call-1" });
  await events.emit("tool:before", { name: "skip", args: {} }, "tools", { sessionId: "other", toolCallId: "call-2" });
  await events.emit("tool:before", { name: "use", args: {} }, "tools", { correlationId: "trace-1", sessionId: "session-1", turnId: "turn-1", toolCallId: "call-3", actorId: "user-1" });
  assert.deepEqual(received, ["call-3"]);
});

test("event writes serialize and persisted events recover metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-events-"));
  try {
    const path = join(directory, "events.jsonl"); const app = new (cordis as any).Context() as Context;
    const events = new AgentEventService(app, { filePath: path });
    await Promise.all(Array.from({ length: 20 }, (_, index) => events.emit("tool:after", { name: "test", args: { index }, durationMs: index + 1, outcome: index === 0 ? "failed" : "completed", ...(index === 0 ? { error: { code: "TEST_FAILURE", message: "failed" } } : {}) }, "tools", { correlationId: `trace-${index}` })));
    await events.emit("scheduler:retrying", { job: { id: "job-1" }, delayMs: 100 }, "scheduler", { parentJobId: "job-1" });
    await events.emit("approval:decided", { approvalId: "approval-1", toolName: "test", decision: "approve", waitMs: 40, outcome: "completed" });
    const restored = new AgentEventService(new (cordis as any).Context() as Context, { filePath: path }); await restored.load();
    assert.equal((await restored.replay({}, 100)).length, 22);
    const metrics = restored.snapshotMetrics();
    assert.equal(metrics.toolLatency.count, 20); assert.equal(metrics.retries, 1); assert.equal(metrics.approvalWait.totalMs, 40); assert.equal(metrics.failures.total, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid event logs are quarantined instead of being interpreted as current events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-events-"));
  try {
    const path = join(directory, "events.jsonl");
    await writeFile(path, '{"id":"legacy","version":1,"name":"tool:before"}\\n{"id":"legacy-2","version":1}\n', "utf8");
    const events = new AgentEventService(new (cordis as any).Context() as Context, { filePath: path }); await events.load();
    assert.deepEqual(await events.replay({}, 10), []);
    assert.equal((await readdir(directory)).some((entry) => entry.startsWith("events.jsonl.corrupt-")), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
