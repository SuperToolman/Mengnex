import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";
import type { CredentialProvider } from "./credentials.js";
import type { AgentEventService } from "./events.js";

export type ProviderSettings = { id: string; name: string; provider: "openai_compatible"; baseUrl: string; model: string; enabled: boolean; isDefault: boolean; credentialId?: string; createdAt: string; updatedAt: string };
export type PublicProviderSettings = ProviderSettings & { hasApiKey: boolean };
export type ProviderInput = { name?: string; baseUrl?: string; model?: string; enabled?: boolean; isDefault?: boolean; apiKey?: string; clearApiKey?: boolean };

export abstract class ProviderRegistry extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "providers") { super(ctx, key); }
  abstract load(): Promise<void>;
  abstract list(): PublicProviderSettings[];
  abstract configured(): ProviderSettings;
  abstract create(input: ProviderInput): Promise<PublicProviderSettings>;
  abstract update(id: string, input: ProviderInput): Promise<PublicProviderSettings>;
  abstract setDefault(id: string): Promise<PublicProviderSettings>;
  abstract delete(id: string): Promise<void>;
  abstract resolve(id?: string, profile?: string): ProviderSettings;
}

declare module "cordis" { interface Context { providers: ProviderRegistry; } }

export class FileProviderRegistry extends ProviderRegistry {
  private providers: ProviderSettings[] = [];
  private readonly filePath: string;
  private readonly credentials: CredentialProvider;
  private readonly events?: AgentEventService;
  constructor(ctx: Context, config: { filePath?: string; credentials: CredentialProvider; events?: AgentEventService }) { super(ctx, "providers"); this.filePath = config.filePath ?? join(process.cwd(), "data", "providers.json"); this.credentials = config.credentials; this.events = config.events; }
  async load() {
    try { this.providers = normalizeProviders(JSON.parse(await readFile(this.filePath, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.ensureDefault();
  }
  list() { return this.providers.map(publicProvider); }
  configured() { return this.resolve(); }
  resolve(id?: string) { const provider = (id ? this.providers.find((item) => item.id === id && item.enabled) : undefined) ?? this.providers.find((item) => item.isDefault && item.enabled) ?? this.providers.find((item) => item.enabled); if (!provider) throw new Error("no enabled default model provider is configured"); return { ...provider }; }
  async create(input: ProviderInput) { const now = new Date().toISOString(); const credentialId = input.apiKey?.trim() ? (await this.credentials.create({ kind: "model-provider", secret: input.apiKey.trim(), label: input.name })).id : undefined; const provider = this.validate({ id: randomUUID(), name: input.name ?? "", provider: "openai_compatible", baseUrl: input.baseUrl ?? "https://api.openai.com/v1", model: input.model ?? "", enabled: input.enabled ?? true, isDefault: input.isDefault ?? (this.providers.length === 0), ...(credentialId ? { credentialId } : {}), createdAt: now, updatedAt: now }); if (provider.isDefault) this.providers.forEach((item) => { item.isDefault = false; }); this.providers.push(provider); await this.save(); await this.audit("provider.create", provider.id); return publicProvider(provider); }
  async update(id: string, input: ProviderInput) { const index = this.providers.findIndex((item) => item.id === id); if (index < 0) throw new Error("model provider not found"); const current = this.providers[index]; let credentialId = current.credentialId; if (input.clearApiKey && credentialId) { await this.credentials.delete(credentialId); credentialId = undefined; } else if (input.apiKey?.trim()) { if (credentialId) await this.credentials.delete(credentialId); credentialId = (await this.credentials.create({ kind: "model-provider", secret: input.apiKey.trim(), label: input.name ?? current.name })).id; } const provider = this.validate({ ...current, name: input.name ?? current.name, baseUrl: input.baseUrl ?? current.baseUrl, model: input.model ?? current.model, enabled: input.enabled ?? current.enabled, isDefault: input.isDefault ?? current.isDefault, ...(credentialId ? { credentialId } : {}), updatedAt: new Date().toISOString() }); if (provider.isDefault && !provider.enabled) throw new Error("default model provider cannot be stopped; choose another default first"); if (provider.isDefault) this.providers.forEach((item) => { item.isDefault = false; }); this.providers[index] = provider; this.ensureDefault(); await this.save(); await this.audit("provider.update", provider.id); return publicProvider(provider); }
  async setDefault(id: string) { const provider = this.providers.find((item) => item.id === id); if (!provider) throw new Error("model provider not found"); if (!provider.enabled) throw new Error("start the model provider before setting it as default"); this.providers.forEach((item) => { item.isDefault = item.id === id; }); provider.updatedAt = new Date().toISOString(); await this.save(); await this.audit("provider.set_default", id); return publicProvider(provider); }
  async delete(id: string) { const provider = this.providers.find((item) => item.id === id); if (!provider) throw new Error("model provider not found"); if (provider.isDefault) throw new Error("default model provider cannot be deleted; choose another default first"); if (provider.credentialId) await this.credentials.delete(provider.credentialId); this.providers = this.providers.filter((item) => item.id !== id); await this.save(); await this.audit("provider.delete", id); }
  private validate(provider: ProviderSettings) { const name = provider.name.trim(); const baseUrl = provider.baseUrl.trim().replace(/\/$/, ""); const model = provider.model.trim(); if (!name) throw new Error("provider name is required"); if (!baseUrl || !["http:", "https:"].includes(new URL(baseUrl).protocol)) throw new Error("provider base URL must use http or https"); if (provider.enabled && !model) throw new Error("model is required when provider is started"); return { ...provider, name, baseUrl, model }; }
  private async audit(action: string, entityId: string) { await this.events?.audit(action, "provider", entityId); }
  private ensureDefault() { const defaults = this.providers.filter((item) => item.isDefault); if (defaults.length > 1) defaults.slice(1).forEach((item) => { item.isDefault = false; }); if (!defaults.length) this.providers.find((item) => item.enabled)?.id && (this.providers.find((item) => item.enabled)!.isDefault = true); }
  private async save() { await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify({ providers: this.providers }, null, 2), { encoding: "utf8", mode: 0o600 }); }
}

function normalizeProviders(value: unknown): ProviderSettings[] { const values = (value as { providers?: unknown })?.providers; if (!Array.isArray(values)) throw new Error("providers document must contain a providers array"); return values.map((item) => { const candidate = item as Partial<ProviderSettings> & { apiKey?: unknown }; if (!candidate || typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.baseUrl !== "string" || typeof candidate.model !== "string" || typeof candidate.provider !== "string" || typeof candidate.enabled !== "boolean" || typeof candidate.isDefault !== "boolean" || (candidate.credentialId !== undefined && typeof candidate.credentialId !== "string") || (candidate.apiKey !== undefined)) throw new Error("provider document contains an unsupported provider record"); const now = new Date().toISOString(); return { id: candidate.id, name: candidate.name, provider: "openai_compatible", baseUrl: candidate.baseUrl, model: candidate.model, enabled: candidate.enabled, isDefault: candidate.isDefault, ...(candidate.credentialId ? { credentialId: candidate.credentialId } : {}), createdAt: candidate.createdAt ?? now, updatedAt: candidate.updatedAt ?? now }; }); }
function publicProvider(provider: ProviderSettings): PublicProviderSettings { return { ...provider, hasApiKey: Boolean(provider.credentialId) }; }
