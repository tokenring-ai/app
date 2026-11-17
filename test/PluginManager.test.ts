import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { z } from "zod";
import PluginManager from "../PluginManager";
import { AppConfigurationState } from "../state/AppConfigurationState.ts";
import TokenRingApp from "../TokenRingApp";
import type { TokenRingPlugin } from "../types.ts";
import createTestingApp from "./createTestingApp.test";

describe("PluginManager", () => {
  let mockApp: TokenRingApp;
  let pluginManager: PluginManager;

  beforeEach(() => {
    mock.clearAllMocks();

    // Create a real app instance for proper testing
    mockApp = createTestingApp();
    pluginManager = mockApp.addService(PluginManager, new PluginManager(mockApp));
  });

  afterEach(() => {
    mock.clearAllMocks();
  });

  describe("Constructor", () => {
    it("should initialize with correct name and description", () => {
      expect(pluginManager.name).toBe("PluginManager");
      expect(pluginManager.description).toBe("Manages plugins");
    });

    it("should register as a service when added to the app", () => {
      expect(mockApp.getService(PluginManager)).toBe(pluginManager);
    });

    it("should initialize plugins registry", () => {
      expect(pluginManager.getPlugins).toBeDefined();
      expect(typeof pluginManager.getPlugins).toBe("function");
    });
  });

  describe("Plugin Installation", () => {
    beforeEach(() => {
      // Create fresh instances for each test
      mockApp = createTestingApp();
      pluginManager = mockApp.addService(PluginManager, new PluginManager(mockApp));
    });

    it("should install single plugin successfully", async () => {
      class TestPlugin {
        readonly name = "TestPlugin";
        readonly displayName = "TestPlugin";
        version = "1.0.0";
        description = "A test plugin";
        install = mock();
        start = mock().mockResolvedValue(undefined);
      }

      const mockPlugin = new TestPlugin();

      await pluginManager.installPlugins([mockPlugin]);

      expect(pluginManager.getPlugins()).toContain(mockPlugin);
      expect(mockPlugin.install).toHaveBeenCalledWith(mockApp, undefined);
      expect(mockPlugin.start).toHaveBeenCalledWith(mockApp);
    });

    it("should install multiple plugins", async () => {
      class Plugin1 {
        readonly name = "Plugin1";
        readonly displayName = "Plugin1";
        version = "1.0.0";
        description = "First plugin";
        install = mock();
        start = mock().mockResolvedValue(undefined);
      }

      class Plugin2 {
        readonly name = "Plugin2";
        readonly displayName = "Plugin2";
        version = "1.0.0";
        description = "Second plugin";
        install = mock();
        start = mock().mockResolvedValue(undefined);
      }

      const plugin1 = new Plugin1();
      const plugin2 = new Plugin2();

      await pluginManager.installPlugins([plugin1, plugin2]);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins).toContain(plugin1);
      expect(plugins).toContain(plugin2);
    });

    it("should handle plugins without optional install method", async () => {
      class MinimalPlugin {
        readonly name = "MinimalPlugin";
        readonly displayName = "MinimalPlugin";
        version = "1.0.0";
        description = "Minimal plugin";
        start = mock().mockResolvedValue(undefined);
      }

      const plugin = new MinimalPlugin();

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
      expect(plugin.start).toHaveBeenCalledWith(mockApp);
    });

    it("should handle plugins without optional start method", async () => {
      class NoStartPlugin {
        readonly name = "NoStartPlugin";
        readonly displayName = "NoStartPlugin";
        version = "1.0.0";
        description = "Plugin without start";
        install = mock();
      }

      const plugin = new NoStartPlugin();

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
      expect(plugin.install).toHaveBeenCalledWith(mockApp, undefined);
    });

    it("should handle plugins with neither install nor start methods", async () => {
      class EmptyPlugin {
        readonly name = "EmptyPlugin";
        readonly displayName = "EmptyPlugin";
        version = "1.0.0";
        description = "Empty plugin";
      }

      const plugin = new EmptyPlugin();

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
    });

    it("should throw error during install phase and not register plugin", async () => {
      class FailingPlugin {
        readonly name = "FailingPlugin";
        readonly displayName = "FailingPlugin";
        version = "1.0.0";
        description = "Failing plugin";
        install = mock().mockImplementation(() => {
          throw new Error("Install failed");
        });
      }

      const plugin = new FailingPlugin();

      expect(pluginManager.installPlugins([plugin])).rejects.toThrow("Install failed");

      // Plugin should NOT be registered since install failed
      expect(pluginManager.getPlugins()).not.toContain(plugin);
    });

    it("should throw error during start phase but keep registered plugin", async () => {
      class FailingStartPlugin {
        readonly name = "FailingStartPlugin";
        readonly displayName = "FailingStartPlugin";
        version = "1.0.0";
        description = "Failing start plugin";
        install = mock();
        start = mock().mockImplementation(() => {
          throw new Error("Start failed");
        });
      }

      const plugin = new FailingStartPlugin();

      // Installation should succeed, but start should fail
      expect(pluginManager.installPlugins([plugin])).rejects.toThrow("Start failed");

      // Plugin should be registered since install succeeded
      expect(pluginManager.getPlugins()).toContain(plugin);
    });

    it("should log installation errors via serviceError", async () => {
      class FailingPlugin {
        readonly name = "FailingPlugin";
        readonly displayName = "FailingPlugin";
        version = "1.0.0";
        description = "Failing plugin";
        install = mock().mockImplementation(() => {
          throw new Error("Install failed");
        });
      }

      const plugin = new FailingPlugin();

      // Spy on serviceError
      const serviceErrorSpy = spyOn(mockApp, "serviceError");

      expect(pluginManager.installPlugins([plugin])).rejects.toThrow();

      // Verify error was logged via serviceError
      expect(serviceErrorSpy).toHaveBeenCalledWith(pluginManager, expect.stringContaining('Error installing plugin "FailingPlugin"'), expect.any(Error));
    });

    it("should log start errors via serviceError", async () => {
      class FailingStartPlugin {
        readonly name = "FailingStartPlugin";
        readonly displayName = "FailingStartPlugin";
        version = "1.0.0";
        description = "Failing start plugin";
        install = mock();
        start = mock().mockImplementation(() => {
          throw new Error("Start failed");
        });
      }

      const plugin = new FailingStartPlugin();

      // Spy on serviceError
      const serviceErrorSpy = spyOn(mockApp, "serviceError");

      expect(pluginManager.installPlugins([plugin])).rejects.toThrow();

      // Verify error was logged via serviceError
      expect(serviceErrorSpy).toHaveBeenCalledWith(pluginManager, expect.stringContaining('Error starting plugin "FailingStartPlugin"'), expect.any(Error));
    });

    it("should process install phase before start phase", async () => {
      const installCalls: string[] = [];
      const startCalls: string[] = [];

      class Plugin1 {
        readonly name = "Plugin1";
        readonly displayName = "Plugin1";
        version = "1.0.0";
        description = "First plugin";
        install = mock().mockImplementation(() => {
          installCalls.push("Plugin1");
        });
        start = mock().mockImplementation(async () => {
          startCalls.push("Plugin1");
        });
      }

      class Plugin2 {
        readonly name = "Plugin2";
        readonly displayName = "Plugin2";
        version = "1.0.0";
        description = "Second plugin";
        install = mock().mockImplementation(() => {
          installCalls.push("Plugin2");
        });
        start = mock().mockImplementation(async () => {
          startCalls.push("Plugin2");
        });
      }

      const plugin1 = new Plugin1();
      const plugin2 = new Plugin2();

      await pluginManager.installPlugins([plugin1, plugin2]);

      // All installs should complete before any starts
      expect(installCalls).toEqual(["Plugin1", "Plugin2"]);
      expect(startCalls).toEqual(["Plugin1", "Plugin2"]);
    });
  });

  describe("Plugin Access", () => {
    beforeEach(() => {
      mockApp = createTestingApp();
      pluginManager = mockApp.addService(PluginManager, new PluginManager(mockApp));
    });

    it("should return empty array when no plugins installed", () => {
      expect(pluginManager.getPlugins()).toEqual([]);
    });

    it("should return installed plugins", async () => {
      class TestPlugin {
        readonly name = "TestPlugin";
        readonly displayName = "TestPlugin";
        version = "1.0.0";
        description = "Test plugin";
      }

      const plugin = new TestPlugin();

      await pluginManager.installPlugins([plugin]);
      const plugins = pluginManager.getPlugins();

      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBe(plugin);
    });
  });

  describe("Plugin Configuration", () => {
    const widgetSchema = z.object({
      widget: z.object({ size: z.number().default(1), color: z.string().default("red") }).prefault({}),
    });

    const makePlugin = (overrides: Partial<TokenRingPlugin<typeof widgetSchema>> = {}) =>
      ({
        name: "widget-plugin",
        displayName: "Widget Plugin",
        version: "1.0.0",
        description: "Widget plugin",
        configSchema: widgetSchema,
        config: { widget: { size: 4 } },
        install: mock(),
        ...overrides,
      }) as TokenRingPlugin<typeof widgetSchema> & {
        install: ReturnType<typeof mock>;
        reconfigure?: ReturnType<typeof mock>;
      };

    beforeEach(() => {
      mockApp = createTestingApp();
      pluginManager = mockApp.addService(PluginManager, new PluginManager(mockApp));
    });

    it("registers the plugin default config as its own layer", async () => {
      const reconfigure = mock();
      const plugin = makePlugin({ reconfigure });
      await pluginManager.installPlugins([plugin]);

      const state = mockApp.stateManager.getState(AppConfigurationState);
      expect(state.pluginConfigs).toEqual({ "widget-plugin": { widget: { size: 4 } } });
      expect((state.mergedConfig as any).widget).toEqual({ size: 4 });
      expect(plugin.install).toHaveBeenCalledWith(mockApp, undefined);
      expect(reconfigure).toHaveBeenCalledWith(mockApp, { widget: { size: 4, color: "red" } });
    });

    it("lets the user layer override a plugin default", async () => {
      const appConfig = createTestingApp().stateManager.getState(AppConfigurationState).appConfig;
      mockApp = new TokenRingApp(appConfig, { globalConfig: { widget: { size: 9 } } });
      pluginManager = mockApp.addService(PluginManager, new PluginManager(mockApp));

      const reconfigure = mock();
      const plugin = makePlugin({ reconfigure });
      await pluginManager.installPlugins([plugin]);

      expect(plugin.install).toHaveBeenCalledWith(mockApp, undefined);
      expect(reconfigure).toHaveBeenCalledWith(mockApp, { widget: { size: 9, color: "red" } });
    });

    it("reconfigures only the plugins whose config slice changed", async () => {
      const reconfigure = mock();
      const plugin = makePlugin({ reconfigure });
      await pluginManager.installPlugins([plugin]);
      // installPlugins already hands config to reconfigure once.
      expect(reconfigure).toHaveBeenCalledTimes(1);

      // Nothing changed since install — no further reconfiguration.
      await pluginManager.reconfigurePlugins();
      expect(reconfigure).toHaveBeenCalledTimes(1);

      AppConfigurationState.setUserConfig(mockApp, { widget: { color: "blue" } });
      await pluginManager.reconfigurePlugins();
      expect(reconfigure).toHaveBeenCalledWith(mockApp, { widget: { size: 4, color: "blue" } });
      expect(reconfigure).toHaveBeenCalledTimes(2);

      // Re-running without a further change is a no-op.
      await pluginManager.reconfigurePlugins();
      expect(reconfigure).toHaveBeenCalledTimes(2);
    });

    it("does not reconfigure a plugin that mutated the config it was handed", async () => {
      const reconfigure = mock().mockImplementation((_app, config: any) => {
        // Plugins fill in defaults from the environment this way.
        config.widget.color = "fromEnv";
      });
      const plugin = makePlugin({ reconfigure });

      await pluginManager.installPlugins([plugin]);
      expect(reconfigure).toHaveBeenCalledTimes(1);

      await pluginManager.reconfigurePlugins();
      // Mutation of the handed copy must not pollute change detection.
      expect(reconfigure).toHaveBeenCalledTimes(1);
      expect(mockApp.stateManager.getState(AppConfigurationState).requiresRestartToFullyApplyConfig).toBe(false);
    });

    it("hands the parsed immutable config to install", async () => {
      const immutableConfigSchema = z.object({
        boot: z.object({ restore: z.boolean().default(false) }).prefault({}),
      });
      const install = mock();
      const plugin = {
        name: "boot-plugin",
        displayName: "Boot Plugin",
        version: "1.0.0",
        description: "Boot plugin",
        immutableConfigSchema,
        install,
      } as TokenRingPlugin<any, typeof immutableConfigSchema> & { install: ReturnType<typeof mock> };

      const appConfig = createTestingApp().stateManager.getState(AppConfigurationState).appConfig;
      mockApp = new TokenRingApp({ ...appConfig, boot: { restore: true } } as typeof appConfig);
      pluginManager = mockApp.addService(PluginManager, new PluginManager(mockApp));

      await pluginManager.installPlugins([plugin]);

      expect(install).toHaveBeenCalledWith(mockApp, { boot: { restore: true } });
    });

    it("does not flag a restart for an unchanged plugin without live reconfiguration", async () => {
      await pluginManager.installPlugins([makePlugin()]);
      await pluginManager.reconfigurePlugins();
      expect(mockApp.stateManager.getState(AppConfigurationState).requiresRestartToFullyApplyConfig).toBe(false);
    });

    it("retries a plugin whose reconfigure threw and still reconfigures the plugins after it", async () => {
      let fail = false;
      const failing = mock().mockImplementation(() => {
        if (fail) throw new Error("reconfigure failed");
      });
      const following = mock();
      const first = makePlugin({ name: "first", reconfigure: failing });
      const second = makePlugin({ name: "second", reconfigure: following });
      await pluginManager.installPlugins([first, second]);
      expect(failing).toHaveBeenCalledTimes(1);
      expect(following).toHaveBeenCalledTimes(1);

      const serviceErrorSpy = spyOn(mockApp, "serviceError");
      fail = true;
      AppConfigurationState.setUserConfig(mockApp, { widget: { color: "blue" } });
      // The failure is rethrown after the whole pass, so callers can roll back.
      await expect(pluginManager.reconfigurePlugins()).rejects.toThrow("reconfigure failed");

      expect(serviceErrorSpy).toHaveBeenCalledWith(pluginManager, expect.stringContaining('Error reconfiguring plugin "first"'), expect.any(Error));
      expect(failing).toHaveBeenCalledTimes(2);
      // The failure did not abort the pass.
      expect(following).toHaveBeenCalledTimes(2);
      expect(following).toHaveBeenLastCalledWith(mockApp, { widget: { size: 4, color: "blue" } });

      // Same config again: the failed plugin is retried, the applied one is not.
      fail = false;
      await pluginManager.reconfigurePlugins();
      expect(failing).toHaveBeenCalledTimes(3);
      expect(failing).toHaveBeenLastCalledWith(mockApp, { widget: { size: 4, color: "blue" } });
      expect(following).toHaveBeenCalledTimes(2);

      // Once applied, it is not reconfigured again.
      await pluginManager.reconfigurePlugins();
      expect(failing).toHaveBeenCalledTimes(3);
    });

    it("flags a restart when a changed plugin cannot be reconfigured live", async () => {
      await pluginManager.installPlugins([makePlugin()]);
      const state = mockApp.stateManager.getState(AppConfigurationState);
      expect(state.requiresRestartToFullyApplyConfig).toBe(false);

      AppConfigurationState.setUserConfig(mockApp, { widget: { color: "blue" } });
      await pluginManager.reconfigurePlugins();

      expect(state.requiresRestartToFullyApplyConfig).toBe(true);
    });
  });
});
