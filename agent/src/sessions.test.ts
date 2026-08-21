import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { SessionStore } from "./sessions.js";

test("sessions persist an append-only DSH-style JSONL event log and project it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  try {
    const firstContext = new (cordis as any).Context() as Context;
    const store = new SessionStore(firstContext, directory);
    await store.load();
    const session = await store.create("user-a", "媒体搜索");
    await store.appendInteraction(session.id, "user-a", "找 EVA", {
      status: "completed", model: "test-model", toolCalls: [{ id: "call-1", toolName: "media.search", args: { query: "EVA" }, status: "completed", result: [{ title: "EVA" }], createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" }],
      blocks: [{ type: "text", text: "找到结果" }, { type: "tool-call", callId: "call-1", name: "media.search", args: { query: "EVA" }, status: "completed", startedAt: "2026-01-01T00:00:00.000Z" }],
    });
    const log = (await readFile(join(directory, session.id, "session.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(log[0].type, "session");
    assert.equal(log[0].version, 0);
    assert.deepEqual(log.slice(1).map((item) => item.seq), Array.from({ length: log.length - 1 }, (_, index) => index));
    assert.ok(log.some((item) => item.type === "turn/start"));
    assert.ok(log.some((item) => item.type === "assistant/message"));
    assert.ok(log.some((item) => item.type === "tool/result"));

    await store.dispose();
    const secondContext = new (cordis as any).Context() as Context;
    const restored = new SessionStore(secondContext, directory);
    await restored.load();
    const projected = restored.getOwned(session.id, "user-a");
    assert.equal(projected.turns[0].user.content[0].text, "找 EVA");
    assert.equal(projected.turns[0].assistant.content[0].type, "text");
    assert.equal(projected.turns[0].assistant.content[1].type, "tool-call");
    assert.equal(restored.list("user-b").length, 0);
    assert.throws(() => restored.getOwned(session.id, "user-b"), /not found/);
    await restored.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session coordinator serializes concurrent appends, flushes, and rejects a live owner collision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  try {
    const firstContext = new (cordis as any).Context() as Context;
    const first = new SessionStore(firstContext, directory); await first.load();
    const session = await first.create("user-a", "并发");
    const result = (text: string) => ({ status: "completed" as const, model: "test", toolCalls: [], blocks: [{ type: "text" as const, text }] });
    await Promise.all([first.appendInteraction(session.id, "user-a", "one", result("one")), first.appendInteraction(session.id, "user-a", "two", result("two")), first.appendInteraction(session.id, "user-a", "three", result("three"))]);
    await first.flush(session.id);
    const log = (await readFile(join(directory, session.id, "session.jsonl"), "utf8")).trim().split("\n").slice(1).map((line) => JSON.parse(line));
    assert.deepEqual(log.map((item) => item.seq), Array.from({ length: log.length }, (_, index) => index));
    const rival = new SessionStore(new (cordis as any).Context() as Context, directory);
    await assert.rejects(() => rival.load(), /already owned/);
    await first.dispose();
    await rival.load();
    assert.equal(rival.getOwned(session.id, "user-a").turns.length, 3);
    await rival.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
