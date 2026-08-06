import z from "zod";

export const TokenRingAppConfigSchema = z.object({
  app: z.object({
    workingDirectory: z.string(),
    workspaceDirectory: z.string(),
    //dataDirectory: z.string(),
    configDirectories: z.array(z.string()),
    shutdownMonitorIntervalMs: z.number().default(2000),
    serviceRestartDelayMs: z.number().default(5000),
    printLogs: z.boolean().default(false),
  }),
});
export const LooseTokenRingAppConfigSchema = TokenRingAppConfigSchema.loose();
export type TokenRingAppConfig = z.output<typeof LooseTokenRingAppConfigSchema>;

export const AppSessionCheckpointSchema = z.object({
  sessionId: z.string(),
  createdAt: z.number(),
  hostname: z.string(),
  workspaceDirectory: z.string(),
  state: z.record(z.string(), z.unknown()),
});

export type AppSessionCheckpoint = z.input<typeof AppSessionCheckpointSchema>;
