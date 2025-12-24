import Agent from "@tokenring-ai/agent/Agent";
import TokenRingApp from "./TokenRingApp.ts";

export interface TokenRingPlugin {
  name: string;
  version: string;
  description: string;
  install?: (app: TokenRingApp) => void; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp) => Promise<void> | void;
}

export interface TokenRingService {
  name: string; // Must match class name
  description: string;

  run?(signal: AbortSignal): Promise<void> | void;

  attach?(agent: Agent): Promise<void> | void;

  detach?(agent: Agent): Promise<void> | void;


  // Legacy methods - set to never type to cause tsc to flag the use of these methods
  install?: never;
  start?: never;
  stop?: never;
  getContextItems?: never;
}