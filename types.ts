import Agent from "@tokenring-ai/agent/Agent";
import {z} from "zod";
import TokenRingApp from "./TokenRingApp.ts";

export type TokenRingPlugin<ConfigType> = {
  name: string;
  version: string;
  description: string;
  install?: (app: TokenRingApp) => void; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp) => Promise<void> | void;
} | {
  name: string;
  version: string;
  description: string;
  config: ConfigType;
  install?: (app: TokenRingApp, config: z.output<ConfigType>) => void; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
  reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
};
export interface TokenRingService {
  name: string; // Must match class name
  description: string;

  run?(signal: AbortSignal): Promise<void> | void;

  attach?(agent: Agent): void;

  detach?(agent: Agent): void;

  // Legacy methods - set to never type to cause tsc to flag the use of these methods
  install?: never;
  start?: never;
  stop?: never;
  getContextItems?: never;
}
