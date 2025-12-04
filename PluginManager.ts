import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import TokenRingApp from "./TokenRingApp.ts";
import type {TokenRingPlugin, TokenRingService} from "./types.js";

export default class PluginManager implements TokenRingService {
  name = "PluginManager";
  description = "Manages plugins";

  private app: TokenRingApp;
  private plugins = new TypedRegistry<TokenRingPlugin>();

  getPlugins = () => this.plugins.getItems();

  constructor(app: TokenRingApp) {
    this.app = app;
    this.app.addServices(this);
  }

  async installPlugins(plugins: TokenRingPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      this.plugins.register(plugin);
      if (plugin.install) await plugin.install(this.app);
    }

    await Promise.all(
      this.plugins.getItems().map(plugin => plugin.start?.(this.app))
    );
  }
}
