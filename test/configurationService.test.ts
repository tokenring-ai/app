import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YAML } from "bun";
import { z } from "zod";
import ConfigurationService from "../config/ConfigurationService.ts";
import PluginManager from "../PluginManager.ts";
import { TokenRingAppConfigSchema } from "../schema.ts";
import { AppConfigurationState } from "../state/AppConfigurationState.ts";
import TokenRingApp from "../TokenRingApp.ts";
import type { TokenRingPlugin } from "../types.ts";

const TestPluginSliceSchema = z
  .object({
    name: z.string().default("default-name"),
    size: z.number().min(1).default(10),
    apiKey: z.string().meta({ sensitive: true }).exactOptional(),
    nested: z.object({ flag: z.boolean().default(false) }).prefault({}),
    providers: z
      .record(
        z.string(),
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("secure"), token: z.string().meta({ sensitive: true }) }),
          z.object({ kind: z.literal("open"), url: z.string() }),
        ]),
      )
      .exactOptional(),
  })
  .exactOptional();

const OtherSliceSchema = z.object({ value: z.string() }).exactOptional();

const testPluginConfig = z.object({ testPlugin: TestPluginSliceSchema });
const otherPluginConfig = z.object({ other: OtherSliceSchema });

const composedSchema = z.object({
  ...TokenRingAppConfigSchema.shape,
  ...testPluginConfig.shape,
  ...otherPluginConfig.shape,
});

describe("ConfigurationService", () => {
  let tempDir: string;
  let globalConfigFile: string;
  let workspaceConfigFile: string;
  let app: TokenRingApp;
  let pluginManager: PluginManager;
  let service: ConfigurationService;
  let reconfigureSpy: ReturnType<typeof mock>;

  const baseConfig = () => ({
    app: {
      workingDirectory: "/tmp",
      workspaceDirectory: "/tmp",
      configDirectories: [],
      printLogs: false,
    },
    testPlugin: {
      name: "base-name",
      size: 5,
    },
  });

  async function setup(globalConfig: Record<string, unknown> = {}, overlayError?: string) {
    const parsed = composedSchema.parse(baseConfig());

    app = new TokenRingApp(parsed, { globalConfig });
    service = new ConfigurationService(app, {
      configSchema: composedSchema,
      overridesFiles: { global: globalConfigFile, workspace: workspaceConfigFile },
      overlayError,
    });
    app.addService(ConfigurationService, service);
    pluginManager = app.addService(PluginManager, new PluginManager(app));

    reconfigureSpy = mock(() => {});
    const reconfigurablePlugin = {
      name: "test-plugin",
      displayName: "Test Plugin",
      version: "1.0.0",
      description: "A reconfigurable test plugin",
      configSchema: testPluginConfig,
      reconfigure: reconfigureSpy,
    } satisfies TokenRingPlugin<typeof testPluginConfig>;
    const rigidPlugin = {
      name: "other-plugin",
      displayName: "Other Plugin",
      version: "1.0.0",
      description: "A plugin without reconfigure support",
      configSchema: otherPluginConfig,
    } satisfies TokenRingPlugin<typeof otherPluginConfig>;

    await pluginManager.installPlugins([reconfigurablePlugin, rigidPlugin]);
    // installPlugins hands the initial config to reconfigure; clear so apply assertions count only later calls.
    reconfigureSpy.mockClear();
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trconfig-"));
    globalConfigFile = path.join(tempDir, "nested", "config.yaml");
    workspaceConfigFile = path.join(tempDir, "workspace", "config.yaml");
    await setup();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const readOverridesFile = () => YAML.parse(fs.readFileSync(globalConfigFile, "utf8")) as Record<string, unknown> | null;

  describe("getUISchemas", () => {
    it("returns a schema per plugin with configurable content", () => {
      const uiSchemas = service.getUISchemas();
      expect(uiSchemas.map(uiSchema => uiSchema.pluginName).sort()).toEqual(["other-plugin", "test-plugin"]);
      expect(Object.keys(uiSchemas.find(uiSchema => uiSchema.pluginName === "test-plugin")!.slices)).toEqual(["testPlugin"]);
    });
  });

  describe("apply", () => {
    it("persists a sparse override file, updates live config, and reconfigures", async () => {
      const result = await service.apply("global", { testPlugin: { size: 7 } });
      expect(result).toEqual({ ok: true });

      expect(readOverridesFile()).toEqual({ testPlugin: { size: 7 } });
      expect(fs.readFileSync(globalConfigFile, "utf8")).toStartWith("# TokenRing user configuration overrides.");
      expect(fs.existsSync(`${globalConfigFile}.tmp`)).toBe(false);

      const fullConfig = app.getState(AppConfigurationState).mergedConfig;

      expect((fullConfig as any).testPlugin.size).toBe(7);
      expect(reconfigureSpy).toHaveBeenCalledTimes(1);
      expect((reconfigureSpy.mock.calls[0] as any)[1].testPlugin.size).toBe(7);
    });

    it("writes to the user layer only, leaving the layers around it alone", async () => {
      await service.apply("global", { testPlugin: { size: 7 } });

      const state = app.getState(AppConfigurationState);
      expect(state.globalConfig).toEqual({ testPlugin: { size: 7 } });
      expect((state.appConfig as any).testPlugin.size).toBe(5);
      expect(state.workspaceConfig).toEqual({});
    });

    it("rolls the user layer back when a plugin rejects the new config", async () => {
      reconfigureSpy.mockImplementationOnce(() => {
        throw new Error("plugin refused the config");
      });

      await expect(service.apply("global", { testPlugin: { size: 7 } })).rejects.toThrow("plugin refused the config");

      expect(fs.existsSync(globalConfigFile)).toBe(false);
      expect(service.getOverrides("global")).toEqual({});
      expect((app.getState(AppConfigurationState).mergedConfig as any).testPlugin.size).toBe(5);
    });

    it("prunes values equal to the effective base config", async () => {
      const result = await service.apply("global", { testPlugin: { size: 5, name: "base-name", nested: { flag: false } } });
      expect(result).toEqual({ ok: true });
      expect(readOverridesFile()).toBeNull();
      expect(service.getOverrides("global")).toEqual({});
    });

    it("keeps overrides that differ from base even when equal to the schema default", async () => {
      // base sets size 5; the schema default is 10 — an override of 10 is a real deviation
      await service.apply("global", { testPlugin: { size: 10 } });
      expect(readOverridesFile()).toEqual({ testPlugin: { size: 10 } });

      const fullConfig = app.getState(AppConfigurationState).mergedConfig;
      expect((fullConfig as any).testPlugin.size).toBe(10);
    });

    it("keeps an empty object override that enables an absent slice", async () => {
      await service.apply("global", { other: { value: "x" }, testPlugin: {} });
      expect(readOverridesFile()).toEqual({ other: { value: "x" } });
    });

    it("rejects invalid values with pathed issues and persists nothing", async () => {
      const result = await service.apply("global", { testPlugin: { size: 0 } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.issues[0]!.path).toEqual(["testPlugin", "size"]);

      expect(fs.existsSync(globalConfigFile)).toBe(false);

      const fullConfig = app.getState(AppConfigurationState).mergedConfig;
      expect((fullConfig as any).testPlugin.size).toBe(5);
      expect(reconfigureSpy).not.toHaveBeenCalled();
    });

    it("rejects unknown top-level keys", async () => {
      const result = await service.apply("global", { nonsense: { foo: 1 } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.issues[0]!.message).toContain("nonsense");
    });

    it("serializes concurrent applies", async () => {
      const [first, second] = await Promise.all([service.apply("global", { testPlugin: { size: 6 } }), service.apply("global", { testPlugin: { size: 7 } })]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(readOverridesFile()).toEqual({ testPlugin: { size: 7 } });
    });
  });

  describe("sensitive values", () => {
    it("redacts sensitive values on read but persists them in plaintext", async () => {
      await service.apply("global", { testPlugin: { apiKey: "secret123" } });

      const { effective, overrides } = service.getRedactedValues();
      expect((effective.testPlugin as any).apiKey).toEqual({ __sensitive: true, isSet: true });
      expect((overrides.global.testPlugin as any).apiKey).toEqual({ __sensitive: true, isSet: true });
      expect(JSON.stringify(effective)).not.toContain("secret123");

      expect((readOverridesFile() as any).testPlugin.apiKey).toBe("secret123");
    });

    it("preserves the stored secret when the client sends the keep sentinel", async () => {
      await service.apply("global", { testPlugin: { apiKey: "secret123" } });
      const result = await service.apply("global", { testPlugin: { apiKey: { __sensitive: "keep" }, size: 7 } });
      expect(result.ok).toBe(true);
      expect(readOverridesFile()).toEqual({ testPlugin: { apiKey: "secret123", size: 7 } });
    });

    it("redacts sensitive fields inside variant map entries", async () => {
      await service.apply("global", { testPlugin: { providers: { main: { kind: "secure", token: "tok-123" } } } });

      const { effective } = service.getRedactedValues();
      const main = (effective.testPlugin as any).providers.main;
      expect(main.kind).toBe("secure");
      expect(main.token).toEqual({ __sensitive: true, isSet: true });
      expect(JSON.stringify(effective)).not.toContain("tok-123");
    });

    it("drops the keep sentinel when no secret is stored", async () => {
      const result = await service.apply("global", { testPlugin: { apiKey: { __sensitive: "keep" }, size: 7 } });
      expect(result.ok).toBe(true);
      expect(readOverridesFile()).toEqual({ testPlugin: { size: 7 } });
    });
  });

  describe("scopes", () => {
    const readProjectOverridesFile = () => YAML.parse(fs.readFileSync(workspaceConfigFile, "utf8")) as Record<string, unknown> | null;

    it("persists each scope to its own file and layers project over user", async () => {
      await service.apply("global", { testPlugin: { size: 7, name: "from-user" } });
      await service.apply("workspace", { testPlugin: { size: 8 } });

      expect(readOverridesFile()).toEqual({ testPlugin: { size: 7, name: "from-user" } });
      expect(readProjectOverridesFile()).toEqual({ testPlugin: { size: 8 } });
      expect(fs.readFileSync(workspaceConfigFile, "utf8")).toStartWith("# TokenRing project configuration overrides.");

      const fullConfig = app.getState(AppConfigurationState).mergedConfig;
      expect((fullConfig as any).testPlugin).toMatchObject({ size: 8, name: "from-user" });
    });

    it("prunes a project value that the user layer already sets", async () => {
      await service.apply("global", { testPlugin: { size: 7 } });
      await service.apply("workspace", { testPlugin: { size: 7 } });

      expect(readProjectOverridesFile()).toBeNull();
      expect(service.getOverrides("workspace")).toEqual({});
      expect((app.getState(AppConfigurationState).mergedConfig as any).testPlugin.size).toBe(7);
    });

    it("reports the overrides of every scope separately", async () => {
      await service.apply("global", { testPlugin: { size: 7 } });
      await service.apply("workspace", { testPlugin: { name: "from-project" } });

      expect(service.getRedactedValues().overrides).toEqual({
        global: { testPlugin: { size: 7 } },
        workspace: { testPlugin: { name: "from-project" } },
      });
    });

    it("resets a path within one scope only", async () => {
      await service.apply("global", { testPlugin: { size: 7 } });
      await service.apply("workspace", { testPlugin: { name: "from-project" } });

      await service.resetPath("workspace", ["testPlugin", "name"]);

      expect(service.getOverrides("workspace")).toEqual({});
      expect(service.getOverrides("global")).toEqual({ testPlugin: { size: 7 } });
    });

    it("keeps sensitive sentinels per scope", async () => {
      await service.apply("global", { testPlugin: { apiKey: "user-secret" } });
      await service.apply("workspace", { testPlugin: { apiKey: "project-secret" } });

      // The keep sentinel resolves against the scope being written, not the other one.
      await service.apply("workspace", { testPlugin: { apiKey: { __sensitive: "keep" }, size: 7 } });

      expect(readProjectOverridesFile()).toEqual({ testPlugin: { apiKey: "project-secret", size: 7 } });
      expect(readOverridesFile()).toEqual({ testPlugin: { apiKey: "user-secret" } });
    });
  });

  describe("validateOverrides", () => {
    it("does not persist or reconfigure", () => {
      const result = service.validateOverrides("global", { testPlugin: { size: 7 } });
      expect(result.ok).toBe(true);
      expect(fs.existsSync(globalConfigFile)).toBe(false);
      expect(reconfigureSpy).not.toHaveBeenCalled();
    });
  });

  describe("resetPath", () => {
    it("removes a single override path and prunes empty parents", async () => {
      await service.apply("global", { testPlugin: { size: 7, name: "custom" } });
      await service.resetPath("global", ["testPlugin", "size"]);
      expect(readOverridesFile()).toEqual({ testPlugin: { name: "custom" } });

      const fullConfig = app.getState(AppConfigurationState).mergedConfig;
      expect((fullConfig as any).testPlugin.size).toBe(5);

      await service.resetPath("global", ["testPlugin", "name"]);
      expect(readOverridesFile()).toBeNull();
    });

    it("clears everything with an empty path", async () => {
      await service.apply("global", { testPlugin: { size: 7 } });
      await service.resetPath("global", []);
      expect(readOverridesFile()).toBeNull();
      expect(service.getOverrides("global")).toEqual({});
    });
  });

  describe("boot overlay error", () => {
    it("exposes the overlay error for the UI banner", async () => {
      await setup({}, "overrides were rejected");
      expect(service.overlayError).toBe("overrides were rejected");
    });
  });
});
