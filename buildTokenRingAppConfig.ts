import deepMerge from "@tokenring-ai/utility/object/deepMerge";
import fs from "node:fs";
import path from "path";
import {z} from "zod";
import type {TokenRingAppConfigSchema} from "./schema.ts";

export default async function buildTokenRingAppConfig<
  T extends z.ZodTypeAny
>(defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>): Promise<z.output<T>> {
  const {dataDirectory, configFileName, configSchema} = defaultConfig.app;
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory);
  }

  const gitIgnoreFile = path.resolve(dataDirectory, ".gitignore");
  if (!fs.existsSync(gitIgnoreFile)) {
    fs.writeFileSync(gitIgnoreFile, "*.sqlite*\n");
}

  const possibleConfigExtensions = ["ts", "mjs", "cjs", "js"];

  let mergedConfig = defaultConfig;
  let parsedConfig = configSchema.parse(defaultConfig) as z.output<T>;

  // Try each directory and extension in order
  for (const dir of ["~", dataDirectory]) {
    for (const ext of possibleConfigExtensions) {
      const potentialConfig = path.join(dir, `${configFileName}.${ext}`);
      if (fs.existsSync(potentialConfig)) {
        const config = await import(potentialConfig);
        mergedConfig = deepMerge(mergedConfig, config.default ?? config);
        parsedConfig = configSchema.parse(mergedConfig) as z.output<T>; // We parse the config each time to verify that it is complete and well formed at all steps.
        break;
      }
    }
  }

  return parsedConfig;
}