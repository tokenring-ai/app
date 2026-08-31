import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import DebugService, { type DebugSnapshotSource } from "../debug/DebugService.ts";
import { formatSnapshotTimestamp, isValidSnapshotName, sanitizeSnapshotLabel } from "../debug/snapshotName.ts";
import { DebugState } from "../state/DebugState.ts";
import TokenRingApp from "../TokenRingApp.ts";
import { AppStateSlice } from "../types.ts";

let workspaceDirectory: string;
let app: TokenRingApp;
let debugService: DebugService;

function createApp(directory: string): TokenRingApp {
  return new TokenRingApp({
    app: {
      workingDirectory: directory,
      workspaceDirectory: directory,
      configDirectories: [],
      shutdownMonitorIntervalMs: 2000,
      serviceRestartDelayMs: 5000,
      printLogs: false,
    },
  });
}

async function readDebugDirectory(): Promise<string[]> {
  return (await fs.readdir(path.join(workspaceDirectory, "debug"))).sort();
}

beforeEach(async () => {
  workspaceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tokenring-debug-"));
  app = createApp(workspaceDirectory);
  debugService = app.requireService(DebugService);
});

afterEach(async () => {
  debugService.stopRecording();
  // Let any capture already in flight finish before the directory goes away.
  while ((app.backgroundTasks.get("DebugService") ?? 0) > 0) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  app.shutdown("test finished");
  await fs.rm(workspaceDirectory, { recursive: true, force: true });
});

describe("snapshot names", () => {
  it("formats the capture time as YYYYMMDDTHH:MM:SS", () => {
    expect(formatSnapshotTimestamp(new Date(2026, 0, 1, 14, 37, 1))).toBe("20260101T14:37:01");
  });

  it("replaces characters that are awkward in file names", () => {
    expect(sanitizeSnapshotLabel("agent/../etc")).toBe("agent_etc");
    expect(sanitizeSnapshotLabel("///")).toBe("unknown");
  });

  it("only accepts bare snapshot file names", () => {
    expect(isValidSnapshotName("app-state-20260101T14:37:01.json")).toBe(true);
    expect(isValidSnapshotName("../secrets.json")).toBe(false);
    expect(isValidSnapshotName("nested/app.json")).toBe(false);
    expect(isValidSnapshotName("app-state.txt")).toBe(false);
  });
});

describe("DebugService", () => {
  it("is registered on every app", () => {
    expect(debugService).toBeInstanceOf(DebugService);
    expect(debugService.getDebugDirectory()).toBe(path.join(workspaceDirectory, "debug"));
  });

  it("offers application state as a capture target", () => {
    expect(debugService.listTargets()).toEqual([
      {
        kind: "app",
        id: "state",
        label: "Application State",
        description: "TokenRingApp state manager, services and configuration",
      },
    ]);
  });

  it("captures app state as pretty-printed JSON under workspaceDirectory/debug", async () => {
    const name = await debugService.capture({ kind: "app", id: "state" });

    expect(name).toMatch(/^app-state-\d{8}T\d{2}:\d{2}:\d{2}\.json$/);
    expect(await readDebugDirectory()).toEqual([name!]);

    const raw = await fs.readFile(path.join(workspaceDirectory, "debug", name!), "utf8");
    expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2));

    const snapshot = JSON.parse(raw);
    expect(snapshot.sessionId).toBe(app.sessionId);
    expect(snapshot.target).toEqual({ kind: "app", id: "state" });
    expect(snapshot.data.state.AppLogsState).toBeDefined();
    expect(snapshot.data.services.map((service: { name: string }) => service.name)).toContain("DebugService");
  });

  it("suffixes snapshots captured within the same second", async () => {
    const first = await debugService.capture({ kind: "app", id: "state" });
    const second = await debugService.capture({ kind: "app", id: "state" });

    expect(second).not.toBe(first);
    expect(await readDebugDirectory()).toHaveLength(2);
  });

  it("reports a slice that fails to serialize instead of losing the snapshot", async () => {
    class BrokenState extends AppStateSlice<z.ZodTypeAny> {
      constructor() {
        super("BrokenState", z.object({}));
      }
      serialize(): never {
        throw new Error("cannot serialize");
      }
      deserialize(): void {}
    }
    app.initializeState(BrokenState, {});

    const name = await debugService.capture({ kind: "app", id: "state" });
    const snapshot = JSON.parse(await fs.readFile(path.join(workspaceDirectory, "debug", name!), "utf8"));

    expect(snapshot.data.state.BrokenState.__serializationError).toContain("cannot serialize");
    expect(snapshot.data.state.AppLogsState).toBeDefined();
  });

  describe("registered snapshot sources", () => {
    const source: DebugSnapshotSource = {
      kind: "agent",
      displayName: "Agents",
      listTargets: () => [{ kind: "agent", id: "abc123", label: "Coder (abc123)", description: "Idle" }],
      captureTarget: id => (id === "abc123" ? { agentId: id, greeting: "hello" } : undefined),
    };

    beforeEach(() => {
      debugService.registerSnapshotSource(source);
    });

    it("lists their targets after application state", () => {
      expect(debugService.listTargets().map(target => target.id)).toEqual(["state", "abc123"]);
    });

    it("captures a target into a kind-prefixed file", async () => {
      const name = await debugService.capture({ kind: "agent", id: "abc123" });

      expect(name).toMatch(/^agent-abc123-\d{8}T\d{2}:\d{2}:\d{2}\.json$/);
      const snapshot = JSON.parse(await fs.readFile(path.join(workspaceDirectory, "debug", name!), "utf8"));
      expect(snapshot.data).toEqual({ agentId: "abc123", greeting: "hello" });
    });

    it("returns null for a target that no longer exists", async () => {
      expect(await debugService.capture({ kind: "agent", id: "gone" })).toBeNull();
      expect(await debugService.capture({ kind: "nosuchkind", id: "abc123" })).toBeNull();
    });
  });

  describe("listing, reading and deleting snapshots", () => {
    it("lists snapshots newest first with their kind", async () => {
      debugService.registerSnapshotSource({
        kind: "agent",
        displayName: "Agents",
        listTargets: () => [],
        captureTarget: () => ({ ok: true }),
      });
      const appSnapshot = await debugService.capture({ kind: "app", id: "state" });
      const agentSnapshot = await debugService.capture({ kind: "agent", id: "abc" });

      const listed = await debugService.listSnapshots();
      expect(listed.map(entry => entry.name).sort()).toEqual([agentSnapshot!, appSnapshot!].sort());
      expect(listed.find(entry => entry.name === appSnapshot)?.kind).toBe("app");
      expect(listed.find(entry => entry.name === agentSnapshot)?.kind).toBe("agent");
      expect(listed.every(entry => entry.sizeBytes > 0)).toBe(true);
    });

    it("returns an empty list when nothing has been captured", async () => {
      expect(await debugService.listSnapshots()).toEqual([]);
    });

    it("reads a snapshot back verbatim", async () => {
      const name = await debugService.capture({ kind: "app", id: "state" });
      const content = await debugService.readSnapshot(name!);
      expect(JSON.parse(content!).sessionId).toBe(app.sessionId);
    });

    it("refuses to read or delete outside the debug directory", async () => {
      expect(await debugService.readSnapshot("../../etc/passwd")).toBeNull();
      expect(await debugService.deleteSnapshot("../../etc/passwd")).toBe(false);
    });

    it("deletes a snapshot once", async () => {
      const name = await debugService.capture({ kind: "app", id: "state" });
      expect(await debugService.deleteSnapshot(name!)).toBe(true);
      expect(await debugService.deleteSnapshot(name!)).toBe(false);
      expect(await debugService.listSnapshots()).toEqual([]);
    });
  });

  describe("recording", () => {
    it("captures immediately when recording starts and tracks status", async () => {
      debugService.startRecording([{ kind: "app", id: "state" }], 5000);

      const state = app.getState(DebugState);
      expect(state.recording).toBe(true);
      expect(state.intervalMs).toBe(5000);

      await app.timedWaitForState(DebugState, current => current.captureCount > 0, 2000, new AbortController().signal);
      expect(app.getState(DebugState).lastSnapshot).toMatch(/^app-state-/);
      expect(await debugService.listSnapshots()).toHaveLength(1);
    });

    it("clamps the interval to the minimum", () => {
      debugService.startRecording([{ kind: "app", id: "state" }], 10);
      expect(app.getState(DebugState).intervalMs).toBe(1000);
    });

    it("stops recording", async () => {
      debugService.startRecording([{ kind: "app", id: "state" }], 5000);
      await app.timedWaitForState(DebugState, current => current.captureCount > 0, 2000, new AbortController().signal);

      debugService.stopRecording();
      expect(app.getState(DebugState).recording).toBe(false);
      expect(app.getState(DebugState).startedAt).toBeNull();
    });

    it("records a failure when a recorded target disappears", async () => {
      debugService.startRecording([{ kind: "agent", id: "gone" }], 5000);
      await app.timedWaitForState(DebugState, current => current.lastError !== null, 2000, new AbortController().signal);

      expect(app.getState(DebugState).lastError).toContain("agent/gone");
      expect(app.getState(DebugState).captureCount).toBe(0);
    });
  });
});
