import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import type {TokenRingService} from "./types.ts";
import {z} from "zod";


export const TokenRingAppConfigSchema = z.record(z.string(), z.any());
export type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;

export default class TokenRingApp {
  private readonly config: TokenRingAppConfig;
  constructor(config: TokenRingAppConfig, defaultConfig: TokenRingAppConfig = {}) {
    this.config = {...defaultConfig, ...config};
  }

  services = new TypedRegistry<TokenRingService>();

  requireService = this.services.requireItemByType;
  getService = this.services.getItemByType;
  getServices = this.services.getItems;
  addServices(...services: TokenRingService[]) {
    this.services.register(...services);
    services.forEach(service => service.start?.());
  }

  waitForService = <R extends TokenRingService>(
    serviceType: abstract new (...args: any[]) => R,
    callback: (service: R) => Promise<void> | void
  ): void => {
    this.services.waitForItemByType(serviceType).then(callback).catch((err) => {
      console.error(err);
    });
  }

  /**
   * Log a system message
   */
  serviceOutput(...messages: any[]): void {
    console.log(formatLogMessages(messages));
  }

  serviceError(...messages: any[]): void {
    console.error(formatLogMessages(messages));
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
    while (!cancelled) {
      callback()
        .catch((err) => this.serviceError("[TokenRingApp] Error:", err))
        .then(() => timer = setTimeout(callback, interval));
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }

  /**
   * Get a config value by key and parse it using the provided schema
   */
  getConfigSlice<T extends { parse: (any: any) => any}>(key: string, schema: T): z.infer<T> {
    try {
      return schema.parse(this.config[key]) as z.infer<T>;
    } catch (error) {
      throw new Error(
        `Invalid config value for key "${key}": ${(error as Error).message}`,
      );
    }
  }

}
