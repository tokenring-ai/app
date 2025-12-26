import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import TokenRingApp from "./TokenRingApp.ts";
import type {TokenRingPlugin, TokenRingService} from "./types.js";

export default class PluginManager implements TokenRingService {
  name = "PluginManager";
  description = "Manages plugins";

  private readonly app: TokenRingApp;
  private plugins = new TypedRegistry<TokenRingPlugin<unknown>>();

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
}
