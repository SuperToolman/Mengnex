import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";
import type { AgentPolicySettings, ExecutionMode } from "./types.js";

const defaults: AgentPolicySettings = { executionMode: "approve_high_risk", allowedCapabilities: ["media.search", "tasks.read"] };
export abstract class ExecutionPolicy extends (cordis as any).Service { protected constructor(ctx: Context, key = "policy") { super(ctx, key); } abstract load(): Promise<void>; abstract view(): AgentPolicySettings; abstract update(input: Partial<AgentPolicySettings>): Promise<AgentPolicySettings>; }
declare module "cordis" { interface Context { policy: ExecutionPolicy; } }
export class FileExecutionPolicy extends ExecutionPolicy {
  private value: AgentPolicySettings = { ...defaults, allowedCapabilities: [...defaults.allowedCapabilities] };
  constructor(ctx: Context, private readonly filePath = join(process.cwd(), "data", "policy.json"), private readonly legacyPath = join(process.cwd(), "data", "settings.json")) { super(ctx, "policy"); }
  async load() { try { this.value = normalize(JSON.parse(await readFile(this.filePath, "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; try { this.value = normalize(JSON.parse(await readFile(this.legacyPath, "utf8"))); await this.save(); } catch (legacyError) { if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError; } } }
  view() { return { ...this.value, allowedCapabilities: [...this.value.allowedCapabilities] }; }
  async update(input: Partial<AgentPolicySettings>) { if (input.executionMode !== undefined && !isMode(input.executionMode)) throw new Error("execution mode is invalid"); if (input.allowedCapabilities !== undefined && !input.allowedCapabilities.every((item) => typeof item === "string" && item.trim())) throw new Error("allowed capabilities must be non-empty strings"); this.value = { executionMode: input.executionMode ?? this.value.executionMode, allowedCapabilities: input.allowedCapabilities?.map((item) => item.trim()) ?? this.value.allowedCapabilities }; await this.save(); return this.view(); }
  private async save() { await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify({ policy: this.value }, null, 2), { encoding: "utf8", mode: 0o600 }); }
}
function normalize(value: unknown): AgentPolicySettings { const policy = (value as { policy?: Partial<AgentPolicySettings> })?.policy; return { executionMode: isMode(policy?.executionMode) ? policy.executionMode : defaults.executionMode, allowedCapabilities: Array.isArray(policy?.allowedCapabilities) ? policy.allowedCapabilities.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [...defaults.allowedCapabilities] }; }
function isMode(value: unknown): value is ExecutionMode { return value === "request_approval" || value === "approve_high_risk" || value === "full_access"; }
