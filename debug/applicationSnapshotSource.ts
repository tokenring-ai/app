import type TokenRingApp from "../TokenRingApp.ts";
import type { DebugSnapshotSource, DebugTarget } from "./DebugService.ts";

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

/** Dumps the app state manager plus enough runtime context to make it readable. */
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
    state: app.stateManager.serialize(),
  };
}
