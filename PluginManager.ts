import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import TokenRingApp from "./TokenRingApp.ts";
import type {TokenRingPlugin, TokenRingService} from "./types.js";

export default class PluginManager implements TokenRingService {
  name = "PluginManager";
  description = "Manages plugins";

  private plugins = new TypedRegistry<TokenRingPlugin>();

  getPlugins = () => this.plugins.getItems();

  async installPlugins(plugins: TokenRingPlugin[], app: TokenRingApp): Promise<void> {
    for (const plugin of plugins) {
      this.plugins.register(plugin);
      if (plugin.install) await plugin.install(app);
    }

    await Promise.all(
      this.plugins.getItems().map(plugin => plugin.start?.(app))
    );

    await Promise.all(
      app.services.getItems().map(service => service.start?.(app))
    );
  }
}
