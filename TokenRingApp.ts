import TypedRegistry from "@tokenring-ai/utility/registry/TypedRegistry";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import type {TokenRingService} from "./types.ts";
import {z} from "zod";


export type TokenRingAppConfig = Record<string, any>;

export default class TokenRingApp {
  private readonly config: TokenRingAppConfig;
  constructor(config: TokenRingAppConfig) {
    this.config = config;
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
  serviceOutput(...msgs: any[]): void {
    console.log(formatLogMessages(msgs));
  }

  serviceError(...msgs: any[]): void {
    console.error(formatLogMessages(msgs));
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
