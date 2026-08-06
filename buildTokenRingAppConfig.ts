import fs from "node:fs";
import deepClone from "@tokenring-ai/utility/object/deepClone";
import { isPlainObject } from "@tokenring-ai/utility/object/isPlainObject";
import joinDefault from "@tokenring-ai/utility/string/joinDefault";
import { file, Glob, YAML } from "bun";
import type { z } from "zod";
import type { TokenRingAppConfigSchema } from "./schema.ts";
import type { ConfigLayer } from "./state/AppConfigurationState.ts";

export interface BuildConfigOptions {
  /** Global config file, e.g. ~/.tokenring/config.yaml. */
  globalConfigFile?: string;
  /** Workspace config file, e.g. <workspaceDirectory>/config.yaml. */
  workspaceConfigFile?: string;
}

export interface TokenRingAppConfigLayers<T extends z.ZodTypeAny> {
  /** CLI defaults ⊕ configDirectories YAML, parsed — the immutable app layer. */
  appConfig: z.output<T>;
  /** Sparse user overrides as loaded ({} when absent or rejected). */
  globalConfig: ConfigLayer;
  /** Sparse project overrides as loaded ({} when absent or rejected). */
  workspaceConfig: ConfigLayer;
  /** Set when an override file exists but was rejected; that layer is then empty. */
  overlayError: string | undefined;
}

/**
 * Builds the app config layers: the app layer (CLI-derived defaults, then every
 * `**\/*.yaml` in each config directory), plus the sparse user and project
 * override layers. A rejected override file never prevents boot — that layer is
 * dropped and the error is surfaced for the configuration UI.
 */
export async function buildTokenRingAppConfigLayers<T extends z.ZodTypeAny>(
  configSchema: T,
  defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>,
  options: BuildConfigOptions = {},
): Promise<TokenRingAppConfigLayers<T>> {
  const { configDirectories } = defaultConfig.app;

  const glob = new Glob("**/*.yaml");

  let mergedConfig = defaultConfig;

  // Try each directory and extension in order
  for (const dir of configDirectories) {
    if (fs.existsSync(dir)) {
      const configs = glob.scan({ cwd: dir, absolute: true });
      for await (const config of configs) {
        const configContent = await file(config).text();
        const parsedYaml = YAML.parse(configContent);
        mergedConfig = deepClone(mergedConfig, parsedYaml as {});
      }
    }
  }

  const appConfig = configSchema.parse(mergedConfig) as z.output<T>;

  const overlayErrors: string[] = [];
  const overlays: ConfigLayer[] = [];

  /** Loads one sparse overlay, validating it on top of the layers below it. */
  const loadOverlay = async (overlayFile: string | undefined): Promise<ConfigLayer> => {
    if (!overlayFile || !fs.existsSync(overlayFile)) return {};
    try {
      const parsedYaml = YAML.parse(await file(overlayFile).text());
      if (parsedYaml == null) return {};
      if (!isPlainObject(parsedYaml)) {
        overlayErrors.push(`Configuration overrides in ${overlayFile} were rejected and are not active: Expected a YAML mapping at the top level`);
        return {};
      }
      configSchema.parse(deepClone(mergedConfig, ...overlays, parsedYaml));
      return parsedYaml as ConfigLayer;
    } catch (error: unknown) {
      overlayErrors.push(`Configuration overrides in ${overlayFile} were rejected and are not active: ${(error as Error).message}`);
      return {};
    }
  };

  const globalConfig = await loadOverlay(options.globalConfigFile);
  overlays.push(globalConfig);
  const workspaceConfig = await loadOverlay(options.workspaceConfigFile);

  return {
    appConfig,
    globalConfig,
    workspaceConfig,
    overlayError: joinDefault("\n", overlayErrors, undefined),
  };
}

export default async function buildTokenRingAppConfig<T extends z.ZodTypeAny>(
  configSchema: T,
  defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>,
  options: BuildConfigOptions = {},
): Promise<z.output<T>> {
  const { appConfig, globalConfig, workspaceConfig } = await buildTokenRingAppConfigLayers(configSchema, defaultConfig, options);
  return configSchema.parse(deepClone(appConfig as object, globalConfig, workspaceConfig)) as z.output<T>;
}
