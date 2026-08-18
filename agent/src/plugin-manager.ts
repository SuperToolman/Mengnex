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
  defaultInstalled?: boolean;
  required?: boolean;
  configurable: boolean;
  /** Declarative config and settings contribution consumed by the trusted Web host. */
  configSchema?: PluginConfigSchema;
  ui?: PluginUiContribution;
  /** Trusted browser module, served only to authenticated local managers. */
  client?: PluginClientModule;
  create: (config: Record<string, unknown>) => unknown | Promise<unknown>;
};

type PluginState = { installed: boolean; config: Record<string, unknown> };
/** `installed` is retained only in the on-disk compatibility format; packages are always locally discovered. */
export type PublicPlugin = Omit<PluginDefinition, "create" | "client"> & { enabled: boolean; config: Record<string, unknown>; active: boolean; hasClientModule: boolean };

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
      const saved = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, PluginState>;
      for (const [id, state] of Object.entries(saved)) {
        this.states.set(id, { installed: state.installed === true, config: state.config ?? {} });
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
    if (!this.states.has(definition.id)) this.states.set(definition.id, { installed: definition.defaultInstalled !== false, config: {} });
  }

  list(): PublicPlugin[] {
    return [...this.definitions.values()].map(({ create: _create, client, ...definition }) => {
      const state = this.states.get(definition.id) ?? { installed: false, config: {} };
      return { ...definition, enabled: state.installed, config: state.config, active: this.fibers.has(definition.id), hasClientModule: Boolean(client) };
    });
  }

  async startInstalled() {
    for (const plugin of this.definitions.values()) if (this.states.get(plugin.id)?.installed) await this.install(plugin.id);
  }

  applyComposition(overrides: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>) {
    for (const [id, override] of Object.entries(overrides)) {
      if (!this.definitions.has(id)) throw new Error(`composition references unknown plugin: ${id}`);
      const current = this.states.get(id)!;
      this.states.set(id, { installed: override.enabled ?? current.installed, config: override.config ?? current.config });
    }
  }

  async install(id: string, visiting = new Set<string>()) {
    if (visiting.has(id)) throw new Error(`plugin dependency cycle: ${[...visiting, id].join(" -> ")}`);
    const definition = this.definition(id);
    visiting.add(id);
    for (const dependency of definition.dependencies) await this.install(dependency, visiting);
    visiting.delete(id);
    const state = this.states.get(id) ?? { installed: false, config: {} };
    const pausedDependents: string[] = [];
    for (const slot of definition.slots ?? []) {
      const current = this.list().find((plugin) => plugin.id !== id && plugin.enabled && plugin.slots?.includes(slot));
      if (current) {
        if (current.required) throw new Error(`slot ${slot} is owned by required plugin ${current.id}`);
        pausedDependents.push(...await this.pauseDependents(current.id));
        await this.unload(current.id);
        this.states.set(current.id, { ...this.states.get(current.id)!, installed: false });
      }
    }
    if (!this.fibers.has(id)) {
      await (this.ctx as any).events?.emit("plugin:starting", { pluginId: id });
      const fiber = await ((this.ctx as any).root as any).plugin(await definition.create(state.config));
      this.fibers.set(id, fiber);
      await (this.ctx as any).events?.emit("plugin:started", { pluginId: id });
    }
    this.states.set(id, { ...state, installed: true });
    for (const dependent of pausedDependents) await this.install(dependent);
    await this.persist();
    return this.publicPlugin(id);
  }

  async update(id: string, config: Record<string, unknown>, enabled: boolean) {
    const definition = this.definition(id);
    if (definition.required && !enabled) throw new Error("required plugin cannot be disabled");
    this.states.set(id, { installed: enabled, config: validatePluginConfig(definition, config) });
    if (this.fibers.has(id)) await this.stopCascade(id);
    await this.persist();
    return enabled ? this.install(id) : this.publicPlugin(id);
  }

  async uninstall(id: string) {
    const definition = this.definition(id);
    if (definition.required) throw new Error("required plugin cannot be uninstalled");
    await this.stopCascade(id);
    const state = this.states.get(id) ?? { installed: false, config: {} };
    this.states.set(id, { ...state, installed: false });
    await this.persist();
  }

  private definition(id: string) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error("plugin not found");
    return definition;
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
      await (this.ctx as any).events?.emit("plugin:stopping", { pluginId: id });
      await fiber.dispose();
      await (this.ctx as any).events?.emit("plugin:stopped", { pluginId: id });
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
      this.states.set(dependent, { ...state, installed: false });
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
