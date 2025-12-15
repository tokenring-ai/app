import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import type {TokenRingService} from "./types.ts";
import {z} from "zod";


export const TokenRingAppConfigSchema = z.record(z.string(), z.unknown());
export type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;

export type LogEntry = {
  timestamp: number;
  level: "info" | "error";
  message: string;
};

export default class TokenRingApp {
  readonly config: TokenRingAppConfig;
  readonly logs: LogEntry[] = [];
  private readonly abortController = new AbortController();


  constructor(readonly packageDirectory: string, config: Partial<TokenRingAppConfig>, defaultConfig: TokenRingAppConfig) {
    this.config = {...defaultConfig, ...config};
  }

  services = new TypedRegistry<TokenRingService>();

  requireService = this.services.requireItemByType;
  getService = this.services.getItemByType;
  getServices = this.services.getItems;
  addServices(...services: TokenRingService[]) {
    this.services.register(...services);
  }

  shutdown() {
    this.abortController.abort();
  }

  async run() {
    const signal = this.abortController.signal;
    await Promise.all([
      ...this.services.getItems().map(service => {
        const cancel = service.run?.(signal)
      }),
      new Promise(resolve => {
        signal.addEventListener('abort',resolve);
      })
    ]);
  }
  /*async startServices() {
    return Promise.all(this.services.getItems().map(service => service.start?.()));
  }*/

  waitForService = <R extends TokenRingService>(
    serviceType: abstract new (...args: any[]) => R,
    callback: (service: R) => void
  ): void => this.services.waitForItemByType(serviceType, callback);

  /**
   * Log a system message
   */
  serviceOutput(...messages: any[]): void {
    const message = formatLogMessages(messages);
    this.logs.push({ timestamp: Date.now(), level: "info", message });
  }

  serviceError(...messages: any[]): void {
    const message = formatLogMessages(messages);
    this.logs.push({ timestamp: Date.now(), level: "error", message });
  }

  /*
   * Track an app-level promise and log any errors that occur.
   */
  trackPromise(prom: Promise<void>) : void {
    prom.catch((err) => this.serviceError("[TokenRingApp] Error:", err));
  }

  scheduleEvery(interval: number, callback: () => Promise<void>) : () => void {
    let cancelled = false;

    let timer: NodeJS.Timeout | undefined = undefined;

    const run = async () =>  {
      if (cancelled) return;
      try {
        await callback();
      } catch (err) {
        this.serviceError("[TokenRingApp] Error:", err);
      } finally {
        if (! cancelled) timer = setTimeout(run, interval);
      }
    };

    this.trackPromise(run());

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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
