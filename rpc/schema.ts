import { z } from "zod";
import { DebugTargetRefSchema, MIN_RECORDING_INTERVAL_MS } from "../state/DebugState.ts";

export const LogEntrySchema = z.object({
  timestamp: z.number(),
  level: z.enum(["info", "error"]),
  message: z.string(),
});

export const DebugTargetSchema = z.object({
  kind: z.string(),
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

export const DebugSnapshotInfoSchema = z.object({
  name: z.string(),
  kind: z.string(),
  sizeBytes: z.number(),
  capturedAt: z.number(),
});

export const DebugRecordingStatusSchema = z.object({
  recording: z.boolean(),
  intervalMs: z.number(),
  targets: z.array(DebugTargetRefSchema),
  startedAt: z.number().nullable(),
  lastCaptureAt: z.number().nullable(),
  captureCount: z.number(),
  lastSnapshot: z.string().nullable(),
  lastError: z.string().nullable(),
});

export type DebugTarget = z.infer<typeof DebugTargetSchema>;
export type DebugSnapshotInfo = z.infer<typeof DebugSnapshotInfoSchema>;
export type DebugRecordingStatus = z.infer<typeof DebugRecordingStatusSchema>;

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
    listDebugTargets: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({
        targets: z.array(DebugTargetSchema),
      }),
    },
    captureDebugSnapshot: {
      type: "mutation" as const,
      input: DebugTargetRefSchema,
      result: z.discriminatedUnion("status", [z.object({ status: z.literal("success"), name: z.string() }), z.object({ status: z.literal("targetNotFound") })]),
    },
    listDebugSnapshots: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({
        snapshots: z.array(DebugSnapshotInfoSchema),
      }),
    },
    readDebugSnapshot: {
      type: "query" as const,
      input: z.object({ name: z.string() }),
      result: z.discriminatedUnion("status", [
        z.object({ status: z.literal("success"), name: z.string(), content: z.string() }),
        z.object({ status: z.literal("notFound") }),
      ]),
    },
    deleteDebugSnapshot: {
      type: "mutation" as const,
      input: z.object({ name: z.string() }),
      result: z.discriminatedUnion("status", [z.object({ status: z.literal("success") }), z.object({ status: z.literal("notFound") })]),
    },
    startDebugRecording: {
      type: "mutation" as const,
      input: z.object({
        targets: z.array(DebugTargetRefSchema).min(1),
        intervalMs: z.number().min(MIN_RECORDING_INTERVAL_MS),
      }),
      result: DebugRecordingStatusSchema,
    },
    stopDebugRecording: {
      type: "mutation" as const,
      input: z.object({}),
      result: DebugRecordingStatusSchema,
    },
    streamDebugRecording: {
      type: "stream" as const,
      input: z.object({}),
      result: DebugRecordingStatusSchema,
    },
  },
};

export default AppRpcSchema;
