import { join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { FileSettingsProvider } from "./settings.js";

export type ModelSelection = { profile: string; providerId?: string; model?: string; revision: number };
export abstract class ModelSelectionService extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "modelSelection") { super(ctx, key); }
  abstract load(): Promise<void>;
  abstract resolve(profile?: string): ModelSelection;
  abstract set(profile: string, providerId?: string, model?: string, expectedRevision?: number): Promise<ModelSelection>;
}
declare module "cordis" { interface Context { modelSelection: ModelSelectionService } }

export class FileModelSelection extends ModelSelectionService {
  private readonly values = new Map<string, ModelSelection>();
  private settings: FileSettingsProvider;
  constructor(ctx: Context, settings?: FileSettingsProvider) { super(ctx); this.settings = settings ?? new FileSettingsProvider(ctx, join(process.cwd(), "data", "settings.json")); }
  async load() { await this.settings.load(); await this.settings.define("model-selection", { type: "object", additionalProperties: false, properties: { profiles: { type: "object" } } }, { profiles: {} }); const profiles = this.settings.get("model-selection").value.profiles; if (profiles && typeof profiles === "object") for (const [profile, value] of Object.entries(profiles as Record<string, unknown>)) { const item = value as Partial<ModelSelection>; this.values.set(profile, { profile, providerId: typeof item.providerId === "string" ? item.providerId : undefined, model: typeof item.model === "string" ? item.model : undefined, revision: this.settings.get("model-selection").revision }); } }
  resolve(profile = process.env.AGENT_PROFILE ?? "default") { return { profile, revision: this.values.get(profile)?.revision ?? this.settings.get("model-selection").revision, providerId: this.values.get(profile)?.providerId, model: this.values.get(profile)?.model }; }
  async set(profile: string, providerId?: string, model?: string, expectedRevision?: number) { const result = await this.settings.mutate("model-selection", expectedRevision, (value) => ({ ...value, profiles: { ...(value.profiles as Record<string, unknown>), [profile]: { ...(providerId ? { providerId } : {}), ...(model ? { model } : {}) } } })); const selection = { profile, providerId, model, revision: result.revision }; this.values.set(profile, selection); await (this.ctx as any).agentEvents?.audit("model-selection.set", "model-selection", profile, { providerId, model, revision: result.revision }); return selection; }
}
