import z from "zod";

export const TokenRingAppConfigSchema = z.object({
  app: z.object({
    dataDirectory: z.string(),
    configDirectories: z.array(z.string()),
    configSchema: z.custom<z.ZodTypeAny>(),
    shutdownMonitorIntervalMs: z.number().default(2000),
    serviceRestartDelayMs: z.number().default(5000),
    printLogs: z.boolean().default(false),
  }),
});
export const LooseTokenRingAppConfigSchema = TokenRingAppConfigSchema.loose();
export type TokenRingAppConfig = z.output<typeof LooseTokenRingAppConfigSchema>;
