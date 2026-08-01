import type TokenRingApp from "@tokenring-ai/app";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import DebugService from "../debug/DebugService.ts";
import PluginManager from "../PluginManager.ts";
import { AppLogsState } from "../state/AppLogsState.ts";
import { DebugState } from "../state/DebugState.ts";
import AppRpcSchema, { type DebugRecordingStatus } from "./schema.ts";

function projectRecordingStatus(app: TokenRingApp): DebugRecordingStatus {
  const state = app.getState(DebugState);
  return {
    recording: state.recording,
    intervalMs: state.intervalMs,
    targets: state.targets,
    startedAt: state.startedAt,
    lastCaptureAt: state.lastCaptureAt,
    captureCount: state.captureCount,
    lastSnapshot: state.lastSnapshot,
    lastError: state.lastError,
  };
}

export default createRPCEndpoint(AppRpcSchema, {
  listPlugins(_args, app: TokenRingApp) {
    const pluginManager = app.requireService(PluginManager);
    return {
      plugins: pluginManager.getPlugins().map(p => ({
        name: p.name,
        displayName: p.displayName,
        version: p.version,
        description: p.description,
        hasConfig: "configSchema" in p,
      })),
    };
  },
  getLogs(_args, app: TokenRingApp) {
    return { logs: app.logs };
  },

  async *streamLogs(args, app: TokenRingApp, signal) {
    let position = args.fromPosition;

    for await (const state of app.subscribeStateAsync(AppLogsState, signal)) {
      const logs = state.logs.slice(position);
      position = state.logs.length;
      yield { logs, position };
    }
  },

  listDebugTargets(_args, app: TokenRingApp) {
    return { targets: app.requireService(DebugService).listTargets() };
  },

  async captureDebugSnapshot(args, app: TokenRingApp) {
    const name = await app.requireService(DebugService).capture(args);
    return name ? { status: "success" as const, name } : { status: "targetNotFound" as const };
  },

  async listDebugSnapshots(_args, app: TokenRingApp) {
    return { snapshots: await app.requireService(DebugService).listSnapshots() };
  },

  async readDebugSnapshot(args, app: TokenRingApp) {
    const content = await app.requireService(DebugService).readSnapshot(args.name);
    return content === null ? { status: "notFound" as const } : { status: "success" as const, name: args.name, content };
  },

  async deleteDebugSnapshot(args, app: TokenRingApp) {
    const deleted = await app.requireService(DebugService).deleteSnapshot(args.name);
    return deleted ? { status: "success" as const } : { status: "notFound" as const };
  },

  startDebugRecording(args, app: TokenRingApp) {
    app.requireService(DebugService).startRecording(args.targets, args.intervalMs);
    return projectRecordingStatus(app);
  },

  stopDebugRecording(_args, app: TokenRingApp) {
    app.requireService(DebugService).stopRecording();
    return projectRecordingStatus(app);
  },

  async *streamDebugRecording(_args, app: TokenRingApp, signal) {
    for await (const _state of app.subscribeStateAsync(DebugState, signal)) {
      yield projectRecordingStatus(app);
    }
  },
});
