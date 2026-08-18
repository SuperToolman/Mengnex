import assert from "node:assert/strict";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { AgentEventService } from "./events.js";

test("typed agent events dispatch listeners serially", async () => {
  const app = new (cordis as any).Context() as Context;
  const events = new AgentEventService(app);
  const received: string[] = [];
  events.on("tool:before", async (event) => { received.push(`first:${event.name}`); });
  events.on("tool:before", (event) => { received.push(`second:${event.name}`); });
  await events.emit("tool:before", { name: "media.search", args: {} });
  assert.deepEqual(received, ["first:media.search", "second:media.search"]);
});
