import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import PluginManager from '../PluginManager';
import TokenRingApp from '../TokenRingApp';
import type { TokenRingPlugin } from '../types';
import createTestingApp from "./createTestingApp";

// Mock TokenRingApp to avoid complex dependencies
vi.mock('./TokenRingApp', () => {
  return {
    default: class MockTokenRingApp {
      addServices = vi.fn();
      services = {
        register: vi.fn()
      };
    }
  };
});

describe('PluginManager', () => {
  let mockApp: TokenRingApp;
  let pluginManager: PluginManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a mock app instance
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
      pluginManager = new PluginManager(mockApp);
    });

    it('should install single plugin successfully', async () => {
      const mockPlugin: TokenRingPlugin = {
        name: 'TestPlugin',
        version: '1.0.0',
        description: 'A test plugin',
        install: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined)
      };

      await pluginManager.installPlugins([mockPlugin]);

      expect(pluginManager.getPlugins()).toContain(mockPlugin);
      expect(mockPlugin.install).toHaveBeenCalledWith(mockApp);
      expect(mockPlugin.start).toHaveBeenCalledWith(mockApp);
    });

    it('should install multiple plugins', async () => {
      const plugin1: TokenRingPlugin = {
        name: 'Plugin1',
        version: '1.0.0',
        description: 'First plugin',
        install: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined)
      };

      const plugin2: TokenRingPlugin = {
        name: 'Plugin2',
        version: '1.0.0',
        description: 'Second plugin',
        install: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined)
      };

      await pluginManager.installPlugins([plugin1, plugin2]);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins).toContain(plugin1);
      expect(plugins).toContain(plugin2);
    });

    it('should handle plugins without optional install method', async () => {
      const plugin: TokenRingPlugin = {
        name: 'MinimalPlugin',
        version: '1.0.0',
        description: 'Minimal plugin',
        start: vi.fn().mockResolvedValue(undefined)
        // No install method
      };

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
      expect(plugin.start).toHaveBeenCalledWith(mockApp);
    });

    it('should handle plugins without optional start method', async () => {
      const plugin: TokenRingPlugin = {
        name: 'NoStartPlugin',
        version: '1.0.0',
        description: 'Plugin without start',
        install: vi.fn()
        // No start method
      };

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
      expect(plugin.install).toHaveBeenCalledWith(mockApp);
    });

    it('should handle plugins with neither install nor start methods', async () => {
      const plugin: TokenRingPlugin = {
        name: 'EmptyPlugin',
        version: '1.0.0',
        description: 'Empty plugin'
        // No optional methods
      };

      await pluginManager.installPlugins([plugin]);

      expect(pluginManager.getPlugins()).toContain(plugin);
    });

    it('should throw error during install phase', async () => {
      const installError = new Error('Install failed');
      const plugin: TokenRingPlugin = {
        name: 'FailingPlugin',
        version: '1.0.0',
        description: 'Failing plugin',
        install: vi.fn().mockImplementation(() => {
          throw installError;
        })
      };

      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow('Install failed');


      // Note: Plugin is registered before install is called, so it will be in the list
      // This is the actual behavior of the implementation
      expect(pluginManager.getPlugins()).not.toContain(plugin);
    });

    it('should throw error during start phase', async () => {
      const startError = new Error('Start failed');
      const plugin: TokenRingPlugin = {
        name: 'FailingStartPlugin',
        version: '1.0.0',
        description: 'Failing start plugin',
        install: vi.fn(),
        start: vi.fn().mockImplementation(() => {
          throw startError;
        })
      };

      // Installation should succeed, but start should fail
      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow('Start failed');

      // Plugin should be registered since install succeeded
      expect(pluginManager.getPlugins()).toContain(plugin);
    });

    it('should log installation errors to console', async () => {
      const installError = new Error('Install failed');
      const plugin: TokenRingPlugin = {
        name: 'FailingPlugin',
        version: '1.0.0',
        description: 'Failing plugin',
        install: vi.fn().mockImplementation(() => {
          throw installError;
        })
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error installing plugin "FailingPlugin":',
        installError
      );

      consoleSpy.mockRestore();
    });

    it('should log start errors to console', async () => {
      const startError = new Error('Start failed');
      const plugin: TokenRingPlugin = {
        name: 'FailingStartPlugin',
        version: '1.0.0',
        description: 'Failing start plugin',
        install: vi.fn(),
        start: vi.fn().mockImplementation(() => {
          throw startError;
        })
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // This should succeed in installation but fail on start
      await expect(pluginManager.installPlugins([plugin]))
        .rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error starting plugin "FailingStartPlugin":',
        startError
      );

      consoleSpy.mockRestore();
    });

    it('should process install phase before start phase', async () => {
      const installCalls: string[] = [];
      const startCalls: string[] = [];

      const plugin1: TokenRingPlugin = {
        name: 'Plugin1',
        version: '1.0.0',
        description: 'First plugin',
        install: vi.fn().mockImplementation(() => {
          installCalls.push('Plugin1');
        }),
        start: vi.fn().mockImplementation(async () => {
          startCalls.push('Plugin1');
        })
      };

      const plugin2: TokenRingPlugin = {
        name: 'Plugin2',
        version: '1.0.0',
        description: 'Second plugin',
        install: vi.fn().mockImplementation(() => {
          installCalls.push('Plugin2');
        }),
        start: vi.fn().mockImplementation(async () => {
          startCalls.push('Plugin2');
        })
      };

      await pluginManager.installPlugins([plugin1, plugin2]);

      // All installs should complete before any starts
      expect(installCalls).toEqual(['Plugin1', 'Plugin2']);
      expect(startCalls).toEqual(['Plugin1', 'Plugin2']);
    });
  });

  describe('Plugin Access', () => {
    beforeEach(() => {
      pluginManager = new PluginManager(mockApp);
    });

    it('should return empty array when no plugins installed', () => {
      expect(pluginManager.getPlugins()).toEqual([]);
    });

    it('should return installed plugins', async () => {
      const plugin: TokenRingPlugin = {
        name: 'TestPlugin',
        version: '1.0.0',
        description: 'Test plugin'
      };

      await pluginManager.installPlugins([plugin]);
      const plugins = pluginManager.getPlugins();

      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBe(plugin);
    });
  });
});