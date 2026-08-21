import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";

export type ScheduledJobStatus = "queued" | "running" | "waiting_review" | "completed" | "failed" | "cancelled";
export type ScheduledJobEvent = { at: string; type: "queued" | "leased" | "started" | "heartbeat" | "checkpoint" | "waiting_review" | "completed" | "retrying" | "failed" | "cancelled" | "recovered"; message?: string };
export type JobRetryPolicy = { maxAttempts: number; initialDelayMs: number; maxDelayMs: number; multiplier: number };
export type JobSchedule = { intervalMs?: number; cron?: string };
export type ScheduledJob = { id: string; owner: string; handler: string; payload: Record<string, unknown>; status: ScheduledJobStatus; runAt: string; attempts: number; maxAttempts: number; retryPolicy: JobRetryPolicy; schedule?: JobSchedule; sessionId?: string; checkpoint?: Record<string, unknown>; lease?: { owner: string; expiresAt: string }; heartbeatAt?: string; createdAt: string; updatedAt: string; completedAt?: string; cancelledAt?: string; lastError?: string; history: ScheduledJobEvent[] };
export type ScheduleJobInput = { id?: string; owner: string; handler: string; payload?: Record<string, unknown>; runAt?: string; maxAttempts?: number; retryPolicy?: Partial<JobRetryPolicy>; intervalMs?: number; cron?: string; sessionId?: string };
export type JobRunContext = { signal: AbortSignal; heartbeat(message?: string): Promise<void>; checkpoint(value: Record<string, unknown>): Promise<void>; waitForReview(message?: string): Promise<void> };
type JobHandler = (job: ScheduledJob, context: JobRunContext) => Promise<void>;

export abstract class JobScheduler extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "jobs") { super(ctx, key); }
  abstract load(): Promise<void>;
  abstract start(): Promise<void>;
  abstract register(owner: string, handler: string, run: JobHandler): () => void;
  abstract schedule(input: ScheduleJobInput): Promise<ScheduledJob>;
  abstract list(owner?: string): ScheduledJob[];
  abstract cancel(id: string): Promise<ScheduledJob>;
  abstract cancelBySession(sessionId: string, reason?: string): Promise<ScheduledJob[]>;
  abstract checkpoint(id: string, value: Record<string, unknown>): Promise<ScheduledJob>;
  abstract approveReview(id: string): Promise<ScheduledJob>;
}

export class PersistentJobScheduler extends JobScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private handlers = new Map<string, JobHandler>();
  private running = new Map<string, AbortController>();
  private runningTasks = new Map<string, Promise<void>>();
  private writeQueue: Promise<void> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private loaded = false;
  private dispatching = false;
  private readonly workerId = crypto.randomUUID();
  private readonly maxConcurrent: number;
  private readonly leaseMs: number;
  constructor(ctx: Context, config: string | { filePath?: string; maxConcurrent?: number; leaseMs?: number } = {}) { super(ctx); this.filePath = typeof config === "string" ? config : config.filePath ?? join(process.cwd(), "data", "jobs.json"); this.maxConcurrent = typeof config === "string" ? 2 : Math.max(1, Math.min(config.maxConcurrent ?? 2, 16)); this.leaseMs = typeof config === "string" ? 30_000 : Math.max(1_000, config.leaseMs ?? 30_000); }
  private readonly filePath: string;
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(await readFile(this.filePath, "utf8")) as ScheduledJob[];
      for (const value of saved) {
        const job = { ...value, history: value.history ?? [], retryPolicy: value.retryPolicy ?? { maxAttempts: value.maxAttempts ?? 3, initialDelayMs: 1_000, maxDelayMs: 60_000, multiplier: 2 } };
        if (job.status === "running" && (!job.lease || Date.parse(job.lease.expiresAt) <= Date.now())) { job.status = "queued"; job.lease = undefined; job.runAt = new Date().toISOString(); job.updatedAt = job.runAt; job.history.push({ at: job.runAt, type: "recovered", message: "expired lease recovered after restart" }); }
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
    const retryPolicy = { maxAttempts: Math.min(Math.max(Number(input.retryPolicy?.maxAttempts ?? input.maxAttempts ?? 3), 1), 20), initialDelayMs: Math.max(100, Number(input.retryPolicy?.initialDelayMs ?? 1_000)), maxDelayMs: Math.max(1_000, Number(input.retryPolicy?.maxDelayMs ?? 60_000)), multiplier: Math.max(1, Number(input.retryPolicy?.multiplier ?? 2)) };
    if (input.intervalMs !== undefined && (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1_000)) throw new Error("intervalMs must be at least 1000"); if (input.cron && !isCron(input.cron)) throw new Error("only */N * * * * cron expressions are supported");
    const job: ScheduledJob = { id, owner: input.owner, handler: input.handler, payload: input.payload ?? {}, status: "queued", runAt: input.runAt && !Number.isNaN(Date.parse(input.runAt)) ? input.runAt : now, attempts: 0, maxAttempts: retryPolicy.maxAttempts, retryPolicy, ...(input.intervalMs || input.cron ? { schedule: { ...(input.intervalMs ? { intervalMs: input.intervalMs } : {}), ...(input.cron ? { cron: input.cron } : {}) } } : {}), ...(input.sessionId ? { sessionId: input.sessionId } : {}), createdAt: now, updatedAt: now, history: [{ at: now, type: "queued" }] };
    this.jobs.set(id, job); await this.persist(); await this.emitJob("scheduler:queued", job); void this.dispatchDue(); return publicJob(job);
  }
  list(owner?: string) { return [...this.jobs.values()].filter((job) => !owner || job.owner === owner).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicJob); }
  async cancel(id: string) { await this.load(); const job = this.jobs.get(id); if (!job) throw new Error("scheduled job not found"); await this.cancelAndDrain(job, "job cancelled"); return publicJob(job); }
  async cancelBySession(sessionId: string, reason = "session closed") { await this.load(); const jobs = [...this.jobs.values()].filter((job) => job.sessionId === sessionId && !["completed", "failed", "cancelled"].includes(job.status)); await Promise.all(jobs.map((job) => this.cancelAndDrain(job, reason))); return jobs.map(publicJob); }
  async checkpoint(id: string, value: Record<string, unknown>) { const job = this.jobs.get(id); if (!job) throw new Error("scheduled job not found"); job.checkpoint = structuredClone(value); job.updatedAt = new Date().toISOString(); job.history.push({ at: job.updatedAt, type: "checkpoint" }); await this.persist(); await this.emitJob("scheduler:checkpoint", job); return publicJob(job); }
  async approveReview(id: string) { const job = this.jobs.get(id); if (!job || job.status !== "waiting_review") throw new Error("job is not awaiting review"); job.status = "queued"; job.runAt = new Date().toISOString(); job.updatedAt = job.runAt; job.history.push({ at: job.updatedAt, type: "queued", message: "review approved" }); await this.persist(); void this.dispatchDue(); return publicJob(job); }
  async dispose() { if (this.timer) clearInterval(this.timer); this.timer = undefined; await Promise.all([...this.jobs.values()].filter((job) => !["completed", "failed", "cancelled"].includes(job.status)).map((job) => this.cancelAndDrain(job, "scheduler disposed"))); }
  private async dispatchDue() { if (!this.loaded || this.dispatching) return; this.dispatching = true; try { const now = Date.now(); for (const job of this.jobs.values()) if (job.status === "running" && (!job.lease || Date.parse(job.lease.expiresAt) <= now)) { job.status = "queued"; job.lease = undefined; job.runAt = new Date(now).toISOString(); job.updatedAt = job.runAt; job.history.push({ at: job.updatedAt, type: "recovered", message: "lease expired" }); } for (const job of [...this.jobs.values()].filter((value) => value.status === "queued" && Date.parse(value.runAt) <= now)) { if (this.running.size >= this.maxConcurrent) break; this.track(job); } } finally { this.dispatching = false; } }
  private track(job: ScheduledJob) { const task = this.run(job); this.runningTasks.set(job.id, task); void task.finally(() => { if (this.runningTasks.get(job.id) === task) this.runningTasks.delete(job.id); }); }
  private async run(job: ScheduledJob) {
    const handler = this.handlers.get(handlerKey(job.owner, job.handler)); if (!handler) return;
    const controller = new AbortController(); this.running.set(job.id, controller); job.status = "running"; job.attempts += 1; job.lease = { owner: this.workerId, expiresAt: new Date(Date.now() + this.leaseMs).toISOString() }; job.updatedAt = new Date().toISOString(); job.history.push({ at: job.updatedAt, type: "leased" }, { at: job.updatedAt, type: "started" }); await this.persist(); await this.emitJob("scheduler:started", job);
    const assertActive = () => { if (controller.signal.aborted || job.status !== "running") throw new Error("job cancelled"); };
    const context: JobRunContext = { signal: controller.signal, heartbeat: async (message) => { assertActive(); job.heartbeatAt = new Date().toISOString(); job.lease = { owner: this.workerId, expiresAt: new Date(Date.now() + this.leaseMs).toISOString() }; job.updatedAt = job.heartbeatAt; job.history.push({ at: job.updatedAt, type: "heartbeat", message }); await this.persist(); if (!controller.signal.aborted && job.status === "running") await this.emitJob("scheduler:heartbeat", job, message); }, checkpoint: async (value) => { assertActive(); await this.checkpoint(job.id, value); assertActive(); }, waitForReview: async (message) => { assertActive(); job.status = "waiting_review"; job.lease = undefined; job.updatedAt = new Date().toISOString(); job.history.push({ at: job.updatedAt, type: "waiting_review", message }); await this.persist(); if (!controller.signal.aborted && job.status === "waiting_review") await this.emitJob("scheduler:waiting_review", job, message); } };
    try { if (controller.signal.aborted || job.status !== "running") return; await handler(publicJob(job), context); if ((job as ScheduledJob).status === "waiting_review" || controller.signal.aborted || job.status !== "running") return; if (job.schedule) { job.status = "queued"; job.attempts = 0; job.runAt = nextRun(job.schedule); job.updatedAt = new Date().toISOString(); job.history.push({ at: job.updatedAt, type: "completed", message: "recurring run completed" }); } else { job.status = "completed"; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt; job.history.push({ at: job.completedAt, type: "completed" }); } job.lease = undefined; await this.persist(); await this.emitJob("scheduler:completed", job); }
    catch (error) { const message = controller.signal.aborted ? "job cancelled" : error instanceof Error ? error.message : "scheduled job failed"; job.lastError = message; job.updatedAt = new Date().toISOString(); job.lease = undefined; if (controller.signal.aborted) { job.status = "cancelled"; job.history.push({ at: job.updatedAt, type: "cancelled", message }); } else if (job.attempts < job.retryPolicy.maxAttempts) { const delayMs = Math.min(job.retryPolicy.maxDelayMs, Math.round(job.retryPolicy.initialDelayMs * job.retryPolicy.multiplier ** (job.attempts - 1))); job.status = "queued"; job.runAt = new Date(Date.now() + delayMs).toISOString(); job.history.push({ at: job.updatedAt, type: "retrying", message }); await this.emitJob("scheduler:retrying", job, undefined, delayMs); } else { job.status = "failed"; job.history.push({ at: job.updatedAt, type: "failed", message }); await this.emitJob("scheduler:failed", job); } await this.persist(); } finally { this.running.delete(job.id); void this.dispatchDue(); }
  }
  private persist() { this.writeQueue = this.writeQueue.then(async () => { await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify([...this.jobs.values()], null, 2), { encoding: "utf8", mode: 0o600 }); }); return this.writeQueue; }
  private async cancelAndDrain(job: ScheduledJob, reason: string) { if (!["completed", "failed", "cancelled"].includes(job.status)) { this.running.get(job.id)?.abort(reason); job.status = "cancelled"; job.cancelledAt = new Date().toISOString(); job.updatedAt = job.cancelledAt; job.lease = undefined; job.history.push({ at: job.updatedAt, type: "cancelled", message: reason }); await this.persist(); await this.emitJob("scheduler:cancelled", job); } await this.runningTasks.get(job.id); }
  private async emitJob(name: "scheduler:queued" | "scheduler:started" | "scheduler:completed" | "scheduler:retrying" | "scheduler:failed" | "scheduler:cancelled" | "scheduler:heartbeat" | "scheduler:checkpoint" | "scheduler:waiting_review", job: ScheduledJob, message?: string, delayMs?: number) { const payload = name === "scheduler:retrying" ? { job: publicJob(job), delayMs: delayMs ?? 0 } : name === "scheduler:heartbeat" || name === "scheduler:waiting_review" ? { job: publicJob(job), message } : { job: publicJob(job) }; await this.ctx.agentEvents?.emit(name, payload as any, "scheduler", { actorId: job.owner, sessionId: job.sessionId, parentJobId: job.id }); }
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
function isCron(value: string) { return /^\*\/\d+ \* \* \* \*$/.test(value); }
function nextRun(schedule: JobSchedule) { if (schedule.intervalMs) return new Date(Date.now() + schedule.intervalMs).toISOString(); const minutes = Number(schedule.cron?.match(/^\*\/(\d+)/)?.[1] ?? 1); return new Date(Date.now() + minutes * 60_000).toISOString(); }
function publicJob(job: ScheduledJob): ScheduledJob { return { ...job, payload: structuredClone(job.payload), history: job.history.map((event) => ({ ...event })) }; }
function normalizeCommand(value: string) { return process.platform === "win32" ? basename(value).toLowerCase() : resolve(value); }
function isWithin(root: string, target: string) { const path = relative(resolve(root), resolve(target)); return !path.startsWith("..") && !path.includes(":"); }
async function executeProcess(command: string, args: string[], cwd: string, env: Record<string, string>, input: string | undefined, timeoutMs: number, maxOutputBytes: number): Promise<SandboxResult> {
  return new Promise((resolveResult, reject) => { const id = crypto.randomUUID(); const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { PATH: process.env.PATH ?? "", HOME: cwd, TEMP: cwd, TMP: cwd, ...env }, stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; let timedOut = false; const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-maxOutputBytes); child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); }); child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); }); child.once("error", reject); const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs); child.once("close", (exitCode, signal) => { clearTimeout(timer); resolveResult({ id, exitCode, signal, stdout, stderr, timedOut, workspace: cwd }); }); if (input) child.stdin.write(input); child.stdin.end(); });
}

declare module "cordis" { interface Context { jobs: JobScheduler; sandbox: SandboxProvider; } }
