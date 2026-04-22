import { z } from "zod";

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
        logs: z.array(
          z.object({
            timestamp: z.number(),
            level: z.enum(["info", "error"]),
            message: z.string(),
          }),
        ),
      }),
    },
  },
};

export default AppRpcSchema;
