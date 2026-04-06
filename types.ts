import Agent from "@tokenring-ai/agent/Agent";
import type {AgentCreationContext} from "@tokenring-ai/agent/types";
import {z} from "zod";
import {SerializableStateSlice} from "./StateManager.ts";
import TokenRingApp from "./TokenRingApp.ts";

export type TokenRingPlugin<ConfigType> = {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  earlyInstall?: (app: TokenRingApp) => Promise<void> | void;
  install?: (app: TokenRingApp) => Promise<void|undefined> | void | undefined; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp) => Promise<void> | void;
} | {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly config: ConfigType;
  earlyInstall?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
  install?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void|undefined> | void | undefined; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
  reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
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

export abstract class AppStateSlice<SerializationSchema extends z.ZodTypeAny> extends SerializableStateSlice<SerializationSchema> {
}

export interface AppSessionCheckpoint {
  sessionId: string;
  createdAt: number;
  hostname: string;
  projectDirectory: string;
  state: Record<string, object>;
}
