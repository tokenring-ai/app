import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import buildTokenRingAppConfig, { buildTokenRingAppConfigLayers } from "../buildTokenRingAppConfig.ts";
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
  let projectOverridesFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trlayers-"));
    configDir = path.join(tempDir, "configs");
    dataDir = path.join(tempDir, "data");
    overridesFile = path.join(tempDir, "global", "config.yaml");
    projectOverridesFile = path.join(tempDir, "project.config.yaml");
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const defaultConfig = () => ({
    app: {
      workingDirectory: dataDir,
      workspaceDirectory: dataDir,
      configDirectories: [configDir],
      printLogs: false,
    },
  });

  it("separates the app layer from the sparse user and project layers", async () => {
    fs.writeFileSync(path.join(configDir, "site.yaml"), "feature:\n  x: 2\n  y: fromDir\n");
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature:\n  y: fromUser\n");
    fs.writeFileSync(projectOverridesFile, "feature:\n  x: 3\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), {
      globalConfigFile: overridesFile,
      workspaceConfigFile: projectOverridesFile,
    });

    expect(layers.appConfig.feature).toEqual({ x: 2, y: "fromDir" });
    expect(layers.globalConfig).toEqual({ feature: { y: "fromUser" } });
    expect(layers.workspaceConfig).toEqual({ feature: { x: 3 } });
    expect(layers.overlayError).toBeUndefined();
  });

  it("merges every layer in the default export, project winning over user", async () => {
    fs.writeFileSync(path.join(configDir, "site.yaml"), "feature:\n  x: 2\n  y: fromDir\n");
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature:\n  x: 5\n  y: fromUser\n");
    fs.writeFileSync(projectOverridesFile, "feature:\n  x: 3\n");

    const config = await buildTokenRingAppConfig(composedSchema, defaultConfig(), {
      globalConfigFile: overridesFile,
      workspaceConfigFile: projectOverridesFile,
    });

    expect(config.feature).toEqual({ x: 3, y: "fromUser" });
  });

  it("is a no-op when the overrides file is missing", async () => {
    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { globalConfigFile: overridesFile });
    expect(layers.appConfig.feature).toEqual({ x: 1, y: "default" });
    expect(layers.globalConfig).toEqual({});
    expect(layers.workspaceConfig).toEqual({});
    expect(layers.overlayError).toBeUndefined();
  });

  it("falls back and reports overlayError on malformed YAML", async () => {
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature: [unclosed\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { globalConfigFile: overridesFile });
    expect(layers.appConfig.feature).toEqual({ x: 1, y: "default" });
    expect(layers.globalConfig).toEqual({});
    expect(layers.overlayError).toContain(overridesFile);
  });

  it("falls back and reports overlayError on schema-invalid overrides", async () => {
    fs.writeFileSync(path.join(configDir, "site.yaml"), "feature:\n  x: 2\n");
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature:\n  x: notanumber\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { globalConfigFile: overridesFile });
    expect(layers.appConfig.feature.x).toBe(2);
    expect(layers.globalConfig).toEqual({});
    expect(layers.overlayError).toContain(overridesFile);
  });

  it("rejects a non-mapping overrides file", async () => {
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "- a\n- b\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), { globalConfigFile: overridesFile });
    expect(layers.globalConfig).toEqual({});
    expect(layers.overlayError).toContain("mapping");
  });

  it("keeps the user layer when only the project layer is rejected", async () => {
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, "feature:\n  y: fromUser\n");
    fs.writeFileSync(projectOverridesFile, "feature:\n  x: notanumber\n");

    const layers = await buildTokenRingAppConfigLayers(composedSchema, defaultConfig(), {
      globalConfigFile: overridesFile,
      workspaceConfigFile: projectOverridesFile,
    });

    expect(layers.globalConfig).toEqual({ feature: { y: "fromUser" } });
    expect(layers.workspaceConfig).toEqual({});
    expect(layers.overlayError).toContain(projectOverridesFile);
  });
});
