import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as cordis from "cordis";
import type { Context } from "cordis";

export type JsonSchema = { type: "object"; properties?: Record<string, { type: string }>; required?: string[]; additionalProperties?: boolean };
export type SettingRecord = Record<string, unknown>;
export type SettingSnapshot = { namespace: string; value: SettingRecord; revision: number; updatedAt: string };
export type SettingsWatcher = (snapshot: SettingSnapshot) => void | Promise<void>;

export abstract class SettingsProvider extends (cordis as any).Service {
  protected constructor(ctx: Context, key = "settings") { super(ctx, key); }
  abstract load(): Promise<void>;
  abstract get(namespace: string): SettingSnapshot;
  abstract define(namespace: string, schema: JsonSchema, defaults?: SettingRecord): Promise<SettingSnapshot>;
  abstract watch(namespace: string, watcher: SettingsWatcher): () => void;
  abstract mutate(namespace: string, expectedRevision: number | undefined, mutate: (value: SettingRecord) => SettingRecord): Promise<SettingSnapshot>;
}

declare module "cordis" { interface Context { settings: SettingsProvider } }

type Stored = { revision: number; value: SettingRecord; schema: JsonSchema; updatedAt: string };

export class FileSettingsProvider extends SettingsProvider {
  private readonly values = new Map<string, Stored>();
  private readonly watchers = new Map<string, Set<SettingsWatcher>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(ctx: Context, private readonly filePath = join(process.cwd(), "data", "settings.json")) { super(ctx); }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, Stored>;
      for (const [namespace, value] of Object.entries(parsed)) if (value && Number.isSafeInteger(value.revision) && value.value && value.schema) this.values.set(namespace, value);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  get(namespace: string) {
    const value = this.values.get(namespace);
    if (!value) throw new Error(`settings namespace not defined: ${namespace}`);
    return snapshot(namespace, value);
  }

  async define(namespace: string, schema: JsonSchema, defaults: SettingRecord = {}) {
    assertSchema(schema);
    const current = this.values.get(namespace);
    if (current) return this.get(namespace);
    const value = { revision: 0, value: validate(schema, defaults), schema, updatedAt: new Date().toISOString() };
    this.values.set(namespace, value);
    await this.persist();
    return snapshot(namespace, value);
  }

  watch(namespace: string, watcher: SettingsWatcher) {
    const set = this.watchers.get(namespace) ?? new Set<SettingsWatcher>();
    set.add(watcher); this.watchers.set(namespace, set);
    return () => set.delete(watcher);
  }

  async mutate(namespace: string, expectedRevision: number | undefined, mutate: (value: SettingRecord) => SettingRecord) {
    const current = this.values.get(namespace);
    if (!current) throw new Error(`settings namespace not defined: ${namespace}`);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error(`settings revision conflict for ${namespace}`);
    const nextValue = validate(current.schema, mutate(structuredClone(current.value)));
    const next = { ...current, value: nextValue, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    this.values.set(namespace, next);
    await this.persist();
    const result = snapshot(namespace, next);
    await (this.ctx as any).agentEvents?.audit("settings.mutate", "settings", namespace, { revision: result.revision });
    await Promise.all([...this.watchers.get(namespace) ?? []].map((watcher) => watcher(result)));
    return result;
  }

  private persist() {
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(Object.fromEntries(this.values), null, 2), { encoding: "utf8", mode: 0o600 });
    });
    return this.queue;
  }
}

function snapshot(namespace: string, value: Stored): SettingSnapshot { return { namespace, value: structuredClone(value.value), revision: value.revision, updatedAt: value.updatedAt }; }
function assertSchema(schema: JsonSchema) { if (!schema || schema.type !== "object") throw new Error("settings schema must be an object schema"); }
function validate(schema: JsonSchema, value: SettingRecord): SettingRecord {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("settings value must be an object");
  for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`missing required setting: ${key}`);
  if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!schema.properties?.[key]) throw new Error(`unknown setting: ${key}`);
  for (const [key, field] of Object.entries(schema.properties ?? {})) if (key in value && typeof value[key] !== field.type) throw new Error(`setting ${key} must be ${field.type}`);
  return structuredClone(value);
}
