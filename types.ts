import type Agent from "@tokenring-ai/agent/Agent";
import type { AgentCreationContext } from "@tokenring-ai/agent/types";
import type { MaybePromise } from "bun";
import type { z } from "zod";
import { SerializableStateSlice } from "./StateManager.ts";
import type TokenRingApp from "./TokenRingApp.ts";

export type TokenRingPlugin<ConfigType = void> = ConfigType extends void
  ? {
      readonly name: string;
      readonly displayName: string;
      readonly version: string;
      readonly description: string;
      earlyInstall?: (app: TokenRingApp) => MaybePromise<void>;
      install?: (app: TokenRingApp) => MaybePromise<void | undefined>;
      start?: (app: TokenRingApp) => MaybePromise<void>;
    }
  : {
      readonly name: string;
      readonly displayName: string;
      readonly version: string;
      readonly description: string;
      readonly config: ConfigType;
      earlyInstall?: (app: TokenRingApp, config: z.output<ConfigType>) => MaybePromise<void>;
      install?: (app: TokenRingApp, config: z.output<ConfigType>) => MaybePromise<void | undefined>;
      start?: (app: TokenRingApp, config: z.output<ConfigType>) => MaybePromise<void>;
      reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => MaybePromise<void>;
    };
export interface TokenRingService {
  readonly name: string;
  readonly description: string;

  run?(signal: AbortSignal): Promise<void>;

  start?(signal: AbortSignal): Promise<void> | void;

  stop?(): Promise<void> | void;

  attach?(agent: Agent, creationContext: AgentCreationContext): void;

  detach?(agent: Agent): void;
}

export abstract class AppStateSlice<SerializationSchema extends z.ZodTypeAny> extends SerializableStateSlice<SerializationSchema> {}

export interface AppSessionCheckpoint {
  sessionId: string;
  createdAt: number;
  hostname: string;
  projectDirectory: string;
  state: Record<string, object>;
}
