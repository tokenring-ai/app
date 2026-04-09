import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import PluginManager from '../PluginManager';
import TokenRingApp from '../TokenRingApp';
import createTestingApp from "./createTestingApp";

describe('PluginManager', () => {
  let mockApp: TokenRingApp;
  let pluginManager: PluginManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a real app instance for proper testing
    mockApp = createTestingApp();
    pluginManager = new PluginManager(mockApp);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct name and description', () => {
      expect(pluginManager.name).toBe('PluginManager');
      expect(pluginManager.description).toBe('Manages plugins');
    });

    it('should register itself as a service', () => {
      expect(mockApp.getServices()).toContain(pluginManager);
    });

    it('should initialize plugins registry', () => {
      expect(pluginManager.getPlugins).toBeDefined();
      expect(typeof pluginManager.getPlugins).toBe('function');
    });
  });

  describe('Plugin Installation', () => {
    beforeEach(() => {
      // Create fresh instances for each test
      mockApp = createTestingApp();
      pluginManager = new PluginManager(mockApp);
    });

    it('should install single plugin successfully', async () => {
      class TestPlugin {
        readonly name = 'TestPlugin';
        version = '1.0.0';
        description = 'A test plugin';
        install = vi.fn();
        start = vi.fn().mockResolvedValue(undefined);
      }

      const mockPlugin = new TestPlugin();

      await pluginManager.installPlugins([mockPlugin]);

      expect(pluginManager.getPlugins()).toContain(mockPlugin);
      expect(mockPlugin.install).toHaveBeenCalledWith(mockApp, {});
      expect(mockPlugin.start).toHaveBeenCalledWith(mockApp, {});
    });

    it('should install multiple plugins', async () => {
      class Plugin1 {
        readonly name = 'Plugin1';
        version = '1.0.0';
        description = 'First plugin';
        install = vi.fn();
        start = vi.fn().mockResolvedValue(undefined);
      }

      class Plugin2 {
        readonly name = 'Plugin2';
        version = '1.0.0';
        description = 'Second plugin';
        install = vi.fn();
        start = vi.fn().mockResolvedValue(undefined);
      }

      const plugin1 = new Plugin1();
      const plugin2 = new Plugin2();

      await pluginManager.installPlugins([plugin1, plugin2]);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins).toContain(plugin1);
      expect(plugins).toContain(plugin2);
    });

    it('should handle plugins without optional install method', async () => {
      class MinimalPlugin {
        readonly name = 'MinimalPlugin';
        version = '1.0.0';
        description = 'Minimal plugin';
        start = vi.fn().mockResolvedValue(undefined);
      }

      const plugin = new MinimalPlugin();

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
      expect(plugin.start).toHaveBeenCalledWith(mockApp, {});
    });

    it('should handle plugins without optional start method', async () => {
      class NoStartPlugin {
        readonly name = 'NoStartPlugin';
        version = '1.0.0';
        description = 'Plugin without start';
        install = vi.fn();
      }

      const plugin = new NoStartPlugin();

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
      expect(plugin.install).toHaveBeenCalledWith(mockApp, {});
    });

    it('should handle plugins with neither install nor start methods', async () => {
      class EmptyPlugin {
        readonly name = 'EmptyPlugin';
        version = '1.0.0';
        description = 'Empty plugin';
      }

      const plugin = new EmptyPlugin();

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
    });

    it('should throw error during install phase and not register plugin', async () => {
      class FailingPlugin {
        readonly name = 'FailingPlugin';
        version = '1.0.0';
        description = 'Failing plugin';
        install = vi.fn().mockImplementation(() => {
          throw new Error('Install failed');
        });
      }

      const plugin = new FailingPlugin();

      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow('Install failed');

      // Plugin should NOT be registered since install failed
      expect(pluginManager.getPlugins()).not.toContain(plugin);
    });

    it('should throw error during start phase but keep registered plugin', async () => {
      class FailingStartPlugin {
        readonly name = 'FailingStartPlugin';
        version = '1.0.0';
        description = 'Failing start plugin';
        install = vi.fn();
        start = vi.fn().mockImplementation(() => {
          throw new Error('Start failed');
        });
      }

      const plugin = new FailingStartPlugin();

      // Installation should succeed, but start should fail
      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow('Start failed');

      // Plugin should be registered since install succeeded
      expect(pluginManager.getPlugins()).toContain(plugin);
    });

    it('should log installation errors via serviceError', async () => {
      class FailingPlugin {
        readonly name = 'FailingPlugin';
        version = '1.0.0';
        description = 'Failing plugin';
        install = vi.fn().mockImplementation(() => {
          throw new Error('Install failed');
        });
      }

      const plugin = new FailingPlugin();

      // Spy on serviceError
      const serviceErrorSpy = vi.spyOn(mockApp, 'serviceError');

      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow();

      // Verify error was logged via serviceError
      expect(serviceErrorSpy).toHaveBeenCalledWith(
        pluginManager,
        expect.stringContaining('Error installing plugin "FailingPlugin"'),
        expect.any(Error)
      );
    });

    it('should log start errors via serviceError', async () => {
      class FailingStartPlugin {
        readonly name = 'FailingStartPlugin';
        version = '1.0.0';
        description = 'Failing start plugin';
        install = vi.fn();
        start = vi.fn().mockImplementation(() => {
          throw new Error('Start failed');
        });
      }

      const plugin = new FailingStartPlugin();

      // Spy on serviceError
      const serviceErrorSpy = vi.spyOn(mockApp, 'serviceError');

      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow();

      // Verify error was logged via serviceError
      expect(serviceErrorSpy).toHaveBeenCalledWith(
        pluginManager,
        expect.stringContaining('Error starting plugin "FailingStartPlugin"'),
        expect.any(Error)
      );
    });

    it('should process install phase before start phase', async () => {
      const installCalls: string[] = [];
      const startCalls: string[] = [];

      class Plugin1 {
        readonly name = 'Plugin1';
        version = '1.0.0';
        description = 'First plugin';
        install = vi.fn().mockImplementation(() => {
          installCalls.push('Plugin1');
        });
        start = vi.fn().mockImplementation(async () => {
          startCalls.push('Plugin1');
        });
      }

      class Plugin2 {
        readonly name = 'Plugin2';
        version = '1.0.0';
        description = 'Second plugin';
        install = vi.fn().mockImplementation(() => {
          installCalls.push('Plugin2');
        });
        start = vi.fn().mockImplementation(async () => {
          startCalls.push('Plugin2');
        });
      }

      const plugin1 = new Plugin1();
      const plugin2 = new Plugin2();

      await pluginManager.installPlugins([plugin1, plugin2]);

      // All installs should complete before any starts
      expect(installCalls).toEqual(['Plugin1', 'Plugin2']);
      expect(startCalls).toEqual(['Plugin1', 'Plugin2']);
    });
  });

  describe('Plugin Access', () => {
    beforeEach(() => {
      mockApp = createTestingApp();
      pluginManager = new PluginManager(mockApp);
    });

    it('should return empty array when no plugins installed', () => {
      expect(pluginManager.getPlugins()).toEqual([]);
    });

    it('should return installed plugins', async () => {
      class TestPlugin {
        readonly name = 'TestPlugin';
        version = '1.0.0';
        description = 'Test plugin';
      }

      const plugin = new TestPlugin();

      await pluginManager.installPlugins([plugin]);
      const plugins = pluginManager.getPlugins();

      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBe(plugin);
    });
  });
});
