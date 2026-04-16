import deepEquals from "@tokenring-ai/utility/object/deepEquals";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type {TokenRingAppConfig} from "./schema.ts";
import type TokenRingApp from "./TokenRingApp";
import type {TokenRingPlugin, TokenRingService} from "./types";

export default class PluginManager implements TokenRingService {
  readonly name = "PluginManager";
  description = "Manages plugins";

  private plugins = new KeyedRegistry<TokenRingPlugin<any>>();

  getPlugins = this.plugins.valuesArray;

  constructor(private readonly app: TokenRingApp) {
    this.app.addServices(this);
  }

  async installPlugins(plugins: TokenRingPlugin<any>[]): Promise<void> {
    for (const plugin of plugins) {
      try {
        if (plugin.earlyInstall) {
          this.app.serviceOutput(
            this,
            `Early Installing plugin "${plugin.name}"`,
          );
          await plugin.earlyInstall(
            this.app,
            "config" in plugin ? plugin.config.parse(this.app.config) : {},
          );
        }
      } catch (error: unknown) {
        this.app.serviceError(
          this,
          `Error early installing plugin "${plugin.name}":`,
          error,
        );
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        if (plugin.install) {
          this.app.serviceOutput(this, `Installing plugin "${plugin.name}"`);
          await plugin.install(
            this.app,
            "config" in plugin ? plugin.config.parse(this.app.config) : {},
          );
        }
        this.plugins.set(plugin.name, plugin);
      } catch (error: unknown) {
        this.app.serviceError(
          this,
          `Error installing plugin "${plugin.name}":`,
          error,
        );
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        if (plugin.start) {
          this.app.serviceOutput(this, `Starting plugin "${plugin.name}"`);
          await plugin.start(
            this.app,
            "config" in plugin ? plugin.config.parse(this.app.config) : {},
          );
        }
      } catch (error: unknown) {
        this.app.serviceError(
          this,
          `Error starting plugin "${plugin.name}":`,
          error,
        );
        throw error;
      }
    }
  }

  async reconfigurePlugins(
    newConfig: TokenRingAppConfig,
  ): Promise<{ restartRequired: boolean }> {
    let restartRequired = false;

    const plugins = this.plugins.valuesArray();
    for (const plugin of plugins) {
      const hasConfig = "config" in plugin;
      if (hasConfig) {
        const prevConfigSlice = plugin.config.parse(this.app.config);
        const newConfigSlice = plugin.config.parse(newConfig);

        if (!deepEquals(prevConfigSlice, newConfigSlice)) {
          if (plugin.reconfigure) {
            this.app.serviceOutput(
              this,
              `Plugin ${plugin.name} was reconfigured`,
            );
            await plugin.reconfigure(this.app, newConfigSlice);
          } else {
            this.app.serviceOutput(
              this,
              `Plugin ${plugin.name} does not support reconfiguration`,
            );
            restartRequired = true;
          }
        }
      }
    }
    return {restartRequired};
  }
}
