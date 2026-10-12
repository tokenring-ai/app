import ConfigurationService from "../config/ConfigurationService.ts";
import type { ConfigUIPluginSchema } from "../config/uiSchema.ts";
import type TokenRingApp from "../TokenRingApp.ts";
import type { DebugSnapshotSource, DebugTarget } from "./DebugService.ts";
import { redactConfigLayer } from "./redactSnapshot.ts";

const APPLICATION_STATE_TARGET: DebugTarget = {
  kind: "app",
  id: "state",
  label: "Application State",
  description: "TokenRingApp state manager, services and configuration",
};

/**
 * Exposes the running app to the debugger as a regular snapshot source, so
 * application state can be captured the same way as any other target.
 */
export function createApplicationSnapshotSource(app: TokenRingApp): DebugSnapshotSource {
  return {
    kind: APPLICATION_STATE_TARGET.kind,
    displayName: APPLICATION_STATE_TARGET.label,

    listTargets(): DebugTarget[] {
      return [APPLICATION_STATE_TARGET];
    },

    captureTarget(id: string): unknown {
      return id === APPLICATION_STATE_TARGET.id ? captureApplicationState(app) : undefined;
    },
  };
}

/**
 * Dumps the app state manager plus enough runtime context to make it readable.
 * Config layers have the values their schema marks sensitive redacted;
 * DebugService additionally redacts credential-looking keys everywhere.
 */
function captureApplicationState(app: TokenRingApp): Record<string, unknown> {
  return {
    sessionId: app.sessionId,
    isShuttingDown: app.isShuttingDown,
    appConfig: app.appConfig,
    services: app.getServiceEntries().map(([_serviceName, service]) => ({
      name: service.name,
      description: service.description,
      running: app.runningServices.has(service),
      stopping: app.stoppingServices.has(service),
    })),
    backgroundTasks: Object.fromEntries(app.backgroundTasks),
    state: redactConfigurationState(app, app.stateManager.serialize()),
  };
}

/** Redacts the config layers held by the AppConfigurationState slice. */
function redactConfigurationState(app: TokenRingApp, state: Record<string, object>): Record<string, object> {
  const configState = state.AppConfigurationState as Record<string, unknown> | undefined;
  if (!configState) return state;

  let uiSchemas: ConfigUIPluginSchema[] = [];
  try {
    uiSchemas = app.getService(ConfigurationService)?.getUISchemas() ?? [];
  } catch {
    // No plugin manager yet; the key-name redaction in DebugService still applies.
  }
  const pluginConfigs = (configState.pluginConfigs ?? {}) as Record<string, unknown>;
  return {
    ...state,
    AppConfigurationState: {
      ...configState,
      pluginConfigs: Object.fromEntries(Object.entries(pluginConfigs).map(([name, layer]) => [name, redactConfigLayer(layer, uiSchemas)])),
      globalConfig: redactConfigLayer(configState.globalConfig, uiSchemas),
      workspaceConfig: redactConfigLayer(configState.workspaceConfig, uiSchemas),
    },
  };
}
