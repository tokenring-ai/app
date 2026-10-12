import { AsyncLocalStorage } from "node:async_hooks";
import type TokenRingApp from "./TokenRingApp.ts";

export type RegistrationKind = "services" | "tools" | "commands" | "rpcMethods";

export type PluginRegistrations = {
  services: string[];
  tools: string[];
  commands: string[];
  rpcMethods: string[];
};

type RegistrationFrame = {
  app: TokenRingApp;
  pluginName: string;
};

const registrationStorage = new AsyncLocalStorage<RegistrationFrame>();

/**
 * Plugin lifecycle hooks run inside one frame so registration sites can attribute
 * what they register. Hooks are sequential, not concurrent. `waitForService`
 * re-enters the frame it captured: the callback often runs while a later plugin
 * is the one currently installing.
 */
export function runAsPlugin<T>(app: TokenRingApp, pluginName: string, fn: () => T): T {
  return registrationStorage.run({ app, pluginName }, fn);
}

/** Re-enters the frame that was active when the callback was subscribed, if any. */
export function bindRegistration<Args extends unknown[]>(fn: (...args: Args) => void): (...args: Args) => void {
  const frame = registrationStorage.getStore();
  if (!frame) return fn;
  return (...args) => {
    runAsPlugin(frame.app, frame.pluginName, () => fn(...args));
  };
}

/** No-op outside a plugin lifecycle, so core services and test setup stay unowned. */
export function noteRegistration(kind: RegistrationKind, name: string): void {
  const frame = registrationStorage.getStore();
  if (!frame || !name) return;
  frame.app.recordRegistration(kind, name, frame.pluginName);
}
