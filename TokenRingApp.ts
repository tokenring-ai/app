import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import {setTimeout} from "timers/promises";
import {z} from "zod";
import type {TokenRingService} from "./types.ts";

export const TokenRingAppConfigSchema = z.record(z.string(), z.unknown());
export type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;

export type LogEntry = {
  timestamp: number;
  level: "info" | "error";
  message: string;
};

export default class TokenRingApp {
  readonly logs: LogEntry[] = [];
  private readonly abortController = new AbortController();

  constructor(readonly packageDirectory: string, readonly config: TokenRingAppConfig) {}

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
      ...this.services.getItems().map(service => service.run?.(signal)),
      new Promise(resolve => {
        signal.addEventListener('abort',resolve);
      })
    ]);
  }

  waitForService = <R extends TokenRingService>(
    serviceType: abstract new (...args: any[]) => R,
    callback: (service: R) => void
  ): void => this.services.waitForItemByType(serviceType, callback);

  /**
   * Log a system message
   */
  serviceOutput(...messages: any[]): void {
    const message = formatLogMessages(messages);
    this.logs.push({ timestamp: Date.now(), level: "info", message: message });
  }

  serviceError(...messages: any[]): void {
    const message = formatLogMessages(messages);
    this.logs.push({ timestamp: Date.now(), level: "error", message: message });
  }

  /*
   * Track an app-level promise and log any errors that occur.
   */
  trackPromise(initiator: (signal: AbortSignal) => Promise<void>) : void {
    initiator(this.abortController.signal)
      .catch((err) => this.serviceError("[TokenRingApp] Error:", err));
  }

  scheduleEvery(interval: number, callback: () => Promise<void>, signal?: AbortSignal) : void {
    this.trackPromise(async (appSignal) => {
      while (!signal?.aborted && !appSignal.aborted) {
        try {
          await callback();
        } catch (err) {
          this.serviceError("[TokenRingApp] Error:", err);
        }
        await setTimeout(interval);
      }
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

