import deepClone from "@tokenring-ai/utility/object/deepClone";
import type { z } from "zod";
import PluginManager from "../PluginManager.ts";
import { AppConfigurationState, type ConfigLayer } from "../state/AppConfigurationState.ts";
import type TokenRingApp from "../TokenRingApp.ts";
import type { TokenRingService } from "../types.ts";
import buildConfigUISchema from "./buildConfigUISchema.ts";
import { deleteAtPath, pruneToOverrides, redactSensitiveValues, resolveSensitiveSentinels } from "./overrides.ts";
import { type ConfigScope, configScopes } from "./scopes.ts";
import type { ConfigUIPluginSchema } from "./uiSchema.ts";
import writeYamlAtomic from "./writeYamlAtomic.ts";

export interface ConfigValidationIssue {
  path: (string | number)[];
  message: string;
}

export type ConfigApplyResult = { ok: true } | { ok: false; issues: ConfigValidationIssue[] };

export interface ConfigurationServiceOptions {
  /** The composed app config schema (all plugin shapes merged). */
  configSchema: z.ZodType;
  /** File each override scope is persisted to. */
  overridesFiles: Record<ConfigScope, string>;
  /** Boot-time error when an overrides file was rejected, for the UI banner. */
  overlayError?: string | undefined;
}

const OVERRIDES_HEADERS: Record<ConfigScope, string> = {
  global: `# TokenRing global configuration overrides.
# Managed by the TokenRing configuration UI; hand edits are preserved per-key.`,
  workspace: `# TokenRing workspace configuration overrides. These take precedence over
# the global configuration.
# Managed by the TokenRing configuration UI; hand edits are preserved per-key.`,
};

/**
 * Owns the editable override layers of {@link AppConfigurationState} — the user
 * layer and the project layer, which takes precedence over it: exposes
 * generated UI schemas and redacted values, validates candidate overrides
 * against the composed config schema, swaps the running layer, persists it to
 * that scope's file, and live-reconfigures plugins.
 */
export default class ConfigurationService implements TokenRingService {
  readonly name = "ConfigurationService";
  readonly description = "Manages configuration overrides and live plugin reconfiguration";

  readonly overlayError: string | undefined;
  readonly overridesFiles: Record<ConfigScope, string>;

  private readonly configSchema: z.ZodType;
  private uiSchemaCache: { generation: number; uiSchemas: ConfigUIPluginSchema[] } | undefined;
  private applyQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly app: TokenRingApp,
    options: ConfigurationServiceOptions,
  ) {
    this.configSchema = options.configSchema;
    this.overridesFiles = { ...options.overridesFiles };
    this.overlayError = options.overlayError;
  }

  /**
   * Generated UI schemas for every installed plugin with configurable content.
   * Rebuilt whenever the installed plugin set changes.
   */
  getUISchemas(): ConfigUIPluginSchema[] {
    const pluginManager = this.app.requireService(PluginManager);
    if (this.uiSchemaCache?.generation !== pluginManager.generation) {
      const uiSchemas = pluginManager
        .getPlugins()
        .filter(plugin => "configSchema" in plugin)
        .map(plugin => buildConfigUISchema(plugin))
        .filter((uiSchema): uiSchema is ConfigUIPluginSchema => uiSchema !== null && Object.keys(uiSchema.slices).length > 0);
      this.uiSchemaCache = { generation: pluginManager.generation, uiSchemas };
    }
    return this.uiSchemaCache.uiSchemas;
  }

  getOverrides(scope: ConfigScope): ConfigLayer {
    return deepClone(this.configState.getOverrideLayer(scope));
  }

  /** The running merged configuration, parsed with the composed schema. */
  getEffectiveConfig(): unknown {
    return this.configSchema.parse(this.configState.mergedConfig);
  }

  /**
   * Effective config and the overrides of every scope, for each UI-schema-covered
   * config slice, with sensitive values redacted to `{ __sensitive: true, isSet }`.
   * Slices without a UI schema are never sent to the client.
   */
  getRedactedValues(): { effective: Record<string, unknown>; overrides: Record<ConfigScope, Record<string, unknown>> } {
    const effectiveConfig = this.getEffectiveConfig() as Record<string, unknown>;
    const effective: Record<string, unknown> = {};
    const overrides = Object.fromEntries(configScopes.map(scope => [scope, {} as Record<string, unknown>])) as Record<ConfigScope, Record<string, unknown>>;

    for (const uiSchema of this.getUISchemas()) {
      for (const [key, node] of Object.entries(uiSchema.slices)) {
        const effectiveSlice = redactSensitiveValues(node, effectiveConfig[key]);
        if (effectiveSlice !== undefined) effective[key] = effectiveSlice;

        for (const scope of configScopes) {
          const overrideSlice = redactSensitiveValues(node, this.configState.getOverrideLayer(scope)[key]);
          if (overrideSlice !== undefined) overrides[scope][key] = overrideSlice;
        }
      }
    }
    return { effective, overrides };
  }

  /**
   * Validates a candidate override set for one scope (the full desired set for
   * that scope, not a patch). Resolves sensitive sentinels, prunes values that
   * match the layers below it, and parses the merged result with the composed
   * schema.
   */
  validateOverrides(
    scope: ConfigScope,
    candidateOverrides: ConfigLayer,
  ): { ok: true; normalized: ConfigLayer; parsed: unknown } | { ok: false; issues: ConfigValidationIssue[] } {
    const keyIssues = this.checkAllowedKeys(candidateOverrides);
    if (keyIssues.length > 0) return { ok: false, issues: keyIssues };

    const state = this.configState;
    const resolved = resolveSensitiveSentinels(candidateOverrides, state.getOverrideLayer(scope)) as ConfigLayer;
    const normalized = (pruneToOverrides(resolved, this.parsedLayersBelow(scope)) ?? {}) as ConfigLayer;

    const result = this.configSchema.safeParse(state.previewWithOverrideLayer(scope, normalized));
    if (!result.success) {
      return {
        ok: false,
        issues: result.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message })),
      };
    }
    return { ok: true, normalized, parsed: result.data };
  }

  /**
   * Validates, swaps the running config layer for `scope`, live-reconfigures
   * plugins, and only then persists that scope's overrides file — so a config
   * the running app rejected is never written to disk. Serialized: concurrent
   * calls run one at a time.
   */
  apply(scope: ConfigScope, candidateOverrides: ConfigLayer): Promise<ConfigApplyResult> {
    return this.enqueue(() => this.doApply(scope, candidateOverrides));
  }

  /**
   * Read-modify-write of one scope's overrides, atomic against other applies and updates: `mutate`
   * gets a copy of the overrides as they are when its turn comes, so concurrent updates (two
   * grants saved at once) cannot overwrite each other the way `getOverrides` + `apply` can.
   */
  update(scope: ConfigScope, mutate: (overrides: ConfigLayer) => void): Promise<ConfigApplyResult> {
    return this.enqueue(() => {
      const next = this.getOverrides(scope);
      mutate(next);
      return this.doApply(scope, next);
    });
  }

  private enqueue(task: () => Promise<ConfigApplyResult>): Promise<ConfigApplyResult> {
    const run = this.applyQueue.then(task);
    this.applyQueue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** Removes the override at `path` in `scope` (empty path clears all) and re-applies. */
  resetPath(scope: ConfigScope, path: string[]): Promise<ConfigApplyResult> {
    const next = this.getOverrides(scope);
    deleteAtPath(next, path);
    return this.apply(scope, next);
  }

  private async doApply(scope: ConfigScope, candidateOverrides: ConfigLayer): Promise<ConfigApplyResult> {
    const validation = this.validateOverrides(scope, candidateOverrides);
    if (!validation.ok) return validation;
    const { normalized } = validation;

    const previous = this.getOverrides(scope);
    AppConfigurationState.setOverrideLayer(this.app, scope, normalized);

    const pluginManager = this.app.getService(PluginManager);
    try {
      await pluginManager?.reconfigurePlugins();
    } catch (error: unknown) {
      // Roll the running app back to the configuration it was happy with.
      AppConfigurationState.setOverrideLayer(this.app, scope, previous);
      await pluginManager?.reconfigurePlugins().catch(() => {});
      throw error;
    }

    writeYamlAtomic(this.overridesFiles[scope], normalized, OVERRIDES_HEADERS[scope]);

    return { ok: true };
  }

  /** Everything below `scope`, parsed with the composed schema. */
  private parsedLayersBelow(scope: ConfigScope): unknown {
    return this.configSchema.parse(this.configState.getLayersBelow(scope));
  }

  private get configState() {
    return this.app.getState(AppConfigurationState);
  }

  private checkAllowedKeys(candidateOverrides: ConfigLayer): ConfigValidationIssue[] {
    const allowedKeys = new Set<string>();
    for (const uiSchema of this.getUISchemas()) {
      for (const key of Object.keys(uiSchema.slices)) allowedKeys.add(key);
    }
    const issues: ConfigValidationIssue[] = [];
    for (const key of Object.keys(candidateOverrides)) {
      if (!allowedKeys.has(key)) {
        issues.push({ path: [key], message: `"${key}" is not a configurable setting` });
      }
    }
    return issues;
  }
}
