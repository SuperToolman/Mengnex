import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { PluginManagerService } from "./plugin-manager.js";

test("plugin manager installs, disables, and persists registered plugins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  const filePath = join(directory, "plugins.json");
  let cleanups = 0;
  const definition = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "test",
    kind: "integration" as const,
    dependencies: [],
    provides: ["test"],
    permissions: [],
    origin: "builtin" as const,
    defaultEnabled: true,
    configurable: false,
    create: () => ({ name: "test-plugin", apply: () => () => { cleanups += 1; } }),
  };
  try {
    const app = new (cordis as any).Context() as Context;
    const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await install(PluginManagerService, filePath);
    await app.pluginManager.load();
    app.pluginManager.register(definition);
    await app.pluginManager.startEnabled();
    assert.equal(app.pluginManager.list()[0].active, true);

    await app.pluginManager.update("test-plugin", {}, false);
    assert.equal(app.pluginManager.list()[0].enabled, false);
    assert.equal(cleanups, 1);

    const restored = new (cordis as any).Context() as Context;
    const installRestored = (restored as any).plugin.bind(restored) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await installRestored(PluginManagerService, filePath);
    await restored.pluginManager.load();
    restored.pluginManager.register(definition);
    assert.equal(restored.pluginManager.list()[0].enabled, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plugin manager replaces a non-core provider in the same capability slot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  try {
    const app = new (cordis as any).Context() as Context;
    const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await install(PluginManagerService, join(directory, "plugins.json"));
    await app.pluginManager.load();
    for (const id of ["model-a", "model-b"]) app.pluginManager.register({
      id, name: id, version: "1", description: id, kind: "model", dependencies: [], provides: ["llm"], slots: ["model"], permissions: [], origin: "builtin", configurable: false,
      create: () => ({ name: id, apply: () => () => {} }),
    });
    await app.pluginManager.enable("model-a");
    await app.pluginManager.enable("model-b");
    const plugins = app.pluginManager.list();
    assert.equal(plugins.find((plugin) => plugin.id === "model-a")?.enabled, false);
    assert.equal(plugins.find((plugin) => plugin.id === "model-b")?.active, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plugin manager rejects configuration that violates a plugin schema", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  try {
    const app = new (cordis as any).Context() as Context;
    const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await install(PluginManagerService, join(directory, "plugins.json"));
    app.pluginManager.register({
      id: "schema-plugin", name: "Schema Plugin", version: "1", description: "schema", kind: "integration", dependencies: [], provides: [], permissions: [], origin: "builtin", configurable: true,
      configSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", title: "Name" } } },
      ui: { settings: { label: "Schema", description: "schema" } },
      create: () => ({ name: "schema-plugin", apply: () => () => {} }),
    });
    await assert.rejects(() => app.pluginManager.update("schema-plugin", { unexpected: true }, false), /unknown configuration fields/);
    await assert.rejects(() => app.pluginManager.update("schema-plugin", {}, false), /Name is required/);
    await app.pluginManager.update("schema-plugin", { name: "accepted" }, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plugin manager disables non-required dependents before stopping a plugin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  try {
    const app = new (cordis as any).Context() as Context;
    const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await install(PluginManagerService, join(directory, "plugins.json"));
    await app.pluginManager.load();
    for (const [id, dependencies] of [["base", []], ["dependent", ["base"]]] as const) app.pluginManager.register({ id, name: id, version: "1", description: id, kind: "integration", dependencies: [...dependencies], provides: [], permissions: [], origin: "builtin", configurable: false, create: () => ({ name: id, apply: () => () => {} }) });
    await app.pluginManager.startEnabled();
    await app.pluginManager.update("base", {}, false);
    assert.equal(app.pluginManager.list().find((plugin) => plugin.id === "base")?.enabled, false);
    assert.equal(app.pluginManager.list().find((plugin) => plugin.id === "dependent")?.enabled, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("plugin manager records capability contracts, lockfile metadata, and blocked dependency health", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mengnex-agent-"));
  try {
    const app = new (cordis as any).Context() as Context;
    const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
    await install(PluginManagerService, join(directory, "plugins.json"));
    await app.pluginManager.load();
    app.pluginManager.register({ id: "contract-provider", name: "Provider", version: "1.2.3", description: "provider", kind: "integration", dependencies: [], provides: ["demo.capability"], capabilityContracts: [{ id: "demo.capability", version: "1.0.0", role: "provider" }], permissions: [], origin: "local", configurable: false, defaultEnabled: false, create: () => ({ name: "provider", apply: () => () => {} }) });
    app.pluginManager.register({ id: "broken-consumer", name: "Broken", version: "1.0.0", description: "broken", kind: "integration", dependencies: ["missing@^1.0.0"], provides: [], consumes: ["demo.capability"], role: "consumer", permissions: [], origin: "local", configurable: false, defaultEnabled: true, create: () => ({ name: "broken", apply: () => () => {} }) });
    await assert.rejects(() => app.pluginManager.startEnabled(), /plugin not found/);
    assert.equal((await app.pluginManager.health("broken-consumer"))[0].status, "blocked");
    assert.equal(app.pluginManager.lockfile()["contract-provider"].capabilities[0].role, "provider");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
