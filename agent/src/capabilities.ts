import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";

export abstract class KeyValueStorage extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "storage") { super(ctx, key); }
  abstract get<T>(key: string): Promise<T | undefined>;
  abstract set<T>(key: string, value: T): Promise<void>;
}

export class FileKeyValueStorage extends KeyValueStorage {
  private data: Record<string, unknown> = {};
  private loaded = false;
  constructor(ctx: Context, private readonly path = join(process.cwd(), "data", "storage.json")) { super(ctx); }
  async get<T>(key: string) { await this.load(); return this.data[key] as T | undefined; }
  async set<T>(key: string, value: T) { await this.load(); this.data[key] = value; await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 }); }
  private async load() { if (this.loaded) return; this.loaded = true; try { this.data = JSON.parse(await readFile(this.path, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}

export type ScheduledJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ScheduledJobEvent = { at: string; type: "queued" | "started" | "completed" | "retrying" | "failed" | "cancelled" | "recovered"; message?: string };
export type ScheduledJob = { id: string; owner: string; handler: string; payload: Record<string, unknown>; status: ScheduledJobStatus; runAt: string; attempts: number; maxAttempts: number; createdAt: string; updatedAt: string; completedAt?: string; lastError?: string; history: ScheduledJobEvent[] };
export type ScheduleJobInput = { id?: string; owner: string; handler: string; payload?: Record<string, unknown>; runAt?: string; maxAttempts?: number };
type JobHandler = (job: ScheduledJob) => Promise<void>;

export abstract class JobScheduler extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "jobs") { super(ctx, key); }
  abstract load(): Promise<void>;
  abstract start(): Promise<void>;
  abstract register(owner: string, handler: string, run: JobHandler): () => void;
  abstract schedule(input: ScheduleJobInput): Promise<ScheduledJob>;
  abstract list(owner?: string): ScheduledJob[];
  abstract cancel(id: string): Promise<ScheduledJob>;
}

export class PersistentJobScheduler extends JobScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private handlers = new Map<string, JobHandler>();
  private writeQueue: Promise<void> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private loaded = false;
  private dispatching = false;
  constructor(ctx: Context, private readonly filePath = join(process.cwd(), "data", "jobs.json")) { super(ctx); }
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(await readFile(this.filePath, "utf8")) as ScheduledJob[];
      for (const value of saved) {
        const job = { ...value, history: value.history ?? [] };
        if (job.status === "running") { job.status = "queued"; job.runAt = new Date().toISOString(); job.updatedAt = job.runAt; job.history.push({ at: job.runAt, type: "recovered", message: "agent restarted before job completed" }); }
        this.jobs.set(job.id, job);
      }
      await this.persist();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  async start() { await this.load(); if (!this.timer) this.timer = setInterval(() => void this.dispatchDue(), 500); await this.dispatchDue(); }
  register(owner: string, handler: string, run: JobHandler) { const key = handlerKey(owner, handler); if (this.handlers.has(key)) throw new Error("job handler already registered: " + owner + "/" + handler); this.handlers.set(key, run); void this.dispatchDue(); return () => this.handlers.delete(key); }
  async schedule(input: ScheduleJobInput) {
    await this.load();
    if (!input.owner.trim() || !input.handler.trim()) throw new Error("job owner and handler are required");
    const now = new Date().toISOString(); const id = input.id ?? crypto.randomUUID();
    if (this.jobs.has(id)) throw new Error("scheduled job id already exists");
    const job: ScheduledJob = { id, owner: input.owner, handler: input.handler, payload: input.payload ?? {}, status: "queued", runAt: input.runAt && !Number.isNaN(Date.parse(input.runAt)) ? input.runAt : now, attempts: 0, maxAttempts: Math.min(Math.max(Number(input.maxAttempts ?? 3), 1), 10), createdAt: now, updatedAt: now, history: [{ at: now, type: "queued" }] };
    this.jobs.set(id, job); await this.persist(); await this.ctx.agentEvents?.emit("scheduler:queued", { job: publicJob(job) }); void this.dispatchDue(); return publicJob(job);
  }
  list(owner?: string) { return [...this.jobs.values()].filter((job) => !owner || job.owner === owner).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicJob); }
  async cancel(id: string) { await this.load(); const job = this.jobs.get(id); if (!job) throw new Error("scheduled job not found"); if (!["completed", "failed", "cancelled"].includes(job.status)) { job.status = "cancelled"; job.updatedAt = new Date().toISOString(); job.history.push({ at: job.updatedAt, type: "cancelled" }); await this.persist(); await this.ctx.agentEvents?.emit("scheduler:cancelled", { job: publicJob(job) }); } return publicJob(job); }
  async dispose() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async dispatchDue() { if (!this.loaded || this.dispatching) return; this.dispatching = true; try { for (const job of [...this.jobs.values()].filter((value) => value.status === "queued" && Date.parse(value.runAt) <= Date.now())) await this.run(job); } finally { this.dispatching = false; } }
  private async run(job: ScheduledJob) {
    const handler = this.handlers.get(handlerKey(job.owner, job.handler)); if (!handler) return;
    job.status = "running"; job.attempts += 1; job.updatedAt = new Date().toISOString(); job.history.push({ at: job.updatedAt, type: "started" }); await this.persist(); await this.ctx.agentEvents?.emit("scheduler:started", { job: publicJob(job) });
    try { await handler(publicJob(job)); job.status = "completed"; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt; job.history.push({ at: job.completedAt, type: "completed" }); await this.persist(); await this.ctx.agentEvents?.emit("scheduler:completed", { job: publicJob(job) }); }
    catch (error) { const message = error instanceof Error ? error.message : "scheduled job failed"; job.lastError = message; job.updatedAt = new Date().toISOString(); if (job.attempts < job.maxAttempts) { const delayMs = Math.min(60_000, 1_000 * 2 ** (job.attempts - 1)); job.status = "queued"; job.runAt = new Date(Date.now() + delayMs).toISOString(); job.history.push({ at: job.updatedAt, type: "retrying", message }); await this.ctx.agentEvents?.emit("scheduler:retrying", { job: publicJob(job), delayMs }); } else { job.status = "failed"; job.history.push({ at: job.updatedAt, type: "failed", message }); await this.ctx.agentEvents?.emit("scheduler:failed", { job: publicJob(job) }); } await this.persist(); }
  }
  private persist() { this.writeQueue = this.writeQueue.then(async () => { await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify([...this.jobs.values()], null, 2), { encoding: "utf8", mode: 0o600 }); }); return this.writeQueue; }
}

export type SandboxCommand = { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number };
export type SandboxResult = { id: string; exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean; workspace: string };
export abstract class SandboxProvider extends (cordis as any).Service { protected constructor(ctx: Context, key = "sandbox") { super(ctx, key); } abstract available(): boolean; abstract run(command: SandboxCommand): Promise<SandboxResult>; }

/** No-shell process isolation, per-run workspace, bounded output and timeout. Not an OS security boundary. */
export class LocalProcessSandbox extends SandboxProvider {
  private readonly allowedCommands: Set<string>;
  constructor(ctx: Context, private readonly options: { root?: string; allowedCommands?: string[]; timeoutMs?: number; maxOutputBytes?: number } = {}) { super(ctx); this.allowedCommands = new Set((options.allowedCommands?.length ? options.allowedCommands : [process.execPath]).map(normalizeCommand)); }
  available() { return true; }
  async run(command: SandboxCommand): Promise<SandboxResult> {
    const executable = command.command.trim(); if (!executable) throw new Error("sandbox command is required"); if (!this.allowedCommands.has(normalizeCommand(executable))) throw new Error("sandbox command is not allowed: " + basename(executable));
    const id = crypto.randomUUID(); const root = resolve(this.options.root ?? join(process.cwd(), "data", "sandbox")); const workspace = resolve(root, id); await mkdir(workspace, { recursive: true }); const cwd = command.cwd ? resolve(workspace, command.cwd) : workspace; if (!isWithin(workspace, cwd)) throw new Error("sandbox cwd must stay inside the run workspace"); await mkdir(cwd, { recursive: true });
    const result = await executeProcess(executable, command.args?.map(String) ?? [], cwd, command.env ?? {}, command.input, Math.min(Math.max(Number(command.timeoutMs ?? this.options.timeoutMs ?? 30_000), 100), 300_000), Math.min(Math.max(Number(this.options.maxOutputBytes ?? 1_000_000), 1_024), 10_000_000));
    await this.ctx.agentEvents?.emit("sandbox:completed", { result }); return result;
  }
  async cleanup(id: string) { const root = resolve(this.options.root ?? join(process.cwd(), "data", "sandbox")); const workspace = resolve(root, id); if (!isWithin(root, workspace)) throw new Error("sandbox workspace must stay inside the sandbox root"); await rm(workspace, { recursive: true, force: true }); }
}

function handlerKey(owner: string, handler: string) { return owner + ":" + handler; }
function publicJob(job: ScheduledJob): ScheduledJob { return { ...job, payload: structuredClone(job.payload), history: job.history.map((event) => ({ ...event })) }; }
function normalizeCommand(value: string) { return process.platform === "win32" ? basename(value).toLowerCase() : resolve(value); }
function isWithin(root: string, target: string) { const path = relative(resolve(root), resolve(target)); return !path.startsWith("..") && !path.includes(":"); }
async function executeProcess(command: string, args: string[], cwd: string, env: Record<string, string>, input: string | undefined, timeoutMs: number, maxOutputBytes: number): Promise<SandboxResult> {
  return new Promise((resolveResult, reject) => { const id = crypto.randomUUID(); const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { PATH: process.env.PATH ?? "", HOME: cwd, TEMP: cwd, TMP: cwd, ...env }, stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; let timedOut = false; const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-maxOutputBytes); child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); }); child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); }); child.once("error", reject); const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs); child.once("close", (exitCode, signal) => { clearTimeout(timer); resolveResult({ id, exitCode, signal, stdout, stderr, timedOut, workspace: cwd }); }); if (input) child.stdin.write(input); child.stdin.end(); });
}

declare module "cordis" { interface Context { storage: KeyValueStorage; jobs: JobScheduler; sandbox: SandboxProvider; } }
