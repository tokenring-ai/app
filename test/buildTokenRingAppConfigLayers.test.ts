import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { buildTokenRingAppConfigLayers } from "../buildTokenRingAppConfig.ts";
import { TokenRingAppConfigSchema } from "../schema.ts";

const composedSchema = z.object({
  ...TokenRingAppConfigSchema.shape,
  feature: z
    .object({
      x: z.number().default(1),
      y: z.string().default("default"),
    })
    .prefault({}),
});

describe("buildTokenRingAppConfigLayers", () => {
  let tempDir: string;
  let configDir: string;
  let dataDir: string;
  let overridesFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trlayers-"));
    configDir = path.join(tempDir, "configs");
    dataDir = path.join(tempDir, "data");
    overridesFile = path.join(tempDir, "user", "config.yaml");
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const defaultConfig = () => ({
    app: {
      dataDirectory: dataDir,
      configDirectories: [configDir],
      printLogs: false,
    },
  });

  it("applies layers in order: defaults, config directories, user overrides", async () => {
    fs.writeFileSync(path.join(configDir, "site.yaml"), "feature:\n  x: 2\n  y: fromDir\n");
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature:\n  y: fromUser\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { userOverridesFile: overridesFile });

    expect(layers.config.feature).toEqual({ x: 2, y: "fromUser" });
    expect((layers.baseConfig as any).feature).toEqual({ x: 2, y: "fromDir" });
    expect(layers.overrides).toEqual({ feature: { y: "fromUser" } });
    expect(layers.overlayError).toBeUndefined();
  });

  it("is a no-op when the overrides file is missing", async () => {
    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { userOverridesFile: overridesFile });
    expect(layers.config.feature).toEqual({ x: 1, y: "default" });
    expect(layers.overrides).toEqual({});
    expect(layers.overlayError).toBeUndefined();
  });

  it("falls back and reports overlayError on malformed YAML", async () => {
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature: [unclosed\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { userOverridesFile: overridesFile });
    expect(layers.config.feature).toEqual({ x: 1, y: "default" });
    expect(layers.overrides).toEqual({});
    expect(layers.overlayError).toContain(overridesFile);
  });

  it("falls back and reports overlayError on schema-invalid overrides", async () => {
    fs.writeFileSync(path.join(configDir, "site.yaml"), "feature:\n  x: 2\n");
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature:\n  x: notanumber\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { userOverridesFile: overridesFile });
    expect(layers.config.feature.x).toBe(2);
    expect(layers.overrides).toEqual({});
    expect(layers.overlayError).toContain(overridesFile);
  });

  it("rejects a non-mapping overrides file", async () => {
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "- a\n- b\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { userOverridesFile: overridesFile });
    expect(layers.overrides).toEqual({});
    expect(layers.overlayError).toContain("mapping");
  });
});
