import deepMerge from "@tokenring-ai/utility/object/deepMerge";
import fs from "node:fs";
import path from "path";
import {z, ZodObject} from "zod";

type CreateTokenRingAppOptions<ConfigSchema extends ZodObject> = {
  workingDirectory: string,
  dataDirectory: string,
  configFileName: string,
  configSchema: ConfigSchema,
  defaultConfig: z.input<ConfigSchema>,
  mergeConfig?: (prevConfig: z.input<ConfigSchema>, configToMerge: z.input<ConfigSchema>) => z.input<ConfigSchema>
};

export default async function buildTokenRingAppConfig<ConfigSchema extends ZodObject>({
                                                                     workingDirectory,
                                                                     dataDirectory,
                                                                     configFileName,
                                                                     configSchema,
                                                                     defaultConfig,
                                                                     mergeConfig = deepMerge
                                                                    }: CreateTokenRingAppOptions<ConfigSchema>): Promise<z.output<ConfigSchema>> {
  if (!fs.existsSync(workingDirectory)) {
    throw new Error(`Source directory not found: ${workingDirectory}`);
  }

  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory);
  }

  const gitIgnoreFile = path.resolve(dataDirectory, ".gitignore");
  if (!fs.existsSync(gitIgnoreFile)) {
    fs.writeFileSync(gitIgnoreFile, "*.sqlite*\n");
  }

  const possibleConfigExtensions = ["ts", "mjs", "cjs", "js"];

  let mergedConfig = defaultConfig;
  let parsedConfig = configSchema.parse(defaultConfig);

  // Try each directory and extension in order
  for (const dir of ["~", dataDirectory]) {
    for (const ext of possibleConfigExtensions) {
      const potentialConfig = path.join(dir, `${configFileName}.${ext}`);
      if (fs.existsSync(potentialConfig)) {
        const config = await import(potentialConfig);
        mergedConfig = mergeConfig(mergedConfig, config.default ?? config);
        parsedConfig = configSchema.parse(mergedConfig); // We parse the config each time to verify that it is complete and well formed at all steps.
        break;
      }
    }
  }

  return parsedConfig;
}