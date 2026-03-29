import TokenRingApp from "@tokenring-ai/app";
import {createRPCEndpoint} from "@tokenring-ai/rpc/createRPCEndpoint";
import PluginManager from "../PluginManager.ts";
import AppRpcSchema from "./schema.ts";

export default createRPCEndpoint(AppRpcSchema, {
  async listPlugins(_args, app: TokenRingApp) {
    const pluginManager = app.requireService(PluginManager);
    return {
      plugins: pluginManager.getPlugins().map(p => ({
        name: p.name,
        version: p.version,
        description: p.description,
        hasConfig: 'config' in p,
      }))
    };
  },
});
