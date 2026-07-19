import fs from "node:fs";
import deepClone from "@tokenring-ai/utility/object/deepClone";
import { isPlainObject } from "@tokenring-ai/utility/object/isPlainObject";
import { file, Glob, YAML } from "bun";
import type { z } from "zod";
import type { TokenRingAppConfigSchema } from "./schema.ts";

export interface BuildConfigOptions {
  /** Sparse user override file applied last (highest precedence), e.g. ~/.tokenring/config.yaml. */
  userOverridesFile?: string;
}

export interface TokenRingAppConfigLayers<T extends z.ZodTypeAny> {
  /** Fully merged and parsed config (defaults ⊕ configDirectories ⊕ user overrides). */
  config: z.output<T>;
  /** Merged defaults + configDirectories YAML, before user overrides (input format). */
  baseConfig: unknown;
  /** User overrides as loaded ({} when absent or rejected). */
  overrides: Record<string, unknown>;
  /** Set when the user overrides file exists but was rejected; config then excludes it. */
  overlayError: string | undefined;
}

/**
 * Builds the app config in layers: CLI-derived defaults, then every
 * `**\/*.yaml` in each config directory, then the user override file. A
 * rejected override file never prevents boot — the config falls back to the
 * pre-override layers and the error is surfaced for the configuration UI.
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
  let parsedConfig = configSchema.parse(defaultConfig) as z.output<T>;

  // Try each directory and extension in order
  for (const dir of configDirectories) {
    if (fs.existsSync(dir)) {
      const configs = glob.scan({ cwd: dir, absolute: true });
      for await (const config of configs) {
        const configContent = await file(config).text();
        const parsedYaml = YAML.parse(configContent);
        mergedConfig = deepClone(mergedConfig, parsedYaml as {});
        parsedConfig = configSchema.parse(mergedConfig) as z.output<T>;
      }
    }
  }

  let overrides: Record<string, unknown> = {};
  let overlayError: string | undefined;

  const { userOverridesFile } = options;
  if (userOverridesFile && fs.existsSync(userOverridesFile)) {
    try {
      const parsedYaml = YAML.parse(await file(userOverridesFile).text());
      if (parsedYaml != null) {
        if (!isPlainObject(parsedYaml)) {
          throw new Error("Expected a YAML mapping at the top level");
        }
        parsedConfig = configSchema.parse(deepClone(mergedConfig, parsedYaml)) as z.output<T>;
        overrides = parsedYaml as Record<string, unknown>;
      }
    } catch (error: unknown) {
      overlayError = `User configuration overrides in ${userOverridesFile} were rejected and are not active: ${(error as Error).message}`;
    }
  }

  return { config: parsedConfig, baseConfig: mergedConfig, overrides, overlayError };
}

export default async function buildTokenRingAppConfig<T extends z.ZodTypeAny>(
  configSchema: T,
  defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>,
): Promise<z.output<T>> {
  const { config } = await buildTokenRingAppConfigLayers(configSchema, defaultConfig);
  return config;
}
