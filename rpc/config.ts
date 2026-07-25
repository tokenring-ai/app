import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import ConfigurationService from "../config/ConfigurationService.ts";
import type TokenRingApp from "../TokenRingApp.ts";
import ConfigRpcSchema from "./configSchema.ts";

export default createRPCEndpoint(ConfigRpcSchema, {
  getConfigSchema(_args, app: TokenRingApp) {
    const configurationService = app.requireService(ConfigurationService);
    return {
      plugins: configurationService.getUISchemas(),
      overridesFiles: configurationService.overridesFiles,
      overlayError: configurationService.overlayError ?? null,
    };
  },
  getConfigValues(_args, app: TokenRingApp) {
    return app.requireService(ConfigurationService).getRedactedValues();
  },
  validateConfig({ scope, overrides }, app: TokenRingApp) {
    const result = app.requireService(ConfigurationService).validateOverrides(scope, overrides);
    return result.ok ? { ok: true } : { ok: false, issues: result.issues };
  },
  async applyConfig({ scope, overrides }, app: TokenRingApp) {
    return await app.requireService(ConfigurationService).apply(scope, overrides);
  },
  async resetConfig({ scope, path }, app: TokenRingApp) {
    return await app.requireService(ConfigurationService).resetPath(scope, path);
  },
});
