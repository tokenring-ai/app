import deepClone from "@tokenring-ai/utility/object/deepClone";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type { MaybePromise } from "bun";
import { deepEquals } from "bun";
import type { TokenRingAppConfig } from "./schema.ts";
import { AppConfigurationState } from "./state/AppConfigurationState.ts";
import type TokenRingApp from "./TokenRingApp";
import type { TokenRingPlugin, TokenRingService } from "./types";

export default class PluginManager implements TokenRingService {
  readonly name = "PluginManager";
  description = "Manages plugins";

  private plugins = new KeyedRegistry<TokenRingPlugin<any>>();

  getPlugins = this.plugins.valuesArray;

  constructor(private readonly app: TokenRingApp) {
    this.app.addServices(this);
  }

  async run(signal: AbortSignal) {
    let lastConfig = this.app.stateManager.getState(AppConfigurationState).config;

    for await (const state of this.app.stateManager.subscribeAsync(AppConfigurationState, signal)) {
      const newConfig = state.config;
      let restartRequired = false;

      const plugins = this.plugins.valuesArray();
      for (const plugin of plugins) {
        const hasConfig = "configSchema" in plugin;
        if (hasConfig) {
          const prevConfigSlice = plugin.configSchema.parse(lastConfig) as unknown;
          const newConfigSlice = plugin.configSchema.parse(newConfig) as unknown;

          if (!deepEquals(prevConfigSlice, newConfigSlice, true)) {
            await plugin.reconfigure?.(this.app, newConfigSlice);
          }
        }
      }

      state.requiresRestartToFullyApplyConfig = restartRequired;
    }
  }

  async installPlugins(plugins: TokenRingPlugin<any>[]): Promise<void> {
    let config = this.app.stateManager.getState(AppConfigurationState).config;
    for (const plugin of plugins) {
      if ("config" in plugin) {
        config = deepClone(config, plugin.config);
      }
    }

    AppConfigurationState.replaceConfig(config, this.app)

    for (const plugin of plugins) {
      try {
        if (plugin.earlyInstall) {
          this.app.serviceOutput(this, `Early Installing plugin "${plugin.name}"`);
          await plugin.earlyInstall(this.app, "configSchema" in plugin ? plugin.configSchema.parse(config) : {});
        }
      } catch (error: unknown) {
        this.app.serviceError(this, `Error early installing plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        if (plugin.install) {
          this.app.serviceOutput(this, `Installing plugin "${plugin.name}"`);
          await plugin.install(this.app, "configSchema" in plugin ? plugin.configSchema.parse(config) : {});
        }
        this.plugins.set(plugin.name, plugin);
      } catch (error: unknown) {
        this.app.serviceError(this, `Error installing plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        if (plugin.start) {
          this.app.serviceOutput(this, `Starting plugin "${plugin.name}"`);
          await plugin.start(this.app, "configSchema" in plugin ? plugin.configSchema.parse(config) : {});
        }
      } catch (error: unknown) {
        this.app.serviceError(this, `Error starting plugin "${plugin.name}":`, error);
        throw error;
      }
    }
  }
}
