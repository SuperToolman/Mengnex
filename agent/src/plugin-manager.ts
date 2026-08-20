import * as cordis from "cordis";
import type { Context } from "cordis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PluginConfigSchema = {
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, PluginConfigField>;
  required?: string[];
  additionalProperties?: boolean;
};

export type PluginConfigField = {
  type: "string" | "number" | "boolean" | "array" | "object";
  title: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  format?: "password" | "path" | "textarea";
  properties?: Record<string, PluginConfigField>;
  required?: string[];
  items?: PluginConfigField;
};

export type PluginUiContribution = {
  settings: {
    label: string;
    description: string;
    icon?: string;
  };
};

export type PluginClientModule = { entryPath: string };

export type PluginDefinition = {
  id: string;
  name: string;
  version: string;
  description: string;
  kind: "runtime" | "model" | "tool" | "storage" | "loop" | "skill" | "sandbox" | "scheduler" | "ui" | "integration";
  dependencies: string[];
  provides: string[];
  /** Exclusive capabilities. Installing another provider swaps the active plugin. */
  slots?: string[];
  permissions: string[];
  origin: "builtin" | "local";
  defaultEnabled?: boolean;
  required?: boolean;
  configurable: boolean;
  /** Declarative config and settings contribution consumed by the trusted Web host. */
  configSchema?: PluginConfigSchema;
  ui?: PluginUiContribution;
  /** Trusted browser module, served only to authenticated local managers. */
  client?: PluginClientModule;
  create: (config: Record<string, unknown>) => unknown | Promise<unknown>;
};

type PluginState = { enabled: boolean; config: Record<string, unknown> };
export type PluginRevision = { id: string; version: string; enabled: boolean; config: Record<string, unknown>; createdAt: string };
type StoredPluginState = PluginState & { version?: string; source?: "builtin" | "local"; revisions?: PluginRevision[] };
export type PublicPlugin = Omit<PluginDefinition, "create" | "client"> & { enabled: boolean; config: Record<string, unknown>; active: boolean; hasClientModule: boolean; installedVersion: string; availableVersion: string; updateAvailable: boolean; revisions: PluginRevision[] };

declare module "cordis" {
  interface Context {
    pluginManager: PluginManagerService;
  }
}

export class PluginManagerService extends (cordis as any).Service {
  protected declare readonly ctx: Context;
  private readonly definitions = new Map<string, PluginDefinition>();
  private readonly states = new Map<string, PluginState>();
  private readonly fibers = new Map<string, { dispose: () => Promise<void> }>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(ctx: Context, private readonly filePath = join(process.cwd(), "data", "plugins.json")) {
    super(ctx, "pluginManager");
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, StoredPluginState>;
      for (const [id, state] of Object.entries(saved)) {
        // The early-development state format is intentionally non-compatible.
        if (typeof state.enabled !== "boolean") continue;
        this.states.set(id, { enabled: state.enabled === true, config: state.config ?? {}, version: state.version, source: state.source, revisions: state.revisions ?? [] } as PluginState);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  register(definition: PluginDefinition) {
    if (this.definitions.has(definition.id)) throw new Error(`plugin already registered: ${definition.id}`);
    if (definition.configSchema && !definition.ui?.settings) {
      throw new Error(`plugin ${definition.id} declares configSchema without ui.settings`);
    }
    this.definitions.set(definition.id, definition);
    (this.ctx as any).pluginUi?.register(definition);
    if (!this.states.has(definition.id)) this.states.set(definition.id, { enabled: definition.defaultEnabled === true, config: {}, version: definition.version, source: definition.origin, revisions: [] } as PluginState);
  }

  list(): PublicPlugin[] {
    return [...this.definitions.values()].map(({ create: _create, client, ...definition }) => {
      const state = this.states.get(definition.id) ?? { enabled: false, config: {} };
      const stored = state as PluginState & { version?: string; source?: "builtin" | "local"; revisions?: PluginRevision[] };
      const installedVersion = stored.version ?? definition.version;
      return { ...definition, enabled: state.enabled, config: state.config, active: this.fibers.has(definition.id), hasClientModule: Boolean(client), installedVersion, availableVersion: definition.version, updateAvailable: installedVersion !== definition.version, revisions: stored.revisions ?? [] };
    });
  }

  async startEnabled() {
    for (const plugin of this.definitions.values()) if (this.states.get(plugin.id)?.enabled) await this.enable(plugin.id);
  }

  applyComposition(overrides: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>) {
    for (const [id, override] of Object.entries(overrides)) {
      if (!this.definitions.has(id)) throw new Error(`composition references unknown plugin: ${id}`);
      const current = this.states.get(id)!;
      this.states.set(id, { enabled: override.enabled ?? current.enabled, config: override.config ?? current.config });
    }
  }

  async enable(id: string, visiting = new Set<string>()) {
    if (visiting.has(id)) throw new Error(`plugin dependency cycle: ${[...visiting, id].join(" -> ")}`);
    const definition = this.definition(id);
    visiting.add(id);
    for (const dependency of definition.dependencies) await this.enable(this.resolveDependency(dependency), visiting);
    visiting.delete(id);
    const state = this.states.get(id) ?? { enabled: false, config: {} };
    const pausedDependents: string[] = [];
    for (const slot of definition.slots ?? []) {
      const current = this.list().find((plugin) => plugin.id !== id && plugin.enabled && plugin.slots?.includes(slot));
      if (current) {
        if (current.required) throw new Error(`slot ${slot} is owned by required plugin ${current.id}`);
        pausedDependents.push(...await this.pauseDependents(current.id));
        await this.unload(current.id);
        this.states.set(current.id, { ...this.states.get(current.id)!, enabled: false });
      }
    }
    if (!this.fibers.has(id)) {
      await (this.ctx as any).agentEvents?.emit("plugin:starting", { pluginId: id });
      const fiber = await ((this.ctx as any).root as any).plugin(await definition.create(state.config));
      this.fibers.set(id, fiber);
      await (this.ctx as any).agentEvents?.emit("plugin:started", { pluginId: id });
    }
    this.states.set(id, { ...state, enabled: true });
    for (const dependent of pausedDependents) await this.enable(dependent);
    await this.persist();
    return this.publicPlugin(id);
  }

  async update(id: string, config: Record<string, unknown>, enabled: boolean) {
    const definition = this.definition(id);
    if (definition.required && !enabled) throw new Error("required plugin cannot be disabled");
    const current = this.states.get(id) as StoredPluginState | undefined;
    if (current) this.snapshot(id, current);
    this.states.set(id, { enabled, config: validatePluginConfig(definition, config), version: definition.version, source: definition.origin, revisions: current?.revisions ?? [] } as PluginState);
    if (this.fibers.has(id)) await this.stopCascade(id);
    await this.persist();
    return enabled ? this.enable(id) : this.publicPlugin(id);
  }

  async disable(id: string) {
    const definition = this.definition(id);
    if (definition.required) throw new Error("required plugin cannot be disabled");
    await this.stopCascade(id);
    const state = this.states.get(id) ?? { enabled: false, config: {} };
    this.states.set(id, { ...state, enabled: false });
    await this.persist();
  }

  async updatePackage(id: string) {
    const definition = this.definition(id);
    const current = (this.states.get(id) ?? { enabled: false, config: {} }) as StoredPluginState;
    this.snapshot(id, current);
    this.states.set(id, { ...current, version: definition.version, source: definition.origin } as PluginState);
    if (this.fibers.has(id)) await this.stopCascade(id);
    await this.persist();
    return current.enabled ? this.enable(id) : this.publicPlugin(id);
  }

  async rollback(id: string, revisionId: string) {
    const definition = this.definition(id);
    const current = (this.states.get(id) ?? { enabled: false, config: {} }) as StoredPluginState;
    const revision = current.revisions?.find((entry) => entry.id === revisionId);
    if (!revision) throw new Error("plugin revision not found");
    if (this.fibers.has(id)) await this.stopCascade(id);
    this.states.set(id, { ...current, enabled: revision.enabled, config: validatePluginConfig(definition, revision.config), version: revision.version } as PluginState);
    await this.persist();
    return revision.enabled ? this.enable(id) : this.publicPlugin(id);
  }

  private definition(id: string) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error("plugin not found");
    return definition;
  }

  private resolveDependency(spec: string) {
    const separator = spec.indexOf("@");
    const id = separator > 0 ? spec.slice(0, separator) : spec;
    const range = separator > 0 ? spec.slice(separator + 1) : undefined;
    const definition = this.definition(id);
    if (range && !satisfies(definition.version, range)) throw new Error("plugin dependency " + spec + " is not satisfied by " + definition.version);
    return id;
  }

  private snapshot(id: string, state: StoredPluginState) {
    const revisions = state.revisions ?? [];
    revisions.unshift({ id: crypto.randomUUID(), version: state.version ?? this.definition(id).version, enabled: state.enabled, config: structuredClone(state.config), createdAt: new Date().toISOString() });
    state.revisions = revisions.slice(0, 10);
  }

  clientModule(id: string) { return this.definition(id).client; }

  private publicPlugin(id: string) {
    const plugin = this.list().find((entry) => entry.id === id);
    if (!plugin) throw new Error("plugin not found");
    return plugin;
  }

  private async unload(id: string) {
    const fiber = this.fibers.get(id);
    if (fiber) {
      await (this.ctx as any).agentEvents?.emit("plugin:stopping", { pluginId: id });
      await fiber.dispose();
      await (this.ctx as any).agentEvents?.emit("plugin:stopped", { pluginId: id });
    }
    this.fibers.delete(id);
  }

  private activeDependents(id: string, collected = new Set<string>()): string[] {
    for (const plugin of this.list()) {
      if (plugin.enabled && plugin.active && plugin.dependencies.includes(id) && !collected.has(plugin.id)) {
        collected.add(plugin.id); this.activeDependents(plugin.id, collected);
      }
    }
    return [...collected];
  }

  private async pauseDependents(id: string) {
    const dependents = this.activeDependents(id);
    for (const dependent of [...dependents].reverse()) await this.unload(dependent);
    return dependents.reverse();
  }

  private async stopCascade(id: string) {
    const definition = this.definition(id);
    const dependents = this.activeDependents(id);
    const required = dependents.filter((dependent) => this.definition(dependent).required);
    if (required.length) throw new Error(`plugin is required by: ${required.map((dependent) => this.definition(dependent).name).join(", ")}`);
    for (const dependent of [...dependents].reverse()) {
      await this.unload(dependent);
      const state = this.states.get(dependent)!;
      this.states.set(dependent, { ...state, enabled: false });
    }
    await this.unload(definition.id);
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(Object.fromEntries(this.states), null, 2), { encoding: "utf8", mode: 0o600 });
    });
    return this.writeQueue;
  }
}

function validatePluginConfig(definition: PluginDefinition, config: Record<string, unknown>) {
  if (!definition.configSchema) return config;
  if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("plugin configuration must be an object");
  const schema = definition.configSchema;
  const unknown = Object.keys(config).filter((key) => !schema.properties[key]);
  if (unknown.length && schema.additionalProperties === false) throw new Error(`unknown configuration fields: ${unknown.join(", ")}`);
  for (const key of schema.required ?? []) if (config[key] === undefined || config[key] === "") throw new Error(`${schema.properties[key]?.title ?? key} is required`);
  for (const [key, field] of Object.entries(schema.properties)) {
    if (config[key] !== undefined) validateField(field, config[key], key);
  }
  return config;
}

function validateField(field: PluginConfigField, value: unknown, path: string): void {
  if (field.type === "string" && typeof value !== "string") throw new Error(`${path} must be a string`);
  if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${path} must be a number`);
  if (field.type === "boolean" && typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  if (field.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    if (field.items) value.forEach((item, index) => validateField(field.items!, item, `${path}[${index}]`));
  }
  if (field.type === "object") {
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${path} must be an object`);
    const object = value as Record<string, unknown>;
    for (const key of field.required ?? []) if (object[key] === undefined || object[key] === "") throw new Error(`${path}.${field.properties?.[key]?.title ?? key} is required`);
    for (const [key, nested] of Object.entries(field.properties ?? {})) if (object[key] !== undefined) validateField(nested, object[key], `${path}.${key}`);
  }
  if (field.enum && !field.enum.includes(String(value))) throw new Error(`${path} must be one of: ${field.enum.join(", ")}`);
}

function satisfies(version: string, range: string) {
  if (range === "*" || range === "") return true;
  if (range.startsWith("^")) {
    const [major] = version.split(".").map(Number);
    const [requiredMajor] = range.slice(1).split(".").map(Number);
    return major === requiredMajor && compareVersion(version, range.slice(1)) >= 0;
  }
  if (range.startsWith(">=")) return compareVersion(version, range.slice(2)) >= 0;
  return compareVersion(version, range) === 0;
}

function compareVersion(left: string, right: string) {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}
