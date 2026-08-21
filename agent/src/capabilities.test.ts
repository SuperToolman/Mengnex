import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { AgentEventService } from "./events.js";
import { LocalProcessSandbox, PersistentJobScheduler } from "./capabilities.js";
import { SessionStore } from "./sessions.js";

test("persistent scheduler records completion and retries failed handlers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-jobs-"));
  try {
    const app = new (cordis as any).Context() as Context;
    await (app as any).plugin(AgentEventService);
    const scheduler = new PersistentJobScheduler(app, join(directory, "jobs.json"));
    let attempts = 0;
    scheduler.register("test", "retry", async () => { attempts += 1; if (attempts < 2) throw new Error("retry me"); });
    await scheduler.load(); await scheduler.start();
    const job = await scheduler.schedule({ owner: "test", handler: "retry", maxAttempts: 2 });
    for (let index = 0; index < 30 && scheduler.list()[0]?.status !== "completed"; index += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(scheduler.list().find((item) => item.id === job.id)?.status, "completed");
    assert.equal(scheduler.list().find((item) => item.id === job.id)?.attempts, 2);
    assert.match(await readFile(join(directory, "jobs.json"), "utf8"), /retrying/);
    await scheduler.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("scheduler persists checkpoints, review state, cancellation, concurrency, and session links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-jobs-"));
  try {
    const app = new (cordis as any).Context() as Context;
    await (app as any).plugin(AgentEventService);
    const scheduler = new PersistentJobScheduler(app, { filePath: join(directory, "jobs.json"), maxConcurrent: 1, leaseMs: 1_000 });
    let active = 0; let peak = 0;
    scheduler.register("media", "review", async (_job, context) => { await context.checkpoint({ phase: "candidates" }); await context.heartbeat("scan complete"); await context.waitForReview("review duplicate candidates"); });
    scheduler.register("media", "bounded", async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 20)); active -= 1; });
    scheduler.register("media", "cancel", async (_job, context) => { await new Promise<void>((_resolve, reject) => context.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); });
    await scheduler.load(); await scheduler.start();
    const review = await scheduler.schedule({ owner: "media", handler: "review", sessionId: "session-1" });
    for (let index = 0; index < 20 && scheduler.list().find((job) => job.id === review.id)?.status !== "waiting_review"; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const reviewed = scheduler.list().find((job) => job.id === review.id)!;
    assert.equal(reviewed.sessionId, "session-1"); assert.deepEqual(reviewed.checkpoint, { phase: "candidates" }); assert.equal(reviewed.status, "waiting_review");
    await Promise.all([scheduler.schedule({ owner: "media", handler: "bounded" }), scheduler.schedule({ owner: "media", handler: "bounded" })]);
    await new Promise((resolve) => setTimeout(resolve, 70)); assert.equal(peak, 1);
    const cancellable = await scheduler.schedule({ owner: "media", handler: "cancel" });
    await new Promise((resolve) => setTimeout(resolve, 10)); await scheduler.cancel(cancellable.id);
    assert.equal(scheduler.list().find((job) => job.id === cancellable.id)?.status, "cancelled");
    assert.match(await readFile(join(directory, "jobs.json"), "utf8"), /checkpoint/);
    await scheduler.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local process sandbox uses an isolated workspace and rejects unlisted commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-sandbox-"));
  try {
    const app = new (cordis as any).Context() as Context;
    await (app as any).plugin(AgentEventService);
    const sandbox = new LocalProcessSandbox(app, { root: directory, allowedCommands: [process.execPath] });
    const result = await sandbox.run({ command: process.execPath, args: ["-e", "process.stdout.write(process.cwd())"] });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /[0-9a-f-]{36}/);
    await assert.rejects(() => sandbox.run({ command: "sh", args: ["-c", "echo unsafe"] }), /not allowed/);
    await sandbox.cleanup(result.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("closing a session cancels and drains its jobs before the session becomes closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-session-jobs-"));
  try {
    const app = new (cordis as any).Context() as Context;
    await (app as any).plugin(AgentEventService);
    const sessions = new SessionStore(app, join(directory, "sessions")); await sessions.load();
    const scheduler = new PersistentJobScheduler(app, join(directory, "jobs.json"));
    let heartbeats = 0;
    app.agentEvents.on("scheduler:heartbeat", () => { heartbeats += 1; });
    scheduler.register("media", "long", async (_job, context) => {
      await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
      await assert.rejects(() => context.heartbeat("late"), /cancelled/);
    });
    await scheduler.load(); await scheduler.start();
    const session = await sessions.create("user-a", "任务会话");
    const job = await scheduler.schedule({ owner: "media", handler: "long", sessionId: session.id });
    for (let index = 0; index < 20 && scheduler.list().find((item) => item.id === job.id)?.status !== "running"; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const closed = await sessions.close(session.id, "user-a");
    assert.ok(closed.closedAt);
    assert.equal(scheduler.list().find((item) => item.id === job.id)?.status, "cancelled");
    assert.equal(heartbeats, 0);
    await assert.rejects(() => sessions.appendInteraction(session.id, "user-a", "late", { status: "completed", model: "test", toolCalls: [], blocks: [] }), /closed/);
    await scheduler.dispose(); await sessions.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
