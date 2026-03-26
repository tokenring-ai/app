import {setTimeout as delay} from 'timers/promises';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import TokenRingApp from '../TokenRingApp';
import type {TokenRingService} from "../types";
import createTestingApp from "./createTestingApp";

describe('TokenRingApp', () => {
  let app: TokenRingApp;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestingApp();
  });

  afterEach(() => {
    app.shutdown();
  });

  describe('Service Registry', () => {
    it('should add services to registry', () => {
      const mockService = {
        name: 'MockService',
        description: 'A mock service',
      };

      app.addServices(mockService);
      
      // Verify service was added
      expect(app.getServices()).toContain(mockService);
    });

    it('should provide service access methods', () => {
      expect(app.requireService).toBeDefined();
      expect(app.getService).toBeDefined();
      expect(app.getServices).toBeDefined();
    });

  });

  describe('Logging', () => {
    it('should log service output messages', () => {
      const mockService: TokenRingService = {
        name: 'TestService',
        description: 'Test service',
      };
      const message = 'Test message';
      app.serviceOutput(mockService, message);
      
      expect(app.logs).toHaveLength(1);
      expect(app.logs[0]).toEqual({
        timestamp: expect.any(Number),
        level: 'info',
        message: expect.stringContaining('Test message')
      });
      expect(app.logs[0].message).toContain('[TestService]');
    });

    it('should log service error messages', () => {
      const mockService: TokenRingService = {
        name: 'TestService',
        description: 'Test service',
      };
      const error = 'Error message';
      app.serviceError(mockService, error);
      
      expect(app.logs).toHaveLength(1);
      expect(app.logs[0]).toEqual({
        timestamp: expect.any(Number),
        level: 'error',
        message: expect.stringContaining('Error message')
      });
      expect(app.logs[0].message).toContain('[TestService]');
    });

    it('should format multiple log messages', () => {
      const mockService: TokenRingService = {
        name: 'TestService',
        description: 'Test service',
      };
      app.serviceOutput(mockService, 'Message', 'part', '2');
      
      expect(app.logs[0].message).toContain('[TestService]');
      expect(app.logs[0].message).toContain('Message');
      expect(app.logs[0].message).toContain('part');
      expect(app.logs[0].message).toContain('2');
    });
  });

  describe('Promise Tracking', () => {
    it('should track promises and log errors', async () => {
      const mockService: TokenRingService = {
        name: 'TestService',
        description: 'Test service',
      };
      const mockInitiator = vi.fn().mockRejectedValue(new Error('Test error'));
      
      app.runBackgroundTask(mockService, mockInitiator);
      
      // Wait for the promise to resolve
      await delay(10);
      
      expect(app.logs).toHaveLength(1);
      expect(app.logs[0].level).toBe('error');
      expect(app.logs[0].message).toContain('Test error');
    });
  });

  describe('Configuration Management', () => {
    it('should get config slice with valid schema', () => {
      const mockSchema = {
        parse: vi.fn().mockReturnValue('parsed value')
      };
      
      const config = {
        app: {
          dataDirectory: '/tmp',
          configFileName: 'config',
          configSchema: {} as any,
        },
        testKey: 'test value'
      };
      const appWithConfig = new TokenRingApp(config);
      
      const result = appWithConfig.getConfigSlice('testKey', mockSchema);
      
      expect(result).toBe('parsed value');
      expect(mockSchema.parse).toHaveBeenCalledWith('test value');
    });

    it('should throw error for invalid config slice', () => {
      const mockSchema = {
        parse: vi.fn().mockImplementation(() => {
          throw new Error('Invalid schema');
        })
      };
      
      const config = {
        app: {
          dataDirectory: '/tmp',
          configFileName: 'config',
          configSchema: {} as any,
        },
        testKey: 'test value'
      };
      const appWithConfig = new TokenRingApp(config);
      
      expect(() => {
        appWithConfig.getConfigSlice('testKey', mockSchema);
      }).toThrow('Invalid config value for key "testKey": Invalid schema');
    });
  });

  describe('Service Waiting', () => {
    it('should wait for service', () => {
      class MockService {
        readonly name = 'MockService'
      }
      const mockCallback = vi.fn();
      
      // Mock the services.waitForItemByType method
      const mockWaitForItemByType = vi.fn();
      Object.defineProperty(app, 'services', {
        get: () => ({
          waitForItemByType: mockWaitForItemByType
        })
      });
      
      app.waitForService(MockService, mockCallback);
      
      // This should call the registry's waitForItemByType
      expect(mockWaitForItemByType).toHaveBeenCalledWith(MockService, mockCallback);
    });
  });

  describe('Run Method', () => {
    it('should run services and handle shutdown', async () => {
      class MockService1 implements TokenRingService {
        name = "MockService1";
        description = "Mock service for testing"
        async run(signal: AbortSignal) {
          await delay(10000, null, { signal })
        }
      }

      class MockService2 implements TokenRingService {
        name = "MockService2";
        description = "Mock service for testing"
        async run() {}

      }

      const mockService1 = new MockService1();
      const mockService2 = new MockService2();
      vi.spyOn(mockService1, 'run');
      vi.spyOn(mockService2, 'run');

      app.addServices(mockService1, mockService2)
      
      await Promise.all([
        app.run(),
        setTimeout(100).then(() => app.shutdown())
      ]);

      expect(mockService1.run).toHaveBeenCalled();
      expect(mockService2.run).toHaveBeenCalled();
    });

    it('should stop services before surfacing shutdown errors', async () => {
      const lifecycleEvents: string[] = [];

      class MockService implements TokenRingService {
        name = "MockService";
        description = "Mock service for testing";

        async run(signal: AbortSignal) {
          await delay(10000, null, {signal}).catch(() => {});
        }

        async stop() {
          lifecycleEvents.push("stop");
          throw new Error("Stop failed");
        }
      }

      app.addServices(new MockService());

      const runPromise = app.run();
      await delay(20);
      app.shutdown();

      await expect(runPromise).rejects.toThrow("Stop failed");
      expect(lifecycleEvents).toEqual(["stop"]);
    });

    it('should stop services after startup failures', async () => {
      const stop = vi.fn();

      class MockService implements TokenRingService {
        name = "MockService";
        description = "Mock service for testing";

        async start() {
          throw new Error("Start failed");
        }

        async stop() {
          stop();
        }
      }

      app.addServices(new MockService());

      await expect(app.run()).rejects.toThrow("Start failed");
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('Shutdown', () => {
    it('should abort the abort controller', () => {
      expect(app['abortController'].signal.aborted).toBe(false);
      
      app.shutdown();
      
      expect(app['abortController'].signal.aborted).toBe(true);
    });
  });
});
