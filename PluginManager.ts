import deepClone from "@tokenring-ai/utility/object/deepClone";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { deepEquals } from "bun";
import { runAsPlugin } from "./registrationOwner.ts";
import { AppConfigurationState, type ConfigLayer } from "./state/AppConfigurationState.ts";
import type TokenRingApp from "./TokenRingApp";
import type { TokenRingPlugin, TokenRingService } from "./types";

export default class PluginManager implements TokenRingService {
  readonly name = "PluginManager";
  description = "Manages plugins";

  private plugins = new KeyedRegistry<TokenRingPlugin<any, any>>();
  getPlugins = this.plugins.valuesArray;
  /** Last config slice handed to each plugin, keyed by plugin name, for change detection. */
  private appliedConfigs = new Map<string, unknown>();

  constructor(private readonly app: TokenRingApp) {}

  /** Bumped whenever the installed plugin set changes, so caches can be invalidated. */
  private _generation = 0;

  get generation(): number {
    return this._generation;
  }

  async run(signal: AbortSignal) {
    for await (const _state of this.app.subscribeStateAsync(AppConfigurationState, signal)) {
      await this.reconfigurePlugins();
    }
  }

  async installPlugins(plugins: TokenRingPlugin<any, any>[]): Promise<void> {
    const pluginConfigs: Record<string, ConfigLayer> = {};
    for (const plugin of plugins) {
      if ("config" in plugin) {
        pluginConfigs[plugin.name] = plugin.config;
      }
    }
    AppConfigurationState.setPluginConfigs(this.app, pluginConfigs);

    for (const plugin of plugins) {
      try {
        const earlyInstall = plugin.earlyInstall;
        if (earlyInstall) {
          this.app.serviceOutput(this, `Early Installing plugin "${plugin.name}"`);
          await this.asPlugin(plugin, () => earlyInstall(this.app, this.immutableConfigFor(plugin)));
        }
      } catch (error: unknown) {
        this.app.serviceError(this, `Error early installing plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        const install = plugin.install;
        if (install) {
          this.app.serviceOutput(this, `Installing plugin "${plugin.name}"`);
          await this.asPlugin(plugin, () => install(this.app, this.immutableConfigFor(plugin)));
        }
        this.plugins.set(plugin.name, plugin);
      } catch (error: unknown) {
        this.app.serviceError(this, `Error installing plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        const reconfigure = plugin.reconfigure;
        if (reconfigure) {
          this.app.serviceOutput(this, `Configuring plugin "${plugin.name}"`);
          await this.asPlugin(plugin, () => reconfigure(this.app, this.configFor(plugin)));
        }
        this.plugins.set(plugin.name, plugin);
      } catch (error: unknown) {
        this.app.serviceError(this, `Error configuring plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    for (const plugin of plugins) {
      try {
        const start = plugin.start;
        if (start) {
          this.app.serviceOutput(this, `Starting plugin "${plugin.name}"`);
          await this.asPlugin(plugin, () => start(this.app));
        }
      } catch (error: unknown) {
        this.app.serviceError(this, `Error starting plugin "${plugin.name}":`, error);
        throw error;
      }
    }

    this._generation++;
  }

  /**
   * Hands the current merged configuration to every installed plugin whose
   * config slice changed since it last received one. Plugins that cannot be
   * reconfigured while running flag the app as needing a restart.
   */
  async reconfigurePlugins(): Promise<void> {
    const { mergedConfig } = this.app.getState(AppConfigurationState);
    let restartRequired = false;

    for (const plugin of this.plugins.valuesArray()) {
      if (!("configSchema" in plugin)) continue;

      const newConfigSlice = plugin.configSchema.parse(mergedConfig) as unknown;
      if (deepEquals(this.appliedConfigs.get(plugin.name), newConfigSlice, true)) continue;

      const config = this.configFor(plugin);
      const reconfigure = plugin.reconfigure;
      if (reconfigure) {
        this.app.serviceOutput(this, `Reconfiguring plugin "${plugin.name}"`);
        await this.asPlugin(plugin, () => reconfigure(this.app, config));
      } else {
        this.app.serviceOutput(this, `Plugin "${plugin.name}" does not support live reconfiguration`);
        restartRequired = true;
      }
    }

    // Sticky, and only mutated on transition so subscribers aren't re-notified.
    if (restartRequired && !this.app.getState(AppConfigurationState).requiresRestartToFullyApplyConfig) {
      this.app.mutateState(AppConfigurationState, state => {
        state.requiresRestartToFullyApplyConfig = true;
      });
    }
  }

  /** Registration sites read the active plugin from this frame, including deferred `waitForService` callbacks. */
  private asPlugin<T>(plugin: TokenRingPlugin<any, any>, fn: () => T): T {
    return runAsPlugin(this.app, plugin.name, fn);
  }

  /** Parses the plugin's boot-time slice from `app.initialConfig`, or `undefined` when none is declared. */
  private immutableConfigFor(plugin: TokenRingPlugin<any, any>): unknown {
    return plugin.immutableConfigSchema?.parse(this.app.initialConfig);
  }

  /**
   * Parses the plugin's slice out of the merged config, as two independent
   * copies: one is returned for the plugin — which is free to mutate it, as
   * plugins filling in defaults from the environment do — and one is kept
   * private as the change-detection snapshot.
   */
  private configFor(plugin: TokenRingPlugin<any, any>): unknown {
    if (!("configSchema" in plugin)) return {};

    const { mergedConfig } = this.app.getState(AppConfigurationState);
    const parsed = plugin.configSchema.parse(mergedConfig) as unknown;
    this.appliedConfigs.set(plugin.name, deepClone(parsed));
    return parsed;
  }
}
