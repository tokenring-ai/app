import {setTimeout as delay} from "timers/promises";
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import PluginManager from '../PluginManager';
import StateManager from '../StateManager';
import TokenRingApp from '../TokenRingApp';
import type {TokenRingPlugin, TokenRingService} from '../types';
import createTestingApp from './createTestingApp';

describe('App Integration Tests', () => {
  let app: TokenRingApp;
  let pluginManager: PluginManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    app = createTestingApp();
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

      class TestPlugin implements TokenRingPlugin<undefined> {
        readonly name = 'IntegrationTestPlugin';
        version = '1.0.0';
        description = 'Integration test plugin';
        install = (app: TokenRingApp) => {
          installCalls.push('install');
          expect(app).toBe(app);
        };
        start = async (app: TokenRingApp) => {
          startCalls.push('start');
          expect(app).toBe(app);
        };
      }

      const testPlugin = new TestPlugin();

      await pluginManager.installPlugins([testPlugin]);

      expect(installCalls).toEqual(['install']);
      expect(startCalls).toEqual(['start']);
      expect(pluginManager.getPlugins()).toContain(testPlugin);
    });

    it('should handle multiple plugins with different lifecycle requirements', async () => {
      // Create fresh pluginManager for this test
      app = createTestingApp();
      pluginManager = new PluginManager(app);

      class Plugin1 implements TokenRingPlugin<undefined> {
        readonly name = 'Plugin1';
        version = '1.0.0';
        description = 'First plugin';
        install = (app: TokenRingApp) => {
          app.serviceOutput(this, 'Plugin1 installed');
        };
      }

      class Plugin2 implements TokenRingPlugin<undefined> {
        readonly name = 'Plugin2';
        version = '1.0.0';
        description = 'Second plugin';
        start = async (app: TokenRingApp) => {
          app.serviceOutput(this, 'Plugin2 started');
        };
      }

      class Plugin3 implements TokenRingPlugin<undefined> {
        readonly name = 'Plugin3';
        version = '1.0.0';
        description = 'Third plugin';
        install = (app: TokenRingApp) => {
          app.serviceOutput(this, 'Plugin3 installed');
        };
        start = async (app: TokenRingApp) => {
          app.serviceOutput(this, 'Plugin3 started');
        };
      }

      const plugin1 = new Plugin1();
      const plugin2 = new Plugin2();
      const plugin3 = new Plugin3();

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
        readonly name = 'TestStateSlice';
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
        readonly name = 'TestStateSlice';
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

      await delay(20);

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
      // Create fresh app and pluginManager for this test
      app = createTestingApp();
      pluginManager = new PluginManager(app);

      class Service1 implements TokenRingService {
        readonly name = 'Service1';
        description = 'First service';
        run = vi.fn().mockResolvedValue(undefined);
      }

      class Service2 implements TokenRingService {
        readonly name = 'Service2';
        description = 'Second service';
        run = vi.fn().mockResolvedValue(undefined);
      }

      const service1 = new Service1();
      const service2 = new Service2();

      class WorkflowPlugin implements TokenRingPlugin<undefined> {
        readonly name = 'WorkflowPlugin';
        version = '1.0.0';
        description = 'Workflow plugin';
        install = (app: TokenRingApp) => {
          app.serviceOutput(this, 'Plugin installed in workflow');
        };
        start = async (app: TokenRingApp) => {
          app.serviceOutput(this, 'Plugin started in workflow');
        };
      }

      const plugin = new WorkflowPlugin();

      // Add services
      app.addServices(service1, service2);

      // Install plugin
      await pluginManager.installPlugins([plugin]);

      // Start app
      const runPromise = app.run();

      // Wait for services to initialize
      await delay(20);

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
      // Create fresh app for this test
      app = createTestingApp();

      class ServiceA implements TokenRingService {
        readonly name = 'ServiceA';
        description = 'Service A';
        run = vi.fn().mockImplementation(async () => {});
      }

      class ServiceB implements TokenRingService {
        readonly name = 'ServiceB';
        description = 'Service B';
        run = vi.fn().mockImplementation(async () => {});
      }

      const serviceA = new ServiceA();
      const serviceB = new ServiceB();

      app.addServices(serviceA, serviceB);

      const runPromise = app.run();

      await delay(30);
      app.shutdown();

      await runPromise;

      expect(serviceA.run).toHaveBeenCalled();
      expect(serviceB.run).toHaveBeenCalled();
    });

    it('should maintain state across service lifecycle', async () => {
      const stateManager = new StateManager();

      class AppState {
        readonly name = 'AppState';
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

      await delay(20);

      // State should persist
      expect(stateManager.getState(AppState).initialized).toBe(true);
      expect(stateManager.getState(AppState).data).toHaveLength(2);

      app.shutdown();
      await runPromise;
    });

    it('should handle configuration across components', () => {
      const config = { 
        app: {
          dataDirectory: '/tmp',
          configFileName: 'config',
          configSchema: {} as any,
        },
        database: { url: 'default://url' }, 
        logging: { level: 'info' } 
      };

      const appWithConfig = new TokenRingApp(config);

      expect(appWithConfig.config).toEqual({
        app: {
          dataDirectory: '/tmp',
          configFileName: 'config',
          configSchema: {} as any,
        },
        database: { url: 'default://url' },
        logging: { level: 'info' }
      });

      // Plugin manager should work with configured app
      const pluginManagerWithConfig = new PluginManager(appWithConfig);

      class ConfigTestPlugin implements TokenRingPlugin<undefined> {
        readonly name = 'ConfigTestPlugin';
        version = '1.0.0';
        description = 'Config test plugin';
        install = (app: TokenRingApp) => {
          expect(app.config).toEqual({
            app: {
              dataDirectory: '/tmp',
              configFileName: 'config',
              configSchema: {} as any,
            },
            database: { url: 'default://url' },
            logging: { level: 'info' }
          });
        };
      }

      const testPlugin = new ConfigTestPlugin();

      return pluginManagerWithConfig.installPlugins([testPlugin]);
    });

    it('should handle errors gracefully across components', async () => {
      class Service1 implements TokenRingService {
        readonly name = 'Service1';
        description = 'Service 1';
        async run() {
          throw new Error('Service error');
        }
      }

      const errorService = new Service1();

      vi.spyOn(errorService, 'run');
      app.addServices(errorService);
      await Promise.all([
        app.run(),
        setTimeout(100).then(() => app.shutdown())
      ]);

      expect(errorService.run).toHaveBeenCalled();
    });

    it('should handle plugin installation errors without breaking app', async () => {
      class FailingPlugin implements TokenRingPlugin<undefined> {
        readonly name = 'FailingPlugin';
        version = '1.0.0';
        description = 'Plugin that fails to install';
        install = () => {
          throw new Error('Plugin installation failed');
        };
      }

      class WorkingPlugin implements TokenRingPlugin<undefined> {
        readonly name = 'WorkingPlugin';
        version = '1.0.0';
        description = 'Working plugin';
        install = (app: TokenRingApp) => {
          app.serviceOutput(this, 'Working plugin installed');
        };
      }

      const failingPlugin = new FailingPlugin();
      const workingPlugin = new WorkingPlugin();

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
      // Create fresh app and pluginManager for this test
      app = createTestingApp();
      pluginManager = new PluginManager(app);

      class ConcurrentPlugin1 implements TokenRingPlugin<undefined> {
        readonly name = 'ConcurrentPlugin1';
        version = '1.0.0';
        description = 'First concurrent plugin';
        install = (app: TokenRingApp) => {
          app.serviceOutput(this, 'Concurrent plugin 1 installed');
        };
      }

      class ConcurrentPlugin2 implements TokenRingPlugin<undefined> {
        readonly name = 'ConcurrentPlugin2';
        version = '1.0.0';
        description = 'Second concurrent plugin';
        install = (app: TokenRingApp) => {
          app.serviceOutput(this, 'Concurrent plugin 2 installed');
        };
      }

      class ConcurrentPlugin3 implements TokenRingPlugin<undefined> {
        readonly name = 'ConcurrentPlugin3';
        version = '1.0.0';
        description = 'Third concurrent plugin';
        install = (app: TokenRingApp) => {
          app.serviceOutput(this, 'Concurrent plugin 3 installed');
        };
      }

      const concurrentPlugin1 = new ConcurrentPlugin1();
      const concurrentPlugin2 = new ConcurrentPlugin2();
      const concurrentPlugin3 = new ConcurrentPlugin3();

      await pluginManager.installPlugins([concurrentPlugin1, concurrentPlugin2, concurrentPlugin3]);

      expect(pluginManager.getPlugins()).toHaveLength(3);
      expect(app.logs.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Cross-Component Dependencies', () => {
    it('should handle service waiting across components', async () => {
      class Service1 implements TokenRingService {
        readonly name = 'Service1';
        description = 'Service 1';
      }
      class Service2 implements TokenRingService{
        readonly name = 'Service2';
        description = 'Service 2';
      }

      app.addServices(new Service1(), new Service2());

      let callbackCalled = false;
      app.waitForService(Service2, (service) => {
        callbackCalled = true;
        expect(service.name).toBe("Service2");
      });

      await delay(200);

      expect(callbackCalled).toBe(true);
    });

    it('should handle state synchronization across components', () => {
      const stateManager = new StateManager();

      class SharedState {
        readonly name = 'SharedState';
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
  });
});
