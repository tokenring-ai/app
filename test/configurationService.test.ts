import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YAML } from "bun";
import { z } from "zod";
import ConfigurationService from "../config/ConfigurationService.ts";
import PluginManager from "../PluginManager.ts";
import { TokenRingAppConfigSchema } from "../schema.ts";
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
  let overridesFile: string;
  let app: TokenRingApp;
  let pluginManager: PluginManager;
  let service: ConfigurationService;
  let reconfigureSpy: ReturnType<typeof mock>;

  const baseConfig = () => ({
    app: {
      dataDirectory: "/tmp",
      configDirectories: [],
      printLogs: false,
    },
    testPlugin: {
      name: "base-name",
      size: 5,
    },
  });

  async function setup(overrides: Record<string, unknown> = {}, overlayError?: string) {
    const base = baseConfig();
    const parsed = composedSchema.parse(base);

    app = new TokenRingApp(parsed);
    service = new ConfigurationService(app, {
      configSchema: composedSchema,
      baseConfig: base,
      overridesFile,
      overrides,
      overlayError,
    });
    app.addServices(service);
    pluginManager = new PluginManager(app);

    reconfigureSpy = mock(() => {});
    const reconfigurablePlugin = {
      name: "test-plugin",
      displayName: "Test Plugin",
      version: "1.0.0",
      description: "A reconfigurable test plugin",
      config: testPluginConfig,
      reconfigure: reconfigureSpy,
    } satisfies TokenRingPlugin<typeof testPluginConfig>;
    const rigidPlugin = {
      name: "other-plugin",
      displayName: "Other Plugin",
      version: "1.0.0",
      description: "A plugin without reconfigure support",
      config: otherPluginConfig,
    } satisfies TokenRingPlugin<typeof otherPluginConfig>;

    await pluginManager.installPlugins([reconfigurablePlugin, rigidPlugin]);
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trconfig-"));
    overridesFile = path.join(tempDir, "nested", "config.yaml");
    await setup();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const readOverridesFile = () => YAML.parse(fs.readFileSync(overridesFile, "utf8")) as Record<string, unknown> | null;

  describe("getUISchemas", () => {
    it("returns a schema per plugin with configurable content", () => {
      const uiSchemas = service.getUISchemas();
      expect(uiSchemas.map(uiSchema => uiSchema.pluginName).sort()).toEqual(["other-plugin", "test-plugin"]);
      expect(Object.keys(uiSchemas.find(uiSchema => uiSchema.pluginName === "test-plugin")!.slices)).toEqual(["testPlugin"]);
    });
  });

  describe("apply", () => {
    it("persists a sparse override file, updates live config, and reconfigures", async () => {
      const result = await service.apply({ testPlugin: { size: 7 } });
      expect(result).toEqual({ ok: true, restartRequired: false });

      expect(readOverridesFile()).toEqual({ testPlugin: { size: 7 } });
      expect(fs.readFileSync(overridesFile, "utf8")).toStartWith("# TokenRing user configuration overrides.");
      expect(fs.existsSync(`${overridesFile}.tmp`)).toBe(false);

      expect((app.config as any).testPlugin.size).toBe(7);
      expect(reconfigureSpy).toHaveBeenCalledTimes(1);
      expect((reconfigureSpy.mock.calls[0] as any)[1].testPlugin.size).toBe(7);
    });

    it("prunes values equal to the effective base config", async () => {
      const result = await service.apply({ testPlugin: { size: 5, name: "base-name", nested: { flag: false } } });
      expect(result).toEqual({ ok: true, restartRequired: false });
      expect(readOverridesFile()).toBeNull();
      expect(service.getOverrides()).toEqual({});
    });

    it("keeps overrides that differ from base even when equal to the schema default", async () => {
      // base sets size 5; the schema default is 10 — an override of 10 is a real deviation
      await service.apply({ testPlugin: { size: 10 } });
      expect(readOverridesFile()).toEqual({ testPlugin: { size: 10 } });
      expect((app.config as any).testPlugin.size).toBe(10);
    });

    it("keeps an empty object override that enables an absent slice", async () => {
      await service.apply({ other: { value: "x" }, testPlugin: {} });
      expect(readOverridesFile()).toEqual({ other: { value: "x" } });
    });

    it("rejects invalid values with pathed issues and persists nothing", async () => {
      const result = await service.apply({ testPlugin: { size: 0 } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.issues[0]!.path).toEqual(["testPlugin", "size"]);

      expect(fs.existsSync(overridesFile)).toBe(false);
      expect((app.config as any).testPlugin.size).toBe(5);
      expect(reconfigureSpy).not.toHaveBeenCalled();
    });

    it("rejects unknown top-level keys", async () => {
      const result = await service.apply({ nonsense: { foo: 1 } });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.issues[0]!.message).toContain("nonsense");
    });

    it("flags restartRequired when a changed plugin lacks reconfigure, and keeps it sticky", async () => {
      const first = await service.apply({ other: { value: "x" } });
      expect(first).toEqual({ ok: true, restartRequired: true });
      expect(service.restartRequired).toBe(true);

      const second = await service.apply({ other: { value: "x" }, testPlugin: { size: 6 } });
      expect(second).toEqual({ ok: true, restartRequired: true });
    });

    it("serializes concurrent applies", async () => {
      const [first, second] = await Promise.all([service.apply({ testPlugin: { size: 6 } }), service.apply({ testPlugin: { size: 7 } })]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(readOverridesFile()).toEqual({ testPlugin: { size: 7 } });
    });
  });

  describe("sensitive values", () => {
    it("redacts sensitive values on read but persists them in plaintext", async () => {
      await service.apply({ testPlugin: { apiKey: "secret123" } });

      const { effective, overrides } = service.getRedactedValues();
      expect((effective.testPlugin as any).apiKey).toEqual({ __sensitive: true, isSet: true });
      expect((overrides.testPlugin as any).apiKey).toEqual({ __sensitive: true, isSet: true });
      expect(JSON.stringify(effective)).not.toContain("secret123");

      expect((readOverridesFile() as any).testPlugin.apiKey).toBe("secret123");
    });

    it("preserves the stored secret when the client sends the keep sentinel", async () => {
      await service.apply({ testPlugin: { apiKey: "secret123" } });
      const result = await service.apply({ testPlugin: { apiKey: { __sensitive: "keep" }, size: 7 } });
      expect(result.ok).toBe(true);
      expect(readOverridesFile()).toEqual({ testPlugin: { apiKey: "secret123", size: 7 } });
    });

    it("redacts sensitive fields inside variant map entries", async () => {
      await service.apply({ testPlugin: { providers: { main: { kind: "secure", token: "tok-123" } } } });

      const { effective } = service.getRedactedValues();
      const main = (effective.testPlugin as any).providers.main;
      expect(main.kind).toBe("secure");
      expect(main.token).toEqual({ __sensitive: true, isSet: true });
      expect(JSON.stringify(effective)).not.toContain("tok-123");
    });

    it("drops the keep sentinel when no secret is stored", async () => {
      const result = await service.apply({ testPlugin: { apiKey: { __sensitive: "keep" }, size: 7 } });
      expect(result.ok).toBe(true);
      expect(readOverridesFile()).toEqual({ testPlugin: { size: 7 } });
    });
  });

  describe("validateOverrides", () => {
    it("does not persist or reconfigure", () => {
      const result = service.validateOverrides({ testPlugin: { size: 7 } });
      expect(result.ok).toBe(true);
      expect(fs.existsSync(overridesFile)).toBe(false);
      expect(reconfigureSpy).not.toHaveBeenCalled();
    });
  });

  describe("resetPath", () => {
    it("removes a single override path and prunes empty parents", async () => {
      await service.apply({ testPlugin: { size: 7, name: "custom" } });
      await service.resetPath(["testPlugin", "size"]);
      expect(readOverridesFile()).toEqual({ testPlugin: { name: "custom" } });
      expect((app.config as any).testPlugin.size).toBe(5);

      await service.resetPath(["testPlugin", "name"]);
      expect(readOverridesFile()).toBeNull();
    });

    it("clears everything with an empty path", async () => {
      await service.apply({ testPlugin: { size: 7 } });
      await service.resetPath([]);
      expect(readOverridesFile()).toBeNull();
      expect(service.getOverrides()).toEqual({});
    });
  });

  describe("boot overlay error", () => {
    it("exposes the overlay error for the UI banner", async () => {
      await setup({}, "overrides were rejected");
      expect(service.overlayError).toBe("overrides were rejected");
    });
  });
});
