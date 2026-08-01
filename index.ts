import TokenRingApp from "./TokenRingApp.ts";

export { default as buildConfigUISchema } from "./config/buildConfigUISchema.ts";
export { default as ConfigurationService } from "./config/ConfigurationService.ts";
export type { ConfigFieldMeta } from "./config/metadata.ts";
export { type ConfigScope, configScopes } from "./config/scopes.ts";
export type { ConfigFieldSpec, ConfigUINode, ConfigUIPluginSchema } from "./config/uiSchema.ts";
export { type DebugSnapshotInfo, type DebugSnapshotSource, type DebugTarget, default as DebugService } from "./debug/DebugService.ts";
export { default as PluginManager } from "./PluginManager.ts";
export { AppConfigurationState, type ConfigLayer } from "./state/AppConfigurationState.ts";
export { DebugState, type DebugTargetRef } from "./state/DebugState.ts";
export type { TokenRingPlugin } from "./types.ts";

export default TokenRingApp;
