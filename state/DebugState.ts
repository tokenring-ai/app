import { z } from "zod";
import { AppStateSlice } from "../types.ts";

export const DebugTargetRefSchema = z.object({
  kind: z.string(),
  id: z.string(),
});

export type DebugTargetRef = z.output<typeof DebugTargetRefSchema>;

const serializationSchema = z.object({
  recording: z.boolean().default(false),
  intervalMs: z.number().default(5000),
  targets: z.array(DebugTargetRefSchema).default([]),
  startedAt: z.number().nullable().default(null),
  lastCaptureAt: z.number().nullable().default(null),
  captureCount: z.number().default(0),
  lastSnapshot: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
});

/** Shortest recording interval the UI is allowed to request. */
export const MIN_RECORDING_INTERVAL_MS = 1000;

/**
 * Tracks the debug recorder: whether it is running, what it captures, and how
 * the most recent capture went. Only the recorder writes to this slice; the
 * debugging UI reads it to drive the record button.
 */
export class DebugState extends AppStateSlice<typeof serializationSchema> {
  recording = false;
  intervalMs = 5000;
  targets: DebugTargetRef[] = [];
  startedAt: number | null = null;
  lastCaptureAt: number | null = null;
  captureCount = 0;
  lastSnapshot: string | null = null;
  lastError: string | null = null;

  constructor() {
    super("DebugState", serializationSchema);
  }

  serialize(): z.output<typeof serializationSchema> {
    return {
      recording: this.recording,
      intervalMs: this.intervalMs,
      targets: this.targets,
      startedAt: this.startedAt,
      lastCaptureAt: this.lastCaptureAt,
      captureCount: this.captureCount,
      lastSnapshot: this.lastSnapshot,
      lastError: this.lastError,
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.recording = data.recording;
    this.intervalMs = data.intervalMs;
    this.targets = [...data.targets];
    this.startedAt = data.startedAt;
    this.lastCaptureAt = data.lastCaptureAt;
    this.captureCount = data.captureCount;
    this.lastSnapshot = data.lastSnapshot;
    this.lastError = data.lastError;
  }

  start(targets: DebugTargetRef[], intervalMs: number): void {
    this.recording = true;
    this.targets = [...targets];
    this.intervalMs = Math.max(MIN_RECORDING_INTERVAL_MS, intervalMs);
    this.startedAt = Date.now();
    this.lastCaptureAt = null;
    this.captureCount = 0;
    this.lastError = null;
  }

  stop(): void {
    this.recording = false;
    this.startedAt = null;
  }

  recordCapture(snapshotName: string): void {
    this.lastCaptureAt = Date.now();
    this.captureCount += 1;
    this.lastSnapshot = snapshotName;
    this.lastError = null;
  }

  recordFailure(error: string): void {
    this.lastCaptureAt = Date.now();
    this.lastError = error;
  }
}
