import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import {deepEquals} from "bun";
import {ZodObject} from "zod";
import TokenRingApp, {type TokenRingAppConfig} from "./TokenRingApp";
import type {TokenRingPlugin, TokenRingService} from "./types";

export default class PluginManager implements TokenRingService {
  name = "PluginManager";
  description = "Manages plugins";

  private readonly app: TokenRingApp;
  private plugins = new TypedRegistry<TokenRingPlugin<ZodObject>>();

  getPlugins = () => this.plugins.getItems();

  constructor(app: TokenRingApp) {
    this.app = app;
    this.app.addServices(this);
  }

  async installPlugins(plugins: TokenRingPlugin<any>[]): Promise<void> {
    for (const plugin of plugins) {
      try {
        if (plugin.install) plugin.install(this.app, 'config' in plugin ? plugin.config.parse(this.app.config) : {});
        this.plugins.register(plugin);
      } catch (error) {
        console.error(`Error installing plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        if (plugin.start) plugin.start(this.app, 'config' in plugin ? plugin.config.parse(this.app.config) : {});
      } catch (error) {
        console.error(`Error starting plugin "${plugin.name}":`, error);
        throw error;
      }
    }
  }

  async reconfigurePlugins(newConfig: TokenRingAppConfig): Promise<{ restartRequired: boolean }> {
    let restartRequired = false;

    const plugins = this.plugins.getItems();
    for (const plugin of plugins) {
      const hasConfig = 'config' in plugin;
      if (hasConfig) {
        const prevConfigSlice = plugin.config.parse(this.app.config);
        const newConfigSlice = plugin.config.parse(newConfig);

        if (! deepEquals(prevConfigSlice, newConfigSlice)) {
          if (plugin.reconfigure) {
            this.app.serviceOutput(`Plugin ${plugin.name} was reconfigured`);
            await plugin.reconfigure(this.app, newConfigSlice);
          } else {
            this.app.serviceOutput(`Plugin ${plugin.name} does not support reconfiguration`);
            restartRequired = true;
          }
        }
      }
    }
    return { restartRequired };
  }
}
