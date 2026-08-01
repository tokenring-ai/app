import deepClone from "@tokenring-ai/utility/object/deepClone";
import { z } from "zod";
import type { ConfigScope } from "../config/scopes.ts";
import type { TokenRingAppConfig } from "../schema.ts";
import type TokenRingApp from "../TokenRingApp.ts";
import { AppStateSlice } from "../types.ts";

/** A sparse configuration layer: a deep-partial of the composed app config. */
export type ConfigLayer = Record<string, unknown>;

export { type ConfigScope, configScopes } from "../config/scopes.ts";

const configLayerSchema = z.record(z.string(), z.unknown());

const serializationSchema = z.object({
  pluginConfigs: z.record(z.string(), configLayerSchema).optional(),
  userConfig: configLayerSchema.optional(),
  projectConfig: configLayerSchema.optional(),
});

export interface AppConfigurationStateProps {
  /** Startup configuration: CLI defaults ⊕ config directories, already parsed. */
  appConfig: TokenRingAppConfig;
  /** Sparse overrides loaded from the user's home directory. */
  userConfig?: ConfigLayer | undefined;
  /** Sparse overrides loaded from the project directory. */
  projectConfig?: ConfigLayer | undefined;
}

/**
 * Holds the app configuration as a stack of layers plus the merged result.
 *
 * Precedence, lowest to highest: `appConfig` ⊕ `pluginConfigs` ⊕ `userConfig` ⊕
 * `projectConfig`. Every layer except `appConfig` is mutable at runtime, so
 * installing or uninstalling a plugin — or applying a configuration change —
 * only has to swap one layer and let the merged config be recomputed.
 */
export class AppConfigurationState extends AppStateSlice<typeof serializationSchema> {
  /** Configuration the app booted with. Never modified and never serialized. */
  readonly appConfig: TokenRingAppConfig;

  /** Default configuration contributed by each installed plugin, keyed by plugin name. */
  pluginConfigs: Record<string, ConfigLayer> = {};

  /** Sparse overrides persisted in the user's home directory. */
  userConfig: ConfigLayer;

  /** Sparse overrides persisted in the project directory. */
  projectConfig: ConfigLayer;

  /**
   * All layers merged together. The object identity is stable for the lifetime
   * of the app — its contents are replaced in place — so services holding a
   * reference observe configuration changes.
   */
  readonly mergedConfig: TokenRingAppConfig;

  requiresRestartToFullyApplyConfig: boolean = false;

  constructor({ appConfig, userConfig, projectConfig }: AppConfigurationStateProps) {
    super("AppConfigurationState", serializationSchema);
    this.appConfig = deepClone(appConfig);
    this.userConfig = deepClone(userConfig ?? {});
    this.projectConfig = deepClone(projectConfig ?? {});
    this.mergedConfig = {} as TokenRingAppConfig;
    this.recomputeMergedConfig();
  }

  /** The override layer for `scope`. */
  getOverrideLayer(scope: ConfigScope): ConfigLayer {
    return scope === "user" ? this.userConfig : this.projectConfig;
  }

  /**
   * Everything below `scope` merged together — what an override at that scope
   * is measured against.
   */
  getLayersBelow(scope: ConfigScope): TokenRingAppConfig {
    const base = deepClone(this.appConfig, ...Object.values(this.pluginConfigs)) as TokenRingAppConfig;
    return scope === "user" ? base : (deepClone(base, this.userConfig) as TokenRingAppConfig);
  }

  /** The config that would result from replacing the `scope` layer with `layer`. */
  previewWithOverrideLayer(scope: ConfigScope, layer: ConfigLayer): TokenRingAppConfig {
    return scope === "user" ? this.mergeLayers(layer, this.projectConfig) : this.mergeLayers(this.userConfig, layer);
  }

  serialize(): z.input<typeof serializationSchema> {
    return {
      pluginConfigs: deepClone(this.pluginConfigs),
      userConfig: deepClone(this.userConfig),
      projectConfig: deepClone(this.projectConfig),
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    if (data.pluginConfigs) this.pluginConfigs = deepClone(data.pluginConfigs);
    if (data.userConfig) this.userConfig = deepClone(data.userConfig);
    if (data.projectConfig) this.projectConfig = deepClone(data.projectConfig);
    this.recomputeMergedConfig();
  }

  /** Registers (or replaces) the default config of several plugins at once. */
  static setPluginConfigs(app: TokenRingApp, pluginConfigs: Record<string, ConfigLayer>): void {
    AppConfigurationState.updateLayers(app, state => {
      for (const [pluginName, config] of Object.entries(pluginConfigs)) {
        state.pluginConfigs[pluginName] = deepClone(config);
      }
    });
  }

  static setPluginConfig(app: TokenRingApp, pluginName: string, config: ConfigLayer): void {
    AppConfigurationState.updateLayers(app, state => {
      state.pluginConfigs[pluginName] = deepClone(config);
    });
  }

  static removePluginConfig(app: TokenRingApp, pluginName: string): void {
    AppConfigurationState.updateLayers(app, state => {
      delete state.pluginConfigs[pluginName];
    });
  }

  static setUserConfig(app: TokenRingApp, userConfig: ConfigLayer): void {
    AppConfigurationState.updateLayers(app, state => {
      state.userConfig = deepClone(userConfig);
    });
  }

  static setProjectConfig(app: TokenRingApp, projectConfig: ConfigLayer): void {
    AppConfigurationState.updateLayers(app, state => {
      state.projectConfig = deepClone(projectConfig);
    });
  }

  static setOverrideLayer(app: TokenRingApp, scope: ConfigScope, layer: ConfigLayer): void {
    if (scope === "user") {
      AppConfigurationState.setUserConfig(app, layer);
    } else {
      AppConfigurationState.setProjectConfig(app, layer);
    }
  }

  private static updateLayers(app: TokenRingApp, mutator: (state: AppConfigurationState) => void): void {
    app.mutateState(AppConfigurationState, state => {
      mutator(state);
      state.recomputeMergedConfig();
    });
  }

  /**
   * Rebuilds the merged config from the layers, replacing the contents of the
   * existing `mergedConfig` object rather than the object itself.
   */
  private mergeLayers(userConfig: ConfigLayer, projectConfig: ConfigLayer): TokenRingAppConfig {
    return deepClone(this.appConfig, ...Object.values(this.pluginConfigs), userConfig, projectConfig) as TokenRingAppConfig;
  }

  private recomputeMergedConfig(): void {
    const next = this.mergeLayers(this.userConfig, this.projectConfig) as Record<string, unknown>;
    const target = this.mergedConfig as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      if (!(key in next)) delete target[key];
    }
    Object.assign(target, next);
  }
}
