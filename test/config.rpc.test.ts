import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import createLocalRPCClient from "@tokenring-ai/rpc/createLocalRPCClient";
import { YAML } from "bun";
import { z } from "zod";
import ConfigurationService from "../config/ConfigurationService.ts";
import PluginManager from "../PluginManager.ts";
import configRpc from "../rpc/config.ts";
import ConfigRpcSchema from "../rpc/configSchema.ts";
import { TokenRingAppConfigSchema } from "../schema.ts";
import TokenRingApp from "../TokenRingApp.ts";
import type { TokenRingPlugin } from "../types.ts";

const pluginConfig = z.object({
  widget: z
    .object({
      size: z.number().min(1).default(10),
      apiKey: z.string().meta({ sensitive: true }).exactOptional(),
    })
    .exactOptional(),
});

const composedSchema = z.object({
  ...TokenRingAppConfigSchema.shape,
  ...pluginConfig.shape,
});

describe("Config RPC", () => {
  let tempDir: string;
  let overridesFile: string;
  let app: TokenRingApp;
  let client: ReturnType<typeof createLocalRPCClient<typeof ConfigRpcSchema>>;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trconfigrpc-"));
    overridesFile = path.join(tempDir, "config.yaml");

    const base = {
      app: { dataDirectory: "/tmp", configDirectories: [], printLogs: false },
      widget: { size: 5 },
    };
    app = new TokenRingApp(composedSchema.parse(base));
    app.addServices(
      new ConfigurationService(app, {
        configSchema: composedSchema,
        baseConfig: base,
        overridesFile,
        overrides: {},
      }),
    );
    const pluginManager = new PluginManager(app);
    const plugin = {
      name: "widget-plugin",
      displayName: "Widget Plugin",
      version: "1.0.0",
      description: "Widget plugin",
      config: pluginConfig,
      reconfigure() {},
    } satisfies TokenRingPlugin<typeof pluginConfig>;
    await pluginManager.installPlugins([plugin]);

    client = createLocalRPCClient<typeof ConfigRpcSchema>(configRpc, app);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("getConfigSchema returns a payload valid against the wire schema", async () => {
    const result = await client.getConfigSchema({});
    expect(() => ConfigRpcSchema.methods.getConfigSchema.result.parse(result)).not.toThrow();
    expect(result.plugins.map(plugin => plugin.pluginName)).toEqual(["widget-plugin"]);
    expect(result.overridesFile).toBe(overridesFile);
    expect(result.overlayError).toBeNull();
    expect(result.restartRequired).toBe(false);
  });

  it("applyConfig persists and getConfigValues round-trips the override", async () => {
    const applied = await client.applyConfig({ overrides: { widget: { size: 7 } } });
    expect(applied).toEqual({ ok: true, restartRequired: false });

    const values = await client.getConfigValues({});
    expect((values.effective.widget as any).size).toBe(7);
    expect(values.overrides).toEqual({ widget: { size: 7 } });

    expect(YAML.parse(fs.readFileSync(overridesFile, "utf8"))).toEqual({ widget: { size: 7 } });
  });

  it("applyConfig returns pathed issues for invalid values", async () => {
    const applied = await client.applyConfig({ overrides: { widget: { size: 0 } } });
    expect(applied.ok).toBe(false);
    if (applied.ok) throw new Error("unreachable");
    expect(applied.issues[0]!.path).toEqual(["widget", "size"]);
    expect(fs.existsSync(overridesFile)).toBe(false);
  });

  it("masks sensitive values over the wire", async () => {
    await client.applyConfig({ overrides: { widget: { apiKey: "hunter22" } } });
    const values = await client.getConfigValues({});
    expect((values.effective.widget as any).apiKey).toEqual({ __sensitive: true, isSet: true });
    expect(JSON.stringify(values)).not.toContain("hunter22");
  });

  it("validateConfig reports validity without persisting", async () => {
    expect(await client.validateConfig({ overrides: { widget: { size: 3 } } })).toEqual({ ok: true });
    const invalid = await client.validateConfig({ overrides: { widget: { size: 0 } } });
    expect(invalid.ok).toBe(false);
    expect(fs.existsSync(overridesFile)).toBe(false);
  });

  it("resetConfig removes overrides", async () => {
    await client.applyConfig({ overrides: { widget: { size: 7 } } });
    const result = await client.resetConfig({ path: ["widget", "size"] });
    expect(result).toEqual({ ok: true, restartRequired: false });
    const values = await client.getConfigValues({});
    expect(values.overrides).toEqual({});
    expect((values.effective.widget as any).size).toBe(5);
  });
});
