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
    await store.appendTurn(session.id, "user-a", { id: "turn-1", createdAt: new Date().toISOString(), user: { content: [{ type: "text", text: "找 EVA" }] }, assistant: { content: [{ type: "text", text: "结果" }], model: "test", status: "completed" } });

    const secondContext = new (cordis as any).Context() as Context;
    const restored = new SessionStore(secondContext, filePath);
    await restored.load();
    assert.equal(restored.list("user-a").length, 1);
    assert.equal(restored.getOwned(session.id, "user-a").turns[0].assistant.content[0].type, "text");
    assert.equal(restored.list("user-b").length, 0);
    assert.throws(() => restored.getOwned(session.id, "user-b"), /not found/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
