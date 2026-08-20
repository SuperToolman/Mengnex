import assert from "node:assert/strict";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { AgentEventService } from "./events.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    const result = await events.emit("tool:after", { name: "test", args: {}, result: true });
    assert.deepEqual(failures, ["second"]);
    assert.equal(result.failures.length, 1);
    const line = JSON.parse((await readFile(join(directory, "events.jsonl"), "utf8")).split("\n")[0]);
    assert.equal(line.version, 1);
    assert.equal((await events.replay({ names: ["tool:after"] })).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
