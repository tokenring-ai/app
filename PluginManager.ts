import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import TokenRingApp from "./TokenRingApp.ts";
import type {TokenRingPlugin, TokenRingService} from "./types.js";

export default class PluginManager implements TokenRingService {
  name = "PluginManager";
  description = "Manages plugins";

  private readonly app: TokenRingApp;
  private plugins = new TypedRegistry<TokenRingPlugin>();

  getPlugins = () => this.plugins.getItems();

  constructor(app: TokenRingApp) {
    this.app = app;
    this.app.addServices(this);
  }

  async installPlugins(plugins: TokenRingPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      try {
        this.plugins.register(plugin);
        if (plugin.install) plugin.install(this.app);
      } catch (error) {
        console.error(`Error installing plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of this.plugins.getItems()) {
      try {
        if (plugin.start) plugin.start(this.app);
      } catch (error) {
        console.error(`Error starting plugin "${plugin.name}":`, error);
        throw error;
      }
    }
  }
}
