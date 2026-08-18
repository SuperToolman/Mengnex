import * as cordis from "cordis";
import type { Context } from "cordis";
import type { PluginConfigSchema, PluginDefinition, PluginUiContribution } from "./plugin-manager.js";

export type PluginSettingsContribution = {
  pluginId: string;
  schema?: PluginConfigSchema;
  ui: PluginUiContribution["settings"];
  hasClientModule: boolean;
};

declare module "cordis" {
  interface Context {
    pluginUi: PluginUiRegistryService;
  }
}

/**
 * The trusted host owns discovery and transport only. Each plugin owns the
 * fields and copy rendered in its settings surface through its manifest.
 */
export class PluginUiRegistryService extends (cordis as any).Service {
  private readonly settings = new Map<string, PluginSettingsContribution>();

  constructor(ctx: Context) { super(ctx, "pluginUi"); }

  register(definition: PluginDefinition) {
    if (!definition.ui?.settings) return;
    this.settings.set(definition.id, { pluginId: definition.id, schema: definition.configSchema, ui: definition.ui.settings, hasClientModule: Boolean(definition.client) });
  }

  listSettings() { return [...this.settings.values()]; }

  settingsFor(pluginId: string) { return this.settings.get(pluginId); }
}
