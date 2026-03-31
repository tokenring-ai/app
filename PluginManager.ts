import deepEquals from "@tokenring-ai/utility/object/deepEquals";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import {ZodObject} from "zod";
import TokenRingApp, {type TokenRingAppConfig} from "./TokenRingApp";
import type {TokenRingPlugin, TokenRingService} from "./types";

export default class PluginManager implements TokenRingService {
  readonly name = "PluginManager";
  description = "Manages plugins";

  private plugins = new KeyedRegistry<TokenRingPlugin<ZodObject>>();

  getPlugins = this.plugins.getAllItemValues;

  constructor(private readonly app: TokenRingApp) {
    this.app.addServices(this);
  }

  async installPlugins(plugins: TokenRingPlugin<any>[]): Promise<void> {
    for (const plugin of plugins) {
      try {
        this.app.serviceOutput(this, `Installing plugin "${plugin.name}"`);
        if (plugin.install) await plugin.install(this.app, 'config' in plugin ? plugin.config.parse(this.app.config) : {});
        this.plugins.register(plugin.name, plugin);
      } catch (error) {
        this.app.serviceError(this, `Error installing plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        this.app.serviceOutput(this, `Starting plugin "${plugin.name}"`);
        if (plugin.start) await plugin.start(this.app, 'config' in plugin ? plugin.config.parse(this.app.config) : {});
      } catch (error) {
        this.app.serviceError(this, `Error starting plugin "${plugin.name}":`, error);
        throw error;
      }
    }
  }

  async reconfigurePlugins(newConfig: TokenRingAppConfig): Promise<{ restartRequired: boolean }> {
    let restartRequired = false;

    const plugins = this.plugins.getAllItemValues();
    for (const plugin of plugins) {
      const hasConfig = 'config' in plugin;
      if (hasConfig) {
        const prevConfigSlice = plugin.config.parse(this.app.config);
        const newConfigSlice = plugin.config.parse(newConfig);

        if (! deepEquals(prevConfigSlice, newConfigSlice)) {
          if (plugin.reconfigure) {
            this.app.serviceOutput(this, `Plugin ${plugin.name} was reconfigured`);
            await plugin.reconfigure(this.app, newConfigSlice);
          } else {
            this.app.serviceOutput(this, `Plugin ${plugin.name} does not support reconfiguration`);
            restartRequired = true;
          }
        }
      }
    }
    return { restartRequired };
  }
}
