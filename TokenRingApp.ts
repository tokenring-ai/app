import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import {generateHumanId} from "@tokenring-ai/utility/string/generateHumanId";
import process from "node:process";
import {setTimeout as setTimeoutPromise} from "timers/promises";
import {z} from "zod";
import StateManager from "./StateManager.ts";
import type {AppSessionCheckpoint, AppStateSlice, TokenRingService} from "./types.ts";

export const TokenRingAppConfigSchema = z.object({
  app: z.object({
    //projectDirectory: z.string(),
    dataDirectory: z.string(),
    configFileName: z.string(),
    configSchema: z.custom<z.ZodTypeAny>(),
    //packageDirectory: z.string(),
    //hostname: z.string(),
  })
});

export const LooseTokenRingAppConfigSchema = TokenRingAppConfigSchema.loose();
export type TokenRingAppConfig = z.output<typeof LooseTokenRingAppConfigSchema>;

export type LogEntry = {
  timestamp: number;
  level: "info" | "error";
  message: string;
};

export default class TokenRingApp {
  readonly logs: LogEntry[] = [];
  private readonly abortController = new AbortController();
  readonly sessionId = generateHumanId();
  readonly stateManager = new StateManager<AppStateSlice<any>>();
  readonly runningServices = new Set<TokenRingService>();
  readonly backgroundTasks = new Map<TokenRingService, number>();

  constructor(readonly config: TokenRingAppConfig) {}

  services = new TypedRegistry<TokenRingService>();

  requireService = this.services.requireItemByType;
  getService = this.services.getItemByType;
  getServices = this.services.getItems;
  addServices(...services: TokenRingService[]) {
    this.services.register(...services);
  }

  shutdown(reason: string = "App shutdown for unknown reason") {
    this.abortController.abort(reason);

    this.logs.push({ timestamp: Date.now(), level: "info", message: `[TokenRingApp] Shutting down: ${reason}` });

    let count = 0;
    setInterval(() => {
      count++;
      const analysis = new Map<TokenRingService, { backgroundTasks: number, running: boolean }>();
      for (const service of this.runningServices) {
        analysis.set(service, { backgroundTasks: 0, running: true });
      }
      for (const [service, count] of this.backgroundTasks.entries()) {
        if (count > 0) {
          const entry = analysis.get(service) ?? {backgroundTasks: 0, running: false};
          analysis.set(service, {backgroundTasks: count, running: entry.running});
        }
      }

      if (analysis.size === 0) {
        //process.stdout.write(`App shutdown complete\n`);
        process.exit(0);
      }

      if (count % 4 === 0) {
        process.stdout.write(`
App shutdown in progress: ${count * 0.5}s...
Services still running:
${Array.from(analysis.entries()).map(([service, {backgroundTasks, running}]) =>
          `- ${service.name}: Main thread ${running ? "running" : "complete"} ${backgroundTasks} background tasks running`
        ).join("\n")}
`.trimStart());
      }
    }, 500);

    /*
    //TODO: Figure out what is making the event loop hang.
    const hungServiceTimer = setTimeout(() => {
      if (this.runningServices.size === 0 && this.backgroundTasks.size === 0) {
        process.stdout.write(`[TokenRingApp] Has not shut down for 15s, and the task hanging the event loop was not registered with TokenRingApp\n`);
        return;
      }
      for (const service of this.runningServices.values()) {
        process.stdout.write(`[${service.name}] Has not shut down for 15s...\n`);
      }

      for (const [service, count] of this.backgroundTasks.entries()) {
        process.stdout.write(`[${service.name}] Has ${count} background tasks running, which are preventing the shutdown from completing...\n`);
      }
    }, 15000);
    hungServiceTimer.unref();*/
  }

  generateStateCheckpoint() {
    return this.stateManager.serialize()
  }

  restoreState(state: AppSessionCheckpoint["state"]) {
    this.stateManager.deserialize(state, (key) => {
      const message = `[TokenRingApp] Error while restoring state: State slice ${key} not found in app checkpoint`;
      this.logs.push({ timestamp: Date.now(), level: "info", message: message });
    });
  }


  async run() {
    const signal = this.abortController.signal;
    await Promise.all([
      ...this.services.getItems().map(async (service) => {
        if (service.start) {
          await service.start(signal);
        }
      })
    ])

    await Promise.all([
      ...this.services.getItems().map(async (service) => {
        if (!service.run) return;
        this.runningServices.add(service);

        while (!signal.aborted) {
          try {
            await service.run(signal);
            // If run() completes without error but we aren't aborted, it exited "normally"
            if (!signal.aborted) {
              this.serviceError(service,`Exited unexpectedly. Restarting in 5s...`);
            }
          } catch (err) {
            if (!signal.aborted) {
              this.serviceError(service,`Died with error:`, err, "Restarting in 5s...");
            }
          }

          if (signal.aborted) break;
          await setTimeoutPromise(5000, null, {signal}).catch(err => null);
        }
        this.runningServices.delete(service);
      }),
    ]);

    await Promise.all([
      ...this.services.getItems().map(async (service) => {
        if (service.stop) {
          this.runningServices.add(service);
          await service.stop();
          this.runningServices.delete(service);
        }
      })
    ])
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
    this.logs.push({ timestamp: Date.now(), level: "info", message: message });
  }

  serviceError(service: TokenRingService, ...messages: any[]): void {
    const message = `[${service.name}] ${formatLogMessages(messages)}`;
    this.logs.push({ timestamp: Date.now(), level: "error", message: message });
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
