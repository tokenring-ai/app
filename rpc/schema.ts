import { z } from "zod";

export const LogEntrySchema = z.object({
  timestamp: z.number(),
  level: z.enum(["info", "error"]),
  message: z.string(),
});

const AppRpcSchema = {
  name: "App RPC",
  path: "/rpc/app",
  methods: {
    listPlugins: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({
        plugins: z.array(
          z.object({
            name: z.string(),
            displayName: z.string(),
            version: z.string(),
            description: z.string(),
            hasConfig: z.boolean(),
          }),
        ),
      }),
    },
    getLogs: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({
        logs: z.array(LogEntrySchema),
      }),
    },
    streamLogs: {
      type: "stream" as const,
      input: z.object({
        fromPosition: z.number().optional().default(0),
      }),
      result: z.object({
        logs: z.array(LogEntrySchema),
        position: z.number(),
      }),
    },
  },
};

export default AppRpcSchema;
