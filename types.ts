import type Agent from "@tokenring-ai/agent/Agent";
import type { AgentCreationContext } from "@tokenring-ai/agent/types";
import type { MaybePromise } from "bun";
import type { ZodNever, ZodType, z } from "zod";
import { SerializableStateSlice } from "./StateManager.ts";
import type TokenRingApp from "./TokenRingApp.ts";

export type TokenRingPlugin<ConfigType extends ZodType = ZodNever, ImmutableConfigType extends ZodType = ZodNever> = {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly config?: Record<string, unknown>;
  readonly configSchema?: ConfigType;
  readonly immutableConfigSchema?: ImmutableConfigType;
  earlyInstall?: (app: TokenRingApp, config: ImmutableConfigType extends ZodNever ? undefined : z.output<ImmutableConfigType>) => MaybePromise<void>;
  /** Receives the same parsed immutable config as `earlyInstall`. */
  install?: (app: TokenRingApp, config: ImmutableConfigType extends ZodNever ? undefined : z.output<ImmutableConfigType>) => MaybePromise<void | undefined>;
  start?: (app: TokenRingApp) => MaybePromise<void>;
  /** Present when the plugin declares a `configSchema`. */
  reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => MaybePromise<void>;
};

export type TokenRingPluginOrBuilder = TokenRingPlugin<any, any> | ((app: TokenRingApp) => MaybePromise<TokenRingPlugin<any, any>>);

export interface TokenRingService {
  readonly name: string;
  readonly description: string;

  run?(signal: AbortSignal): MaybePromise<void>;

  start?(signal: AbortSignal): MaybePromise<void>;

  stop?(): MaybePromise<void>;

  /**
   * Stop after every other service has finished stopping. For stores that other services write to while they shut
   * down (a database holding the shutdown checkpoint, say): closing one first makes those last writes fail.
   */
  readonly stopsLast?: boolean;

  attach?(agent: Agent, creationContext: AgentCreationContext): void;

  detach?(agent: Agent): void;
}

export class ConfigurationError extends Error {
  constructor(
    public readonly serviceName: string,
    readonly message: string,
    readonly options?: ErrorOptions,
  ) {
    super(`[${serviceName}: ${message}]`, options);
  }
}

export class NotImplementedError extends Error {
  constructor(
    public readonly providerOrServiceName: string,
    readonly message: string,
    readonly options?: ErrorOptions,
  ) {
    super(`[${providerOrServiceName}: ${message}]`, options);
  }
}

export abstract class AppStateSlice<SerializationSchema extends z.ZodType> extends SerializableStateSlice<SerializationSchema> {}

// The configuration UI field spec lives in config/uiSchema.ts; this alias is
// kept for compatibility with earlier code that imported it from types.ts.
export type { ConfigFieldSpec as AppConfigItem } from "./config/uiSchema.ts";
