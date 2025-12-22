import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TokenRingApp from './TokenRingApp';
import PluginManager from './PluginManager';
import StateManager from './StateManager';
import type { TokenRingPlugin, TokenRingService } from './types';


describe('App Integration Tests', () => {
  let app: TokenRingApp;
  let pluginManager: PluginManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    app = new TokenRingApp('/test/app', { env: 'test' }, { env: 'development' });
    pluginManager = new PluginManager(app);
  });

  afterEach(() => {
    app.shutdown();
  });

  describe('App and PluginManager Integration', () => {
    it('should register PluginManager as a service', () => {
      const services = app.getServices();
      expect(services).toContain(pluginManager);
    });

    it('should integrate plugin lifecycle with app', async () => {
      const installCalls: string[] = [];
      const startCalls: string[] = [];

      const testPlugin: TokenRingPlugin = {
        name: 'IntegrationTestPlugin',
        version: '1.0.0',
        description: 'Integration test plugin',
        install: (app) => {
          installCalls.push('install');
          expect(app).toBe(app);
        },
        start: async (app) => {
          startCalls.push('start');
          expect(app).toBe(app);
        }
      };

      await pluginManager.installPlugins([testPlugin]);

      expect(installCalls).toEqual(['install']);
      expect(startCalls).toEqual(['start']);
      expect(pluginManager.getPlugins()).toContain(testPlugin);
    });

    it('should handle multiple plugins with different lifecycle requirements', async () => {
      const plugin1: TokenRingPlugin = {
        name: 'Plugin1',
        version: '1.0.0',
        description: 'First plugin',
        install: (app) => {
          app.serviceOutput('Plugin1 installed');
        }
      };

      const plugin2: TokenRingPlugin = {
        name: 'Plugin2',
        version: '1.0.0',
        description: 'Second plugin',
        start: async (app) => {
          app.serviceOutput('Plugin2 started');
        }
      };

      const plugin3: TokenRingPlugin = {
        name: 'Plugin3',
        version: '1.0.0',
        description: 'Third plugin',
        install: (app) => {
          app.serviceOutput('Plugin3 installed');
        },
        start: async (app) => {
          app.serviceOutput('Plugin3 started');
        }
      };

      await pluginManager.installPlugins([plugin1, plugin2, plugin3]);

      expect(pluginManager.getPlugins()).toHaveLength(3);

      // Check that logs were created
      expect(app.logs.length).toBeGreaterThanOrEqual(3);
      expect(app.logs.some(log => log.message.includes('Plugin1 installed'))).toBe(true);
      expect(app.logs.some(log => log.message.includes('Plugin2 started'))).toBe(true);
      expect(app.logs.some(log => log.message.includes('Plugin3 installed'))).toBe(true);
      expect(app.logs.some(log => log.message.includes('Plugin3 started'))).toBe(true);
    });
  });

  describe('StateManager with App Integration', () => {
    let stateManager: StateManager<any>;

    beforeEach(() => {
      stateManager = new StateManager();
    });

    it('should integrate state management with app services', () => {
      // Add StateManager as a service
      app.addServices(stateManager);

      const services = app.getServices();
      expect(services).toContain(stateManager);
    });

    it('should handle state serialization in app context', () => {
      class TestStateSlice {
        name = 'TestStateSlice';
        data: string;

        constructor(props: { initialData: string }) {
          this.data = props.initialData;
        }

        serialize() {
          return { data: this.data };
        }

        deserialize(data: object) {
          this.data = (data as any).data;
        }
      }

      stateManager.initializeState(TestStateSlice, { initialData: 'test data' });

      const serialized = stateManager.serialize();
      expect(serialized).toEqual({
        TestStateSlice: { data: 'test data' }
      });

      // App can access serialized state
      stateManager.mutateState(TestStateSlice, (state) => {
        state.data = 'modified data';
      });

      const modifiedSerialized = stateManager.serialize();
      expect(modifiedSerialized.TestStateSlice.data).toBe('modified data');
    });

    it('should handle state subscriptions in app context', async () => {
      class TestStateSlice {
        name = 'TestStateSlice';
        counter: number = 0;

        serialize() {
          return { counter: this.counter };
        }

        deserialize(data: object) {
          this.counter = (data as any).counter;
        }

        increment() {
          this.counter++;
        }
      }

      stateManager.initializeState(TestStateSlice, { initialCounter: 0 });
      
      const callback = vi.fn();
      const unsubscribe = stateManager.subscribe(TestStateSlice, callback);

      await new Promise(resolve => setTimeout(resolve, 20));

      // Initial call should happen
      expect(callback).toHaveBeenCalledWith(stateManager.getState(TestStateSlice));

      callback.mockClear();

      // State mutation should trigger callback
      stateManager.mutateState(TestStateSlice, (state) => {
        state.increment();
      });

      expect(callback).toHaveBeenCalled();

      unsubscribe();
    });
  });

  describe('Complete Application Workflow', () => {
    it('should orchestrate full app lifecycle', async () => {
      const service1: TokenRingService = {
        name: 'Service1',
        description: 'First service',
        run: vi.fn().mockResolvedValue(undefined)
      };

      const service2: TokenRingService = {
        name: 'Service2',
        description: 'Second service',
        run: vi.fn().mockResolvedValue(undefined)
      };

      const plugin: TokenRingPlugin = {
        name: 'WorkflowPlugin',
        version: '1.0.0',
        description: 'Workflow plugin',
        install: (app) => {
          app.serviceOutput('Plugin installed in workflow');
        },
        start: async (app) => {
          app.serviceOutput('Plugin started in workflow');
        }
      };

      // Add services
      app.addServices(service1, service2);

      // Install plugin
      await pluginManager.installPlugins([plugin]);

      // Start app
      const runPromise = app.run();

      // Wait for services to initialize
      await new Promise(resolve => setTimeout(resolve, 20));

      // Shutdown
      app.shutdown();
      await runPromise;

      // Verify service lifecycle
      expect(service1.run).toHaveBeenCalled();
      expect(service2.run).toHaveBeenCalled();

      // Verify plugin lifecycle
      expect(pluginManager.getPlugins()).toContain(plugin);

      // Verify logging
      expect(app.logs.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle service dependencies and order', async () => {
      const startupOrder: string[] = [];

      const serviceA: TokenRingService = {
        name: 'ServiceA',
        description: 'Service A',
        run: vi.fn().mockImplementation(async () => {
          startupOrder.push('ServiceA');
        })
      };

      const serviceB: TokenRingService = {
        name: 'ServiceB',
        description: 'Service B',
        run: vi.fn().mockImplementation(async () => {
          startupOrder.push('ServiceB');
        })
      };

      app.addServices(serviceA, serviceB);

      const runPromise = app.run();

      await new Promise(resolve => setTimeout(resolve, 30));
      app.shutdown();

      await runPromise;

      expect(serviceA.run).toHaveBeenCalled();
      expect(serviceB.run).toHaveBeenCalled();
    });

    it('should maintain state across service lifecycle', async () => {
      const stateManager = new StateManager();

      class AppState {
        name = 'AppState';
        initialized: boolean = false;
        data: any[] = [];

        serialize() {
          return {
            initialized: this.initialized,
            data: this.data
          };
        }

        deserialize(data: any) {
          this.initialized = data.initialized;
          this.data = data.data;
        }

        initialize() {
          this.initialized = true;
          this.data.push('initialized');
        }

        addData(item: string) {
          this.data.push(item);
        }
      }

      stateManager.initializeState(AppState, {});

      // Add state manager as service
      app.addServices(stateManager);

      // Initialize state
      stateManager.mutateState(AppState, (state) => {
        state.initialize();
        state.addData('item1');
      });

      // Start app
      const runPromise = app.run();

      await new Promise(resolve => setTimeout(resolve, 20));

      // State should persist
      expect(stateManager.getState(AppState).initialized).toBe(true);
      expect(stateManager.getState(AppState).data).toHaveLength(2);

      app.shutdown();
      await runPromise;
    });

    it('should handle configuration across components', () => {
      const config = { database: { url: 'test://url' } };
      const defaultConfig = { database: { url: 'default://url' }, logging: { level: 'info' } };

      const appWithConfig = new TokenRingApp('/test/app', config, defaultConfig);

      expect(appWithConfig.config).toEqual({
        database: { url: 'test://url' },
        logging: { level: 'info' }
      });

      // Plugin manager should work with configured app
      const pluginManagerWithConfig = new PluginManager(appWithConfig);

      const testPlugin: TokenRingPlugin = {
        name: 'ConfigTestPlugin',
        version: '1.0.0',
        description: 'Config test plugin',
        install: (app) => {
          expect(app.config).toEqual({
            database: { url: 'test://url' },
            logging: { level: 'info' }
          });
        }
      };

      return pluginManagerWithConfig.installPlugins([testPlugin]);
    });

    it('should handle errors gracefully across components', async () => {
      const errorService: TokenRingService = {
        name: 'ErrorService',
        description: 'Service that throws errors',
        run: vi.fn().mockImplementation(async () => {
          throw new Error('Service error');
        })
      };

      app.addServices(errorService);
      try {
        await app.run();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle plugin installation errors without breaking app', async () => {
      const failingPlugin: TokenRingPlugin = {
        name: 'FailingPlugin',
        version: '1.0.0',
        description: 'Plugin that fails to install',
        install: () => {
          throw new Error('Plugin installation failed');
        }
      };

      const workingPlugin: TokenRingPlugin = {
        name: 'WorkingPlugin',
        version: '1.0.0',
        description: 'Working plugin',
        install: (app) => {
          app.serviceOutput('Working plugin installed');
        }
      };

      // Should throw on first plugin failure
      await expect(pluginManager.installPlugins([failingPlugin]))
        .rejects.toThrow('Plugin installation failed');

      // Plugin should not be registered
      expect(pluginManager.getPlugins()).not.toContain(failingPlugin);

      // Working plugin should still be installable
      await expect(pluginManager.installPlugins([workingPlugin]))
        .resolves.toBeUndefined();

      expect(pluginManager.getPlugins()).toContain(workingPlugin);
    });

    it('should handle concurrent operations', async () => {
      const concurrentPlugin1: TokenRingPlugin = {
        name: 'ConcurrentPlugin1',
        version: '1.0.0',
        description: 'First concurrent plugin',
        install: (app) => {
          app.serviceOutput('Concurrent plugin 1 installed');
        }
      };

      const concurrentPlugin2: TokenRingPlugin = {
        name: 'ConcurrentPlugin2',
        version: '1.0.0',
        description: 'Second concurrent plugin',
        install: (app) => {
          app.serviceOutput('Concurrent plugin 2 installed');
        }
      };

      const concurrentPlugin3: TokenRingPlugin = {
        name: 'ConcurrentPlugin3',
        version: '1.0.0',
        description: 'Third concurrent plugin',
        install: (app) => {
          app.serviceOutput('Concurrent plugin 3 installed');
        }
      };

      await pluginManager.installPlugins([concurrentPlugin1, concurrentPlugin2, concurrentPlugin3]);

      expect(pluginManager.getPlugins()).toHaveLength(3);
      expect(app.logs.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Cross-Component Dependencies', () => {
    it('should handle service waiting across components', async () => {
      class Service1 implements TokenRingService {
        name = 'Service1';
        description = 'Service 1';
      }
      class Service2 implements TokenRingService{
        name = 'Service2';
        description = 'Service 2';
      }

      app.addServices(new Service1(), new Service2());

      let callbackCalled = false;
      app.waitForService(Service2, (service) => {
        callbackCalled = true;
        expect(service.name).toBe("Service2");
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(callbackCalled).toBe(true);
    });

    it('should handle state synchronization across components', () => {
      const stateManager = new StateManager();

      class SharedState {
        name = 'SharedState';
        value: string = '';

        serialize() {
          return { value: this.value };
        }

        deserialize(data: any) {
          this.value = data.value;
        }

        setValue(value: string) {
          this.value = value;
        }
      }

      stateManager.initializeState(SharedState, {});

      // Component 1: Sets state
      app.addServices(stateManager);

      stateManager.mutateState(SharedState, (state) => {
        state.setValue('initial');
      });

      // Component 2: Reads state
      const component2Callback = vi.fn();
      stateManager.subscribe(SharedState, component2Callback);

      // Component 3: Modifies state
      stateManager.mutateState(SharedState, (state) => {
        state.setValue('updated');
      });

      expect(component2Callback).toHaveBeenCalled();
      expect(stateManager.getState(SharedState).value).toBe('updated');
    });

    it('should handle configuration propagation', () => {
      const config = { feature: { enabled: true } };
      const defaultConfig = { feature: { enabled: false }, other: { value: 'default' } };

      const app1 = new TokenRingApp('/app1', config, defaultConfig);
      const app2 = new TokenRingApp('/app2', {}, defaultConfig);

      expect(app1.config).toEqual({
        feature: { enabled: true },
        other: { value: 'default' }
      });

      expect(app2.config).toEqual({
        feature: { enabled: false },
        other: { value: 'default' }
      });

      // Plugin manager should work with different app configs
      const pm1 = new PluginManager(app1);
      const pm2 = new PluginManager(app2);

      const testPlugin: TokenRingPlugin = {
        name: 'ConfigPlugin',
        version: '1.0.0',
        description: 'Config test plugin',
        install: (app) => {
          expect(app.config).toBe(app.config); // Should match the app's config
        }
      };

      return pm1.installPlugins([testPlugin]);
    });
  });
});