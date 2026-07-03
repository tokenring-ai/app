import deepClone from "@tokenring-ai/utility/object/deepClone";
import { file, Glob, YAML } from "bun";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import type { TokenRingAppConfigSchema } from "./schema.ts";

export default async function buildTokenRingAppConfig<T extends z.ZodTypeAny>(
  configSchema: T,
  defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>,
): Promise<z.output<T>> {
  const { dataDirectory, configDirectories } = defaultConfig.app;
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory);
  }

  const gitIgnoreFile = path.resolve(dataDirectory, ".gitignore");
  if (!fs.existsSync(gitIgnoreFile)) {
    fs.writeFileSync(gitIgnoreFile, "*.sqlite*\n");
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
        const parsedYaml = YAML.parse(configContent) as any;
        mergedConfig = deepClone(mergedConfig, parsedYaml);
        parsedConfig = configSchema.parse(mergedConfig) as z.output<T>;
      }
    }
  }

  return parsedConfig;
}
