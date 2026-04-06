import z from "zod";

export const TokenRingAppConfigSchema = z.object({
  app: z.object({
    dataDirectory: z.string(),
    configFileName: z.string(),
    configSchema: z.custom<z.ZodTypeAny>(),
    shutdownMonitorIntervalMs: z.number().default(2000),
    serviceRestartDelayMs: z.number().default(5000),
  })
});
export const LooseTokenRingAppConfigSchema = TokenRingAppConfigSchema.loose();
export type TokenRingAppConfig = z.output<typeof LooseTokenRingAppConfigSchema>;