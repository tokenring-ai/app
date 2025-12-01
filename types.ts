import Agent from "@tokenring-ai/agent/Agent";
import {ContextItem} from "@tokenring-ai/agent/types";
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

  start?(): Promise<void> | void;

  stop?(): Promise<void> | void;

  attach?(agent: Agent): Promise<void> | void;

  detach?(agent: Agent): Promise<void> | void;

  getContextItems?: never;
}