import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginConfigField, PluginConfigSchema, PluginDefinition, PluginUiContribution } from "./plugin-manager.js";

type PackageManifest = Omit<PluginDefinition, "create" | "defaultEnabled" | "client"> & { entry: string; client?: { entry: string }; default_enabled?: boolean };
const pluginId = /^[a-z0-9][a-z0-9-]{1,63}$/;
const pluginKinds = new Set(["runtime", "model", "tool", "storage", "loop", "skill", "sandbox", "scheduler", "ui", "integration"]);

export async function discoverLocalPlugins(directory = join(process.cwd(), "plugins")): Promise<PluginDefinition[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const definitions: PluginDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageDirectory = join(directory, entry.name);
      const manifestPath = join(packageDirectory, "mengnex-plugin.json");
      if (await isFile(manifestPath)) {
        definitions.push(await readDefinition(directory, packageDirectory, manifestPath));
        continue;
      }
      const versions = await readdir(packageDirectory, { withFileTypes: true }).catch(() => []);
      for (const version of versions) {
        if (!version.isDirectory()) continue;
        const versionDirectory = join(packageDirectory, version.name);
        const versionManifest = join(versionDirectory, "mengnex-plugin.json");
        if (await isFile(versionManifest)) definitions.push(await readDefinition(directory, versionDirectory, versionManifest));
      }
    }
    const selected = new Map<string, PluginDefinition>();
    for (const definition of definitions) {
      const current = selected.get(definition.id);
      if (!current || compareVersion(definition.version, current.version) > 0) selected.set(definition.id, definition);
    }
    return [...selected.values()];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readDefinition(root: string, packageDirectory: string, manifestPath: string) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageManifest;
  return definitionFromManifest(root, packageDirectory, manifest);
}

async function definitionFromManifest(root: string, packageDirectory: string, manifest: PackageManifest): Promise<PluginDefinition> {
  if (!pluginId.test(manifest.id)) throw new Error("plugin id must use lowercase letters, digits, and hyphens");
  if (manifest.origin !== "local") throw new Error("local plugin manifest must declare origin: local");
  if (!manifest.name || !manifest.version || !manifest.description) throw new Error("plugin name, version and description are required");
  if (!pluginKinds.has(manifest.kind)) throw new Error("plugin kind is invalid");
  if (!Array.isArray(manifest.dependencies) || !manifest.dependencies.every((id) => typeof id === "string" && pluginId.test(id.split("@")[0]))) throw new Error("plugin dependencies are invalid");
  if (!Array.isArray(manifest.provides) || !manifest.provides.every((item) => typeof item === "string")) throw new Error("plugin provides are invalid");
  if (manifest.slots !== undefined && (!Array.isArray(manifest.slots) || !manifest.slots.every((item) => typeof item === "string" && item.trim()))) throw new Error("plugin slots are invalid");
  if (!Array.isArray(manifest.permissions) || !manifest.permissions.every((item) => typeof item === "string")) throw new Error("plugin permissions are invalid");
  if (typeof manifest.configurable !== "boolean") throw new Error("plugin configurable must be boolean");
  if (manifest.configurable && (!isUiContribution(manifest.ui) || (!isConfigSchema(manifest.configSchema) && !isClientManifest(manifest.client)))) throw new Error("configurable local plugins must declare ui.settings plus configSchema or client.entry");
  if (!manifest.configurable && (manifest.configSchema !== undefined || manifest.ui !== undefined || manifest.client !== undefined)) throw new Error("non-configurable plugins cannot declare configSchema, ui, or client");
  if (!manifest.entry || typeof manifest.entry !== "string") throw new Error("plugin entry is required");
  const entryPath = resolve(packageDirectory, manifest.entry);
  if (!isWithin(root, entryPath) || !(await isFile(entryPath))) throw new Error("plugin entry must remain inside the local plugins directory");
  const clientEntryPath = manifest.client ? resolve(packageDirectory, manifest.client.entry) : undefined;
  if (clientEntryPath && (!isWithin(root, clientEntryPath) || !(await isFile(clientEntryPath)))) throw new Error("plugin client entry must exist inside the local plugins directory");
  const { entry: _entry, client: _client, default_enabled, ...metadata } = manifest;
  return { ...metadata, defaultEnabled: default_enabled === true, ...(clientEntryPath ? { client: { entryPath: clientEntryPath } } : {}), create: async (config) => { const loaded = await import(pathToFileURL(entryPath).href); const factory = loaded.createPlugin ?? loaded.default; if (typeof factory !== "function") throw new Error("plugin " + manifest.id + " must export createPlugin(config)"); return factory(config); } };
}

function isClientManifest(value: unknown): value is { entry: string } { return Boolean(value) && typeof value === "object" && typeof (value as { entry?: unknown }).entry === "string"; }
function isConfigSchema(value: unknown): value is PluginConfigSchema {
  if (!value || typeof value !== "object") return false;
  const schema = value as Partial<PluginConfigSchema>;
  return schema.type === "object" && Boolean(schema.properties) && typeof schema.properties === "object" && Object.values(schema.properties).every(isConfigField) && (schema.required === undefined || (Array.isArray(schema.required) && schema.required.every((item) => typeof item === "string"))) && (schema.additionalProperties === undefined || typeof schema.additionalProperties === "boolean");
}
function isConfigField(value: unknown): value is PluginConfigField {
  if (!value || typeof value !== "object") return false;
  const field = value as Partial<PluginConfigField>;
  if (!field.title || typeof field.title !== "string" || !["string", "number", "boolean", "array", "object"].includes(field.type ?? "")) return false;
  if (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.every((item) => typeof item === "string"))) return false;
  if (field.format !== undefined && !["password", "path", "textarea"].includes(field.format)) return false;
  if (field.type === "array" && field.items !== undefined && !isConfigField(field.items)) return false;
  if (field.type === "object" && field.properties !== undefined && !Object.values(field.properties).every(isConfigField)) return false;
  return true;
}
function isUiContribution(value: unknown): value is PluginUiContribution {
  if (!value || typeof value !== "object") return false;
  const settings = (value as { settings?: unknown }).settings;
  return Boolean(settings) && typeof settings === "object" && typeof (settings as { label?: unknown }).label === "string" && typeof (settings as { description?: unknown }).description === "string";
}
function isWithin(root: string, target: string) { const path = relative(resolve(root), target); return Boolean(path) && !path.startsWith("..") && !path.includes(":"); }
async function isFile(path: string) { try { return (await stat(path)).isFile(); } catch { return false; } }
function compareVersion(left: string, right: string) { const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0); const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0); for (let index = 0; index < 3; index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0); return 0; }
