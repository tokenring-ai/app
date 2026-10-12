import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import DebugService from "../debug/DebugService.ts";
import appRpc from "../rpc/app.ts";
import { DebugState } from "../state/DebugState.ts";
import TokenRingApp from "../TokenRingApp.ts";

type StatusResult = { status: string };

let workspaceDirectory: string;
let app: TokenRingApp;

/** Calls a non-streaming method on the app RPC endpoint. */
function call<T>(method: string, args: unknown): Promise<T> {
  const execute = appRpc.methods[method as keyof typeof appRpc.methods]!.execute as (args: unknown, app: TokenRingApp) => T | Promise<T>;
  return Promise.resolve(execute(args, app));
}

beforeEach(async () => {
  workspaceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tokenring-debug-rpc-"));
  app = new TokenRingApp({
    app: {
      workingDirectory: workspaceDirectory,
      workspaceDirectory,
      configDirectories: [],
      shutdownMonitorIntervalMs: 2000,
      serviceRestartDelayMs: 5000,
      printLogs: false,
    },
  });
});

afterEach(async () => {
  app.requireService(DebugService).stopRecording();
  while ((app.backgroundTasks.get("DebugService") ?? 0) > 0) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  app.shutdown("test finished");
  await fs.rm(workspaceDirectory, { recursive: true, force: true });
});

describe("debug RPC", () => {
  it("lists application state as a capture target", async () => {
    const result = await call<{ targets: { kind: string; id: string }[] }>("listDebugTargets", {});
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({ kind: "app", id: "state", label: "Application State" });
  });

  it("captures, lists, reads and deletes a snapshot", async () => {
    const captured = await call<{ status: string; name: string }>("captureDebugSnapshot", { kind: "app", id: "state" });
    expect(captured.status).toBe("success");

    const listed = await call<{ snapshots: { name: string }[] }>("listDebugSnapshots", {});
    expect(listed.snapshots.map(entry => entry.name)).toEqual([captured.name]);

    const read = await call<{ status: string; content: string }>("readDebugSnapshot", { name: captured.name });
    expect(read.status).toBe("success");
    expect(JSON.parse(read.content).target).toEqual({ kind: "app", id: "state" });

    expect(await call<StatusResult>("deleteDebugSnapshot", { name: captured.name })).toEqual({ status: "success" });
    expect(await call<StatusResult>("deleteDebugSnapshot", { name: captured.name })).toEqual({ status: "notFound" });
  });

  it("reports a missing target and a missing snapshot", async () => {
    expect(await call<StatusResult>("captureDebugSnapshot", { kind: "agent", id: "nope" })).toEqual({ status: "targetNotFound" });
    expect(await call<StatusResult>("readDebugSnapshot", { name: "app-state-19700101T00:00:00.json" })).toEqual({ status: "notFound" });
  });

  it("starts and stops recording", async () => {
    const started = await call<{ recording: boolean; intervalMs: number }>("startDebugRecording", {
      targets: [{ kind: "app", id: "state" }],
      intervalMs: 5000,
    });
    expect(started).toMatchObject({ recording: true, intervalMs: 5000, targets: [{ kind: "app", id: "state" }] });

    const stopped = await call<{ recording: boolean; retainLast: number | null }>("stopDebugRecording", {});
    expect(stopped.recording).toBe(false);
    expect(stopped.retainLast).toBeNull();
  });

  it("stores retainLast immediately and reports it on the recording status", async () => {
    const updated = await call<{ retainLast: number | null; recording: boolean }>("setDebugRetention", { retainLast: 10 });
    expect(updated).toMatchObject({ retainLast: 10, recording: false });
    expect(app.getState(DebugState).retainLast).toBe(10);

    const cleared = await call<{ retainLast: number | null }>("setDebugRetention", { retainLast: null });
    expect(cleared.retainLast).toBeNull();
    expect(app.getState(DebugState).retainLast).toBeNull();
  });
});
