import { beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { TokenRingAppConfigSchema } from "../schema.ts";
import { AppConfigurationState } from "../state/AppConfigurationState.ts";
import TokenRingApp from "../TokenRingApp.ts";

const composedSchema = z.object({
  ...TokenRingAppConfigSchema.shape,
  feature: z.object({ x: z.number(), y: z.string(), z: z.string() }).partial(),
});

const appLayer = () =>
  composedSchema.parse({
    app: { workingDirectory: "/tmp", workspaceDirectory: "/tmp", configDirectories: [], printLogs: false },
    feature: { x: 1, y: "fromApp", z: "fromApp" },
  });

describe("AppConfigurationState", () => {
  let app: TokenRingApp;
  const state = () => app.getState(AppConfigurationState);

  beforeEach(() => {
    app = new TokenRingApp(appLayer(), {
      globalConfig: { feature: { y: "fromUser", z: "fromUser" } },
      workspaceConfig: { feature: { z: "fromProject" } },
    });
  });

  it("merges layers app < plugins < user < project", () => {
    AppConfigurationState.setPluginConfig(app, "feature-plugin", { feature: { x: 2, y: "fromPlugin" } });

    expect(state().mergedConfig).toEqual({
      ...appLayer(),
      feature: { x: 2, y: "fromUser", z: "fromProject" },
    });
  });

  it("keeps the merged config object identity across layer changes", () => {
    const merged = state().mergedConfig;
    AppConfigurationState.setUserConfig(app, { feature: { y: "changed" } });

    expect(state().mergedConfig).toBe(merged);
    expect((merged as any).feature.y).toBe("changed");
  });

  it("drops values that only came from a removed layer", () => {
    AppConfigurationState.setPluginConfig(app, "feature-plugin", { extra: { enabled: true } });
    expect((state().mergedConfig as any).extra).toEqual({ enabled: true });

    AppConfigurationState.removePluginConfig(app, "feature-plugin");
    expect((state().mergedConfig as any).extra).toBeUndefined();
  });

  it("never lets a layer mutate the app layer", () => {
    AppConfigurationState.setUserConfig(app, { feature: { y: "fromUser2" } });

    expect(state().appConfig).toEqual(appLayer());
  });

  it("exposes the layers below each scope", () => {
    AppConfigurationState.setPluginConfig(app, "feature-plugin", { feature: { x: 2 } });

    expect((state().getLayersBelow("global") as any).feature).toEqual({ x: 2, y: "fromApp", z: "fromApp" });
    // The project layer sits above the user layer, so the user layer is included.
    expect((state().getLayersBelow("workspace") as any).feature).toEqual({ x: 2, y: "fromUser", z: "fromUser" });
  });

  it("previews a candidate layer for either scope without applying it", () => {
    const userPreview = state().previewWithOverrideLayer("global", { feature: { y: "candidate" } });
    expect((userPreview as any).feature).toEqual({ x: 1, y: "candidate", z: "fromProject" });

    const projectPreview = state().previewWithOverrideLayer("workspace", { feature: { y: "candidate" } });
    expect((projectPreview as any).feature).toEqual({ x: 1, y: "candidate", z: "fromUser" });

    expect((state().mergedConfig as any).feature.y).toBe("fromUser");
  });

  it("reads and writes an override layer by scope", () => {
    AppConfigurationState.setOverrideLayer(app, "workspace", { feature: { z: "changed" } });

    expect(state().getOverrideLayer("workspace")).toEqual({ feature: { z: "changed" } });
    expect(state().getOverrideLayer("global")).toEqual({ feature: { y: "fromUser", z: "fromUser" } });
    expect((state().mergedConfig as any).feature.z).toBe("changed");
  });

  it("serializes the mutable layers only, and restores them", () => {
    AppConfigurationState.setPluginConfig(app, "feature-plugin", { feature: { x: 2 } });

    const checkpoint = app.generateStateCheckpoint();
    expect(checkpoint.AppConfigurationState).toEqual({
      pluginConfigs: { "feature-plugin": { feature: { x: 2 } } },
      globalConfig: { feature: { y: "fromUser", z: "fromUser" } },
      workspaceConfig: { feature: { z: "fromProject" } },
    });

    const restored = new TokenRingApp(appLayer());
    restored.restoreState(checkpoint);

    expect(restored.stateManager.getState(AppConfigurationState).mergedConfig).toEqual(state().mergedConfig);
  });
});
