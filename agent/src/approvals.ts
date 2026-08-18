import * as cordis from "cordis";
import type { Context } from "cordis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Approval } from "./types.js";

declare module "cordis" {
  interface Context {
    approvals: ApprovalService;
  }
}

export class ApprovalService extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly pending = new Map<string, Approval>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(ctx: Context, private readonly filePath = join(process.cwd(), "data", "approvals.json")) {
    super(ctx, "approvals");
  }

  async load() {
    try {
      const approvals = JSON.parse(await readFile(this.filePath, "utf8")) as Approval[];
      this.pending.clear();
      for (const approval of approvals) this.pending.set(approval.id, approval);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async create(approval: Approval) {
    this.pending.set(approval.id, approval);
    await this.persist();
    return approval;
  }

  getPending(id: string) {
    const approval = this.pending.get(id);
    return approval?.status === "pending" ? approval : undefined;
  }

  async save() {
    await this.persist();
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify([...this.pending.values()], null, 2), { encoding: "utf8", mode: 0o600 });
    });
    return this.writeQueue;
  }
}
