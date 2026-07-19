import deepClone from "@tokenring-ai/utility/object/deepClone";
import type { z } from "zod";
import PluginManager from "../PluginManager.ts";
import type { TokenRingAppConfig } from "../schema.ts";
import type TokenRingApp from "../TokenRingApp.ts";
import type { TokenRingService } from "../types.ts";
import buildConfigUISchema from "./buildConfigUISchema.ts";
import { deleteAtPath, pruneToOverrides, redactSensitiveValues, resolveSensitiveSentinels } from "./overrides.ts";
import type { ConfigUIPluginSchema } from "./uiSchema.ts";
import writeYamlAtomic from "./writeYamlAtomic.ts";

export interface ConfigValidationIssue {
  path: (string | number)[];
  message: string;
}

export type ConfigApplyResult = { ok: true; restartRequired: boolean } | { ok: false; issues: ConfigValidationIssue[] };

export interface ConfigurationServiceOptions {
  /** The composed app config schema (all plugin shapes merged). */
  configSchema: z.ZodTypeAny;
  /** Merged CLI defaults + configDirectories YAML, before user overrides. */
  baseConfig: unknown;
  /** File the sparse user overrides are persisted to (~/.tokenring/config.yaml). */
  overridesFile: string;
  /** Overrides as loaded at boot ({} when the file is absent or was rejected). */
  overrides?: Record<string, unknown>;
  /** Boot-time error when the overrides file was rejected, for the UI banner. */
  overlayError?: string | undefined;
}

const OVERRIDES_HEADER = `# TokenRing user configuration overrides.
# Managed by the TokenRing configuration UI; hand edits are preserved per-key.`;

/**
 * Owns the user configuration override layer: exposes generated UI schemas and
 * redacted values, validates candidate overrides against the composed config
 * schema, persists them to the overrides file, and live-reconfigures plugins.
 */
export default class ConfigurationService implements TokenRingService {
  readonly name = "ConfigurationService";
  readonly description = "Manages user configuration overrides and live plugin reconfiguration";

  /** Sticky: set once any applied change could not be live-reconfigured. */
  restartRequired = false;
  readonly overlayError: string | undefined;
  readonly overridesFile: string;

  private readonly configSchema: z.ZodTypeAny;
  private readonly baseConfig: object;
  private overrides: Record<string, unknown>;
  private parsedBaseCache: unknown;
  private uiSchemaCache: ConfigUIPluginSchema[] | undefined;
  private applyQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly app: TokenRingApp,
    options: ConfigurationServiceOptions,
  ) {
    this.configSchema = options.configSchema;
    this.baseConfig = deepClone(options.baseConfig as object);
    this.overridesFile = options.overridesFile;
    this.overrides = deepClone(options.overrides ?? {});
    this.overlayError = options.overlayError;
  }

  /** Generated UI schemas for every installed plugin with configurable content. */
  getUISchemas(): ConfigUIPluginSchema[] {
    if (!this.uiSchemaCache) {
      const pluginManager = this.app.requireService(PluginManager);
      this.uiSchemaCache = pluginManager
        .getPlugins()
        .filter(plugin => "config" in plugin)
        .map(plugin => buildConfigUISchema(plugin))
        .filter((uiSchema): uiSchema is ConfigUIPluginSchema => uiSchema !== null && Object.keys(uiSchema.slices).length > 0);
    }
    return this.uiSchemaCache;
  }

  getOverrides(): Record<string, unknown> {
    return deepClone(this.overrides);
  }

  /** base ⊕ overrides, parsed with the composed schema. */
  getEffectiveConfig(): unknown {
    return this.configSchema.parse(deepClone(this.baseConfig, this.overrides));
  }

  /**
   * Effective config and current overrides for every UI-schema-covered config
   * slice, with sensitive values redacted to `{ __sensitive: true, isSet }`.
   * Slices without a UI schema are never sent to the client.
   */
  getRedactedValues(): { effective: Record<string, unknown>; overrides: Record<string, unknown> } {
    const effectiveConfig = this.getEffectiveConfig() as Record<string, unknown>;
    const effective: Record<string, unknown> = {};
    const overrides: Record<string, unknown> = {};

    for (const uiSchema of this.getUISchemas()) {
      for (const [key, node] of Object.entries(uiSchema.slices)) {
        const effectiveSlice = redactSensitiveValues(node, effectiveConfig[key]);
        if (effectiveSlice !== undefined) effective[key] = effectiveSlice;
        const overrideSlice = redactSensitiveValues(node, this.overrides[key]);
        if (overrideSlice !== undefined) overrides[key] = overrideSlice;
      }
    }
    return { effective, overrides };
  }

  /**
   * Validates a candidate override set (the full desired set, not a patch).
   * Resolves sensitive sentinels, prunes values that match the base config,
   * and parses the merged result with the composed schema.
   */
  validateOverrides(
    candidateOverrides: Record<string, unknown>,
  ): { ok: true; normalized: Record<string, unknown>; parsed: unknown } | { ok: false; issues: ConfigValidationIssue[] } {
    const keyIssues = this.checkAllowedKeys(candidateOverrides);
    if (keyIssues.length > 0) return { ok: false, issues: keyIssues };

    const resolved = resolveSensitiveSentinels(candidateOverrides, this.overrides) as Record<string, unknown>;
    const normalized = (pruneToOverrides(resolved, this.parsedBase) ?? {}) as Record<string, unknown>;

    const merged = deepClone(this.baseConfig, normalized);
    const result = this.configSchema.safeParse(merged);
    if (!result.success) {
      return {
        ok: false,
        issues: result.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message })),
      };
    }
    return { ok: true, normalized, parsed: result.data };
  }

  /**
   * Validates, live-reconfigures plugins, swaps the running app config, and
   * persists the overrides file — in that order, so a config the running app
   * rejected is never written to disk. Serialized: concurrent calls run one
   * at a time.
   */
  apply(candidateOverrides: Record<string, unknown>): Promise<ConfigApplyResult> {
    const run = this.applyQueue.then(() => this.doApply(candidateOverrides));
    this.applyQueue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** Removes the override at `path` (empty path clears all) and re-applies. */
  resetPath(path: string[]): Promise<ConfigApplyResult> {
    const next = this.getOverrides();
    deleteAtPath(next, path);
    return this.apply(next);
  }

  private async doApply(candidateOverrides: Record<string, unknown>): Promise<ConfigApplyResult> {
    const validation = this.validateOverrides(candidateOverrides);
    if (!validation.ok) return validation;
    const { normalized, parsed } = validation;

    const pluginManager = this.app.requireService(PluginManager);
    const { restartRequired } = await pluginManager.reconfigurePlugins(parsed as TokenRingAppConfig);
    this.app.replaceConfig(parsed as TokenRingAppConfig);
    writeYamlAtomic(this.overridesFile, normalized, OVERRIDES_HEADER);
    this.overrides = normalized;

    if (restartRequired) this.restartRequired = true;
    return { ok: true, restartRequired: this.restartRequired };
  }

  private get parsedBase(): unknown {
    this.parsedBaseCache ??= this.configSchema.parse(this.baseConfig);
    return this.parsedBaseCache;
  }

  private checkAllowedKeys(candidateOverrides: Record<string, unknown>): ConfigValidationIssue[] {
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
