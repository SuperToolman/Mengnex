import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { SessionStore } from "./sessions.js";
import * as cordis from "cordis";
import type { Context } from "cordis";

test("sessions persist messages and remain isolated by user", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  const filePath = join(directory, "sessions.json");
  try {
    const firstContext = new (cordis as any).Context() as Context;
    const store = new SessionStore(firstContext, filePath);
    await store.load();
    const session = await store.create("user-a", "媒体搜索");
    await store.append(session.id, "user-a", [{ role: "user", content: "找 EVA" }]);
    await store.appendToolCalls(session.id, "user-a", [{ toolName: "media.search", args: { query: "eva" }, status: "completed", result: [], createdAt: new Date().toISOString() }]);

    const secondContext = new (cordis as any).Context() as Context;
    const restored = new SessionStore(secondContext, filePath);
    await restored.load();
    assert.equal(restored.list("user-a").length, 1);
    assert.equal(restored.getOwned(session.id, "user-a").messages[0].content, "找 EVA");
    assert.equal(restored.getOwned(session.id, "user-a").toolCalls[0].toolName, "media.search");
    assert.equal(restored.list("user-b").length, 0);
    assert.throws(() => restored.getOwned(session.id, "user-b"), /not found/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
