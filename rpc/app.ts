import type TokenRingApp from "@tokenring-ai/app";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import PluginManager from "../PluginManager.ts";
import { AppLogsState } from "../state/AppLogsState.ts";
import AppRpcSchema from "./schema.ts";

export default createRPCEndpoint(AppRpcSchema, {
  listPlugins(_args, app: TokenRingApp) {
    const pluginManager = app.requireService(PluginManager);
    return {
      plugins: pluginManager.getPlugins().map(p => ({
        name: p.name,
        displayName: p.displayName,
        version: p.version,
        description: p.description,
        hasConfig: "config" in p,
      })),
    };
  },
  getLogs(_args, app: TokenRingApp) {
    return { logs: app.logs };
  },

  async *streamLogs(args, app: TokenRingApp, signal) {
    let position = args.fromPosition;

    for await (const state of app.stateManager.subscribeAsync(AppLogsState, signal)) {
      const logs = state.logs.slice(position);
      position = state.logs.length;
      yield { logs, position };
    }
  },
});
