import * as cordis from "cordis";
import type { Context } from "cordis";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1;
export type PluginRole = "provider" | "consumer" | "provider-consumer";
export type CapabilityContract = { id: string; version: string; role: PluginRole; schema?: Record<string, unknown> };
export type PluginSource = { kind: "builtin" | "local"; path?: string; sha256?: string; manifestVersion: number };
export type PluginHealth = { status: "healthy" | "blocked" | "failed"; reason?: string; checkedAt: string };

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
  capabilityContracts?: CapabilityContract[];
  consumes?: string[];
  role?: PluginRole;
  packageSource?: PluginSource;
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

type PluginState = { enabled: boolean; config: Record<string, unknown>; version?: string; status?: "installed" | "active" | "blocked" | "failed"; error?: string; health?: PluginHealth; source?: PluginSource; revisions?: PluginRevision[] };
export type PluginRevision = { id: string; version: string; enabled: boolean; config: Record<string, unknown>; createdAt: string };
type StoredPluginState = PluginState;
export type PublicPlugin = Omit<PluginDefinition, "create" | "client"> & { enabled: boolean; config: Record<string, unknown>; active: boolean; hasClientModule: boolean; installedVersion: string; availableVersion: string; updateAvailable: boolean; revisions: PluginRevision[]; status?: PluginState["status"]; error?: string; health?: PluginHealth };
export type PluginLockEntry = { id: string; version: string; source: PluginSource; dependencies: string[]; capabilities: CapabilityContract[] };

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
  private readonly lock = new Map<string, PluginLockEntry>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(ctx: Context, private readonly filePath = join(process.cwd(), "data", "plugins.json")) {
    super(ctx, "pluginManager");
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, StoredPluginState>;
      for (const [id, state] of Object.entries(saved)) {
        if (!isStoredPluginState(state)) throw new Error(`invalid persisted state for plugin ${id}`);
        this.states.set(id, state);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      await rename(this.filePath, corruptPath).catch(() => undefined);
      this.states.clear();
      await this.ctx.agentEvents?.emit("plugin:state-quarantined", { path: corruptPath, error: error instanceof Error ? error.message : "invalid plugin state" }, "plugin-manager");
    }
  }

  register(definition: PluginDefinition) {
    if (this.definitions.has(definition.id)) throw new Error(`plugin already registered: ${definition.id}`);
    if (definition.configSchema && !definition.ui?.settings) {
      throw new Error(`plugin ${definition.id} declares configSchema without ui.settings`);
    }
    validateContracts(definition);
    this.definitions.set(definition.id, definition);
    (this.ctx as any).pluginUi?.register(definition);
    const source: PluginSource = definition.packageSource ?? { kind: definition.origin, manifestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION };
    if (!this.states.has(definition.id)) this.states.set(definition.id, { enabled: definition.defaultEnabled === true, config: {}, version: definition.version, source, revisions: [], status: "installed" } as PluginState);
    this.lock.set(definition.id, { id: definition.id, version: definition.version, source, dependencies: [...definition.dependencies], capabilities: [...definition.capabilityContracts ?? []] });
  }

  list(): PublicPlugin[] {
    return [...this.definitions.values()].map(({ create: _create, client, ...definition }) => {
      const state = this.states.get(definition.id) ?? { enabled: false, config: {} };
      const installedVersion = state.version ?? definition.version;
      return { ...definition, enabled: state.enabled, config: state.config, active: this.fibers.has(definition.id), hasClientModule: Boolean(client), installedVersion, availableVersion: definition.version, updateAvailable: installedVersion !== definition.version, revisions: state.revisions ?? [], status: state.status ?? (this.fibers.has(definition.id) ? "active" : "installed"), error: state.error, health: state.health } as PublicPlugin;
    });
  }

  async startEnabled() {
    for (const plugin of this.definitions.values()) if (this.states.get(plugin.id)?.enabled) await this.enable(plugin.id);
  }

  applyComposition(overrides: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>) {
    for (const [id, override] of Object.entries(overrides)) {
      if (!this.definitions.has(id)) throw new Error(`composition references unknown plugin: ${id}`);
      const current = this.states.get(id)!;
      this.states.set(id, { ...current, enabled: override.enabled ?? current.enabled, config: override.config ?? current.config });
    }
  }

  async enable(id: string, visiting = new Set<string>()) {
    if (visiting.has(id)) throw new Error(`plugin dependency cycle: ${[...visiting, id].join(" -> ")}`);
    const definition = this.definition(id);
    visiting.add(id);
    try { for (const dependency of definition.dependencies) await this.enable(this.resolveDependency(dependency), visiting); } catch (error) { await this.markBlocked(id, error); throw error; }
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
      await (this.ctx as any).agentEvents?.emit("plugin:starting", { pluginId: id }, "plugin-manager", { pluginId: id });
      const fiber = await ((this.ctx as any).root as any).plugin(await definition.create(state.config));
      this.fibers.set(id, fiber);
      await (this.ctx as any).agentEvents?.emit("plugin:started", { pluginId: id }, "plugin-manager", { pluginId: id });
    }
    this.states.set(id, { ...state, enabled: true, status: "active", error: undefined, health: { status: "healthy", checkedAt: new Date().toISOString() } });
    for (const dependent of pausedDependents) await this.enable(dependent);
    await this.persist();
    await this.ctx.agentEvents?.audit("plugin.enabled", "plugin", id, undefined, { pluginId: id });
    await this.ctx.agentEvents?.emit("plugin:reloaded", { pluginId: id, revision: definition.version }, "plugin-manager", { pluginId: id });
    return this.publicPlugin(id);
  }

  async update(id: string, config: Record<string, unknown>, enabled: boolean) {
    const definition = this.definition(id);
    if (definition.required && !enabled) throw new Error("required plugin cannot be disabled");
    const current = this.states.get(id) as StoredPluginState | undefined;
    if (current) this.snapshot(id, current);
    this.states.set(id, { enabled, config: validatePluginConfig(definition, config), version: definition.version, source: current?.source ?? { kind: definition.origin, manifestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION }, revisions: current?.revisions ?? [], status: "installed" } as PluginState);
    if (this.fibers.has(id)) await this.stopCascade(id);
    await this.persist();
    await this.ctx.agentEvents?.audit("plugin.update", "plugin", id, { enabled }, { pluginId: id });
    await this.ctx.agentEvents?.emit("plugin:config-reloaded", { pluginId: id, revision: definition.version }, "plugin-manager", { pluginId: id });
    return enabled ? this.enable(id) : this.publicPlugin(id);
  }

  async disable(id: string) {
    const definition = this.definition(id);
    if (definition.required) throw new Error("required plugin cannot be disabled");
    await this.stopCascade(id);
    const state = this.states.get(id) ?? { enabled: false, config: {} };
    this.states.set(id, { ...state, enabled: false, status: "installed" });
    await this.persist();
    await this.ctx.agentEvents?.audit("plugin.disable", "plugin", id, undefined, { pluginId: id });
  }

  async updatePackage(id: string) {
    const definition = this.definition(id);
    const current = (this.states.get(id) ?? { enabled: false, config: {} }) as StoredPluginState;
    this.snapshot(id, current);
    this.states.set(id, { ...current, version: definition.version, source: current.source ?? definition.packageSource ?? { kind: definition.origin, manifestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION } } as PluginState);
    if (this.fibers.has(id)) await this.stopCascade(id);
    await this.persist();
    await this.ctx.agentEvents?.audit("plugin.update_package", "plugin", id, undefined, { pluginId: id });
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
    await this.ctx.agentEvents?.audit("plugin.rollback", "plugin", id, { revisionId }, { pluginId: id });
    return revision.enabled ? this.enable(id) : this.publicPlugin(id);
  }

  async health(id?: string) {
    const plugins = id ? [this.publicPlugin(id)] : this.list();
    return plugins.map((plugin) => ({ id: plugin.id, status: plugin.status === "blocked" ? "blocked" : plugin.active ? "healthy" : plugin.enabled ? "failed" : "healthy", checkedAt: new Date().toISOString(), ...(plugin.error ? { reason: plugin.error } : {}) }));
  }

  lockfile() { return Object.fromEntries(this.lock); }

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
      await (this.ctx as any).agentEvents?.emit("plugin:stopping", { pluginId: id }, "plugin-manager", { pluginId: id });
      await fiber.dispose();
      await (this.ctx as any).agentEvents?.emit("plugin:stopped", { pluginId: id }, "plugin-manager", { pluginId: id });
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
      this.states.set(dependent, { ...state, enabled: false, status: "installed" });
    }
    await this.unload(definition.id);
  }

  private async markBlocked(id: string, error: unknown) {
    const message = error instanceof Error ? error.message : "plugin dependency failed";
    const state = this.states.get(id) ?? { enabled: true, config: {} };
    this.states.set(id, { ...state, status: "blocked", error: message, health: { status: "blocked", reason: message, checkedAt: new Date().toISOString() } });
    await this.persist();
    await this.ctx.agentEvents?.emit("plugin:blocked", { pluginId: id, reason: message, error: { code: "PLUGIN_BLOCKED", message } }, "plugin-manager", { pluginId: id });
    await this.ctx.agentEvents?.audit("plugin.blocked", "plugin", id, { error: message }, { pluginId: id });
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(Object.fromEntries(this.states), null, 2), { encoding: "utf8", mode: 0o600 });
      await writeFile(join(dirname(this.filePath), "plugins.lock.json"), JSON.stringify(Object.fromEntries(this.lock), null, 2), { encoding: "utf8", mode: 0o600 });
    });
    return this.writeQueue;
  }
}

function isStoredPluginState(value: unknown): value is StoredPluginState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (typeof state.enabled !== "boolean" || !state.config || typeof state.config !== "object" || Array.isArray(state.config)) return false;
  if (state.version !== undefined && (typeof state.version !== "string" || !isVersion(state.version))) return false;
  if (state.status !== undefined && !["installed", "active", "blocked", "failed"].includes(String(state.status))) return false;
  if (state.source !== undefined) {
    const source = state.source as Record<string, unknown>;
    if (!source || (source.kind !== "builtin" && source.kind !== "local") || typeof source.manifestVersion !== "number") return false;
  }
  if (state.revisions !== undefined && (!Array.isArray(state.revisions) || state.revisions.some((revision) => !revision || typeof revision !== "object"))) return false;
  return true;
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

function validateContracts(definition: PluginDefinition) {
  for (const contract of definition.capabilityContracts ?? []) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(contract.id) || !isVersion(contract.version)) throw new Error(`invalid capability contract in plugin ${definition.id}`);
    if (contract.role === "consumer" && !definition.consumes?.includes(contract.id)) throw new Error(`consumer contract ${contract.id} is not listed in consumes for ${definition.id}`);
    if ((contract.role === "provider" || contract.role === "provider-consumer") && !definition.provides.includes(contract.id)) throw new Error(`provider contract ${contract.id} is not listed in provides for ${definition.id}`);
  }
  if (definition.role === "consumer" && !definition.consumes?.length) throw new Error(`consumer plugin ${definition.id} must declare consumes`);
}

function satisfies(version: string, range: string) {
  if (!isVersion(version)) return false;
  return range.split("||").some((alternative) => alternative.trim().split(/\s+/).filter(Boolean).every((clause) => satisfiesClause(version, clause)));
}
function satisfiesClause(version: string, clause: string) {
  if (clause === "*" || clause === "latest") return true;
  if (clause.startsWith("^")) { const base = parseVersion(clause.slice(1)); const current = parseVersion(version); return current[0] === base[0] && compareVersion(version, clause.slice(1)) >= 0; }
  if (clause.startsWith("~")) { const base = parseVersion(clause.slice(1)); const current = parseVersion(version); return current[0] === base[0] && current[1] === base[1] && compareVersion(version, clause.slice(1)) >= 0; }
  const match = clause.match(/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/); if (!match) return false; const comparison = compareVersion(version, match[2]); return match[1] === ">=" ? comparison >= 0 : match[1] === "<=" ? comparison <= 0 : match[1] === ">" ? comparison > 0 : match[1] === "<" ? comparison < 0 : comparison === 0;
}
function isVersion(value: string) { return /^\d+\.\d+\.\d+$/.test(value); }
function parseVersion(value: string) { return value.split(".").map((part) => Number.parseInt(part, 10)); }

function compareVersion(left: string, right: string) {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}
