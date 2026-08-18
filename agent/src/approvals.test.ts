import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { ApprovalService } from "./approvals.js";

test("pending approvals survive an Agent Gateway restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  const filePath = join(directory, "approvals.json");
  try {
    const first = new (cordis as any).Context() as Context;
    const installFirst = (first as any).plugin.bind(first) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await installFirst(ApprovalService, filePath);
    await first.approvals.create({ id: "approval-1", toolName: "tasks.create_scan", args: { library_id: "library-1" }, userId: "user-1", risk: "high", status: "pending", createdAt: new Date().toISOString() });

    const second = new (cordis as any).Context() as Context;
    const installSecond = (second as any).plugin.bind(second) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await installSecond(ApprovalService, filePath);
    await second.approvals.load();
    assert.equal(second.approvals.getPending("approval-1")?.userId, "user-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
