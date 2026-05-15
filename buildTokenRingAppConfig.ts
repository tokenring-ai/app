import deepClone from "@tokenring-ai/utility/object/deepClone";
import fs from "node:fs";
import path from "node:path";
import { Glob, YAML } from "bun";
import type { z } from "zod";
import type { TokenRingAppConfigSchema } from "./schema.ts";

export default function buildTokenRingAppConfig<T extends z.ZodTypeAny>(configSchema: T, defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>): z.output<T> {
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
      const configs = glob.scanSync({ cwd: dir, absolute: true });
      for (const config of configs) {
        const configContent = fs.readFileSync(config, "utf-8");
        const parsedYaml = YAML.parse(configContent) as any;
        mergedConfig = deepClone(mergedConfig, parsedYaml);
        parsedConfig = configSchema.parse(mergedConfig) as z.output<T>;
      }
    }
  }

  return parsedConfig;
}
