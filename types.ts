import Agent from "@tokenring-ai/agent/Agent";
import {z} from "zod";
import TokenRingApp from "./TokenRingApp.ts";

export type TokenRingPlugin<ConfigType> = {
  readonly name: string;
  version: string;
  description: string;
  install?: (app: TokenRingApp) => void | undefined; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp) => Promise<void> | void;
} | {
  readonly name: string;
  version: string;
  description: string;
  config: ConfigType;
  install?: (app: TokenRingApp, config: z.output<ConfigType>) => void | undefined; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
  reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
};
export interface TokenRingService {
  readonly name: string;
  description: string;
  run?(signal: AbortSignal): Promise<void>;
  start?(signal: AbortSignal): Promise<void> | void;
  stop?(): Promise<void> | void;
  attach?(agent: Agent): void;
  detach?(agent: Agent): void;
}
