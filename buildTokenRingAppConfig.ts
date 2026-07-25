import fs from "node:fs";
import deepClone from "@tokenring-ai/utility/object/deepClone";
import { isPlainObject } from "@tokenring-ai/utility/object/isPlainObject";
import { file, Glob, YAML } from "bun";
import type { z } from "zod";
import type { TokenRingAppConfigSchema } from "./schema.ts";
import type { ConfigLayer } from "./state/AppConfigurationState.ts";

export interface BuildConfigOptions {
  /** Sparse user override file, e.g. ~/.tokenring/config.yaml. */
  userOverridesFile?: string;
  /** Sparse project override file, e.g. <projectDirectory>/.tokenring/config.yaml. */
  projectOverridesFile?: string;
}

export interface TokenRingAppConfigLayers<T extends z.ZodTypeAny> {
  /** CLI defaults ⊕ configDirectories YAML, parsed — the immutable app layer. */
  appConfig: z.output<T>;
  /** Sparse user overrides as loaded ({} when absent or rejected). */
  userConfig: ConfigLayer;
  /** Sparse project overrides as loaded ({} when absent or rejected). */
  projectConfig: ConfigLayer;
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
  const { dataDirectory, configDirectories } = defaultConfig.app;
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory);
  }

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
        throw new Error("Expected a YAML mapping at the top level");
      }
      configSchema.parse(deepClone(mergedConfig, ...overlays, parsedYaml));
      return parsedYaml as ConfigLayer;
    } catch (error: unknown) {
      overlayErrors.push(`Configuration overrides in ${overlayFile} were rejected and are not active: ${(error as Error).message}`);
      return {};
    }
  };

  const userConfig = await loadOverlay(options.userOverridesFile);
  overlays.push(userConfig);
  const projectConfig = await loadOverlay(options.projectOverridesFile);

  return {
    appConfig,
    userConfig,
    projectConfig,
    overlayError: overlayErrors.length > 0 ? overlayErrors.join("\n") : undefined,
  };
}

export default async function buildTokenRingAppConfig<T extends z.ZodTypeAny>(
  configSchema: T,
  defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>,
  options: BuildConfigOptions = {},
): Promise<z.output<T>> {
  const { appConfig, userConfig, projectConfig } = await buildTokenRingAppConfigLayers(configSchema, defaultConfig, options);
  return configSchema.parse(deepClone(appConfig as object, userConfig, projectConfig)) as z.output<T>;
}
