import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import {generateHumanId} from "@tokenring-ai/utility/string/generateHumanId";
import process from "node:process";
import {setTimeout as delay} from "timers/promises";
import {z} from "zod";
import type {TokenRingAppConfig} from "./schema.ts";
import {AppLogsState} from "./state/AppLogsState.ts";
import StateManager from "./StateManager.ts";
import type {AppSessionCheckpoint, AppStateSlice, TokenRingService} from "./types.ts";

export type LogEntry = {
  timestamp: number;
  level: "info" | "error";
  message: string;
};

export default class TokenRingApp {
  private readonly abortController = new AbortController();
  private shutdownStartedAt?: number;
  readonly sessionId = generateHumanId();
  readonly stateManager = new StateManager<AppStateSlice<any>>();
  readonly runningServices = new Set<TokenRingService>();
  readonly stoppingServices = new Set<TokenRingService>();
  readonly backgroundTasks = new Map<TokenRingService, number>();

  constructor(readonly config: TokenRingAppConfig) {
    // Initialize the logs state slice
    this.stateManager.initializeState(AppLogsState, {});
  }

  services = new TypedRegistry<TokenRingService>();

  requireService = this.services.requireItemByType;
  getService = this.services.getItemByType;
  getServices = this.services.getItems;
  addServices(...services: TokenRingService[]) {
    this.services.register(...services);
  }

  /**
   * Get the logs array
   */
  get logs(): LogEntry[] {
    return this.stateManager.getState(AppLogsState).getLogs();
  }

  private log(level: "info" | "error", message: string) {
    this.stateManager.mutateState(AppLogsState, state => {
      state.addLog(level, message);
    });
  }

  get isShuttingDown(): boolean {
    return this.abortController.signal.aborted;
  }

  /**
   * Initiates a graceful shutdown. Safe to call multiple times.
   */
  shutdown(reason: string = "App shutdown for unknown reason") {
    if (!this.abortController.signal.aborted) {
      this.shutdownStartedAt = Date.now();
      this.abortController.abort(reason);
      this.log("info", `[TokenRingApp] Shutting down: ${reason}`);
    }
  }

  /**
   * Returns a formatted status string describing what is still
   * preventing shutdown from completing, or `undefined` if idle.
   */
  private describeBlockingWork(): string | undefined {
    const lines: string[] = [];

    for (const service of this.runningServices) {
      lines.push(`  - ${service.name}: main loop still running`);
    }
    for (const service of this.stoppingServices) {
      lines.push(`  - ${service.name}: stop handler still running`);
    }
    for (const [service, count] of this.backgroundTasks) {
      if (count > 0) {
        lines.push(`  - ${service.name}: ${count} background task(s) pending`);
      }
    }

    if (lines.length === 0) return undefined;

    const elapsed = this.shutdownStartedAt
      ? ((Date.now() - this.shutdownStartedAt) / 1000).toFixed(1)
      : "?";

    return `App shutdown in progress (${elapsed}s):\n${lines.join("\n")}\n`;
  }

  /**
   * Periodically logs shutdown progress until the returned
   * cleanup function is called.
   */
  private startShutdownMonitor(): () => void {
    const timer = setInterval(() => {
      const status = this.describeBlockingWork();
      if (status) {
        process.stdout.write(status);
      }
    }, this.config.app.shutdownMonitorIntervalMs);
    timer.unref?.();

    return () => clearInterval(timer);
  }

  generateStateCheckpoint() {
    return this.stateManager.serialize();
  }

  restoreState(state: AppSessionCheckpoint["state"]) {
    this.stateManager.deserialize(state, (key) => {
      this.log("info", `[TokenRingApp] Error while restoring state: State slice ${key} not found in app checkpoint`);
    });
  }


  async run() {
    const signal = this.abortController.signal;
    let runError: unknown;
    try {
      for (const service of this.services.getItems()) {
        if (service.start) {
          await service.start(signal);
        }
      }

      await Promise.all(
        this.services.getItems().map(async (service) => {
          if (!service.run) return;
          this.runningServices.add(service);

          try {
            while (!signal.aborted) {
              try {
                await service.run(signal);
                // If run() completes without error but we aren't aborted, it exited "normally"
                if (!signal.aborted) {
                  this.serviceError(service, `Exited unexpectedly. Restarting in ${this.config.app.serviceRestartDelayMs / 1000}s...`);
                }
              } catch (err) {
                if (!signal.aborted) {
                  this.serviceError(service, `Died with error:`, err, `Restarting in ${this.config.app.serviceRestartDelayMs / 1000}s...`);
                }
              }

              if (signal.aborted) break;
              await delay(this.config.app.serviceRestartDelayMs, null, {signal}).catch(() => null);
            }
          } finally {
            this.runningServices.delete(service);
          }
        }),
      );
    } catch (err) {
      runError = err;
      this.shutdown(err instanceof Error ? err.message : "App run failed");
    } finally {
      this.shutdown(signal.reason && typeof signal.reason === "string" ? signal.reason : "App shutdown");

      const stopShutdownMonitor = this.startShutdownMonitor();
      try {
        const stopResults = await Promise.allSettled(
          this.services.getItems().map(async (service) => {
            if (!service.stop) return;

            this.stoppingServices.add(service);
            try {
              await service.stop();
            } finally {
              this.stoppingServices.delete(service);
            }
          })
        );

        const stopErrors = stopResults
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map(result => result.reason);

        if (runError) {
          throw runError;
        }
        if (stopErrors.length === 1) {
          throw stopErrors[0];
        }
        if (stopErrors.length > 1) {
          throw new AggregateError(stopErrors, "Multiple services failed to stop cleanly");
        }
      } finally {
        stopShutdownMonitor();
      }
    }
  }

  waitForService = <R extends TokenRingService>(
    serviceType: abstract new (...args: any[]) => R,
    callback: (service: R) => void
  ): void => this.services.waitForItemByType(serviceType, callback);

  /**
   * Log a system message
   */
  serviceOutput(service: TokenRingService, ...messages: any[]): void {
    const message = `[${service.name}] ${formatLogMessages(messages)}`;
    this.log("info", message);
  }

  serviceError(service: TokenRingService, ...messages: any[]): void {
    const message = `[${service.name}] ${formatLogMessages(messages)}`;
    this.log("error", message);
  }

  /*
   * Track an app-level promise and log any errors that occur.
   */
  runBackgroundTask(service: TokenRingService, initiator: (signal: AbortSignal) => Promise<void>) : void {
    const count = this.backgroundTasks.get(service) || 0;
    this.backgroundTasks.set(service, count + 1);
    initiator(this.abortController.signal)
      .catch((err) => this.serviceError(service,"Error:", err))
      .finally(() => {
        const count = this.backgroundTasks.get(service) || 0;
        this.backgroundTasks.set(service, count - 1);
      });
  }

  /**
   * Get a config value by key and parse it using the provided schema
   */
  getConfigSlice<T extends { parse: (any: any) => any}>(key: string, schema: T): z.output<T> {
    try {
      return schema.parse(this.config[key]) as z.output<T>;
    } catch (error) {
      throw new Error(
        `Invalid config value for key "${key}": ${(error as Error).message}`,
      );
    }
  }

}
