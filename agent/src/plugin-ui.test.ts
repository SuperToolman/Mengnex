import assert from "node:assert/strict";
import test from "node:test";
import * as cordis from "cordis";
import type { Context } from "cordis";
import { PluginManagerService } from "./plugin-manager.js";
import { PluginUiRegistryService } from "./plugin-ui.js";

test("plugin UI registry exposes only manifest-owned settings contributions", async () => {
  const app = new (cordis as any).Context() as Context;
  const install = (app as any).plugin.bind(app) as (plugin: unknown, config?: unknown) => PromiseLike<unknown>;
  await install(PluginUiRegistryService);
  await install(PluginManagerService, "unused-test-file.json");
  app.pluginManager.register({
    id: "ui-plugin", name: "UI Plugin", version: "1", description: "ui", kind: "integration", dependencies: [], provides: [], permissions: [], origin: "builtin", configurable: true,
    configSchema: { type: "object", properties: { enabled: { type: "boolean", title: "Enabled" } } },
    ui: { settings: { label: "Plugin UI", description: "Owned by the plugin" } },
    create: () => ({ name: "ui-plugin", apply: () => () => {} }),
  });
  assert.deepEqual(app.pluginUi.listSettings(), [{
    pluginId: "ui-plugin",
    schema: { type: "object", properties: { enabled: { type: "boolean", title: "Enabled" } } },
    ui: { label: "Plugin UI", description: "Owned by the plugin" },
    hasClientModule: false,
  }]);
});
