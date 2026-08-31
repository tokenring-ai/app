import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import formatError from "@tokenring-ai/utility/error/formatError";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { DebugState, type DebugTargetRef } from "../state/DebugState.ts";
import type TokenRingApp from "../TokenRingApp.ts";
import type { TokenRingService } from "../types.ts";
import { createApplicationSnapshotSource } from "./applicationSnapshotSource.ts";
import { formatSnapshotTimestamp, isValidSnapshotName, SNAPSHOT_EXTENSION, sanitizeSnapshotLabel } from "./snapshotName.ts";

/** Something the debugger can capture. */
export interface DebugSnapshotSource {
  /** Groups targets in the UI and prefixes their snapshot files, e.g. `agent`. */
  readonly kind: string;
  /** Human readable name for the group, e.g. `Agents`. */
  readonly displayName: string;

  /** Everything of this kind that can currently be captured. */
  listTargets(): DebugTarget[];

  /** Returns the dump for one target, or `undefined` if it no longer exists. */
  captureTarget(id: string): unknown;
}

export interface DebugTarget {
  kind: string;
  id: string;
  label: string;
  description: string;
}

export interface DebugSnapshotInfo {
  name: string;
  kind: string;
  sizeBytes: number;
  capturedAt: number;
}

/** How often the recorder re-checks state while idle or between captures. */
const RECORDER_POLL_INTERVAL_MS = 500;

/**
 * Captures debugging snapshots of live app and agent state and writes them to
 * `<workspaceDirectory>/debug` as pretty-printed JSON.
 *
 * Subsystems register a {@link DebugSnapshotSource} so their objects show up
 * as targets. Application state is registered as one of those sources.
 */
export default class DebugService implements TokenRingService {
  readonly name = "DebugService";
  description = "Captures snapshots of app and agent state for debugging";

  private sources = new KeyedRegistry<DebugSnapshotSource>();

  constructor(private readonly app: TokenRingApp) {
    this.app.initializeState(DebugState, {});
    this.registerSnapshotSource(createApplicationSnapshotSource(app));
  }

  registerSnapshotSource(source: DebugSnapshotSource): void {
    this.sources.set(source.kind, source);
  }

  /** The directory snapshots are written to. Created lazily on first capture. */
  getDebugDirectory(): string {
    return this.app.getWorkspaceResolvedPath("debug");
  }

  /** Everything that can be captured right now. */
  listTargets(): DebugTarget[] {
    return this.sources.valuesArray().flatMap(source => source.listTargets());
  }

  /**
   * Captures one target and writes it to the debug directory.
   * Returns the snapshot file name, or `null` when the target has gone away.
   */
  async capture(target: DebugTargetRef): Promise<string | null> {
    const dump = this.buildSnapshot(target);
    if (!dump) return null;

    const label = `${sanitizeSnapshotLabel(target.kind)}-${sanitizeSnapshotLabel(target.id)}`;
    return this.writeSnapshot(label, dump);
  }

  async listSnapshots(): Promise<DebugSnapshotInfo[]> {
    const directory = this.getDebugDirectory();
    let entries: string[];
    try {
      entries = await fs.readdir(directory);
    } catch {
      return [];
    }

    const snapshots: DebugSnapshotInfo[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(SNAPSHOT_EXTENSION) || !isValidSnapshotName(entry)) continue;
      try {
        const stats = await fs.stat(path.join(directory, entry));
        snapshots.push({
          name: entry,
          kind: entry.split("-")[0] ?? "unknown",
          sizeBytes: stats.size,
          capturedAt: stats.mtimeMs,
        });
      } catch {
        // The file vanished between readdir and stat; nothing to report.
      }
    }

    return snapshots.sort((a, b) => b.capturedAt - a.capturedAt);
  }

  /** Returns the raw JSON text of a snapshot, or `null` if it does not exist. */
  async readSnapshot(name: string): Promise<string | null> {
    const filePath = this.resolveSnapshotPath(name);
    if (!filePath) return null;
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return null;
    }
  }

  /** Deletes a snapshot, returning whether it was there to begin with. */
  async deleteSnapshot(name: string): Promise<boolean> {
    const filePath = this.resolveSnapshotPath(name);
    if (!filePath) return false;
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  startRecording(targets: DebugTargetRef[], intervalMs: number): void {
    this.app.mutateState(DebugState, state => state.start(targets, intervalMs));
    // Capture straight away so the record button produces a snapshot immediately.
    this.app.runBackgroundTask(this, () => this.captureRecordingTargets());
  }

  stopRecording(): void {
    this.app.mutateState(DebugState, state => state.stop());
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const { recording, intervalMs, lastCaptureAt } = this.app.getState(DebugState);

      if (!recording) {
        await delay(RECORDER_POLL_INTERVAL_MS, null, { signal }).catch(() => null);
        continue;
      }

      // Poll rather than sleep the whole interval so stopping and interval
      // changes take effect promptly.
      const dueIn = lastCaptureAt === null ? 0 : lastCaptureAt + intervalMs - Date.now();
      if (dueIn > 0) {
        await delay(Math.min(dueIn, RECORDER_POLL_INTERVAL_MS), null, { signal }).catch(() => null);
        continue;
      }

      await this.captureRecordingTargets();
    }
  }

  stop(): void {
    this.stopRecording();
  }

  /** Captures every target the recorder is currently watching. */
  private async captureRecordingTargets(): Promise<void> {
    const targets = this.app.getState(DebugState).targets;

    for (const target of targets) {
      try {
        const name = await this.capture(target);
        if (name) {
          this.app.mutateState(DebugState, state => state.recordCapture(name));
        } else {
          this.app.mutateState(DebugState, state => state.recordFailure(`Target ${target.kind}/${target.id} no longer exists`));
        }
      } catch (error) {
        this.app.mutateState(DebugState, state => state.recordFailure(formatError(error, { includeStack: false })));
        this.app.serviceError(this, `Failed to capture ${target.kind}/${target.id}:`, error);
      }
    }

    if (targets.length === 0) {
      this.app.mutateState(DebugState, state => state.recordFailure("No capture targets selected"));
    }
  }

  /** Builds the snapshot envelope for a target, or `undefined` when it is gone. */
  private buildSnapshot(target: DebugTargetRef): Record<string, unknown> | undefined {
    const data = this.sources.get(target.kind)?.captureTarget(target.id);
    if (data === undefined) return undefined;

    return {
      capturedAt: new Date().toISOString(),
      sessionId: this.app.sessionId,
      target,
      data,
    };
  }

  private resolveSnapshotPath(name: string): string | null {
    if (!isValidSnapshotName(name)) return null;
    return path.join(this.getDebugDirectory(), name);
  }

  /**
   * Writes `<label>-<timestamp>.json`, adding a counter suffix when several
   * captures land in the same second.
   */
  private async writeSnapshot(label: string, dump: unknown): Promise<string> {
    const directory = this.getDebugDirectory();
    await fs.mkdir(directory, { recursive: true });

    const base = `${label}-${formatSnapshotTimestamp()}`;
    const contents = JSON.stringify(dump, null, 2);

    for (let attempt = 0; ; attempt++) {
      const name = `${attempt === 0 ? base : `${base}-${attempt + 1}`}${SNAPSHOT_EXTENSION}`;
      try {
        await fs.writeFile(path.join(directory, name), contents, { encoding: "utf8", flag: "wx" });
        return name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }
}
