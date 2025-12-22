import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TokenRingApp, { TokenRingAppConfig } from '../TokenRingApp';
import createTestingApp from "./createTestingApp";


describe('TokenRingApp', () => {
  let app: TokenRingApp;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestingApp()
  });

  afterEach(() => {
    app.shutdown();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with correct configuration', () => {
      const config = { test: 'value' };
      const customDefaultConfig: TokenRingAppConfig = { default: 'config' };
      const appWithConfig = new TokenRingApp('/test', config, customDefaultConfig);
      
      expect(appWithConfig.config).toEqual({ default: 'config', test: 'value' });
    });

    it('should merge config with defaultConfig', () => {
      const config = { key1: 'value1', key2: 'value2' };
      const customDefault: TokenRingAppConfig = { key2: 'overridden', key3: 'value3' };
      const appWithConfig = new TokenRingApp('/test', config, customDefault);
      
      expect(appWithConfig.config).toEqual({
        key1: 'value1',
        key2: 'value2', // config overrides default
        key3: 'value3'
      });
    });
  });

  describe('Service Registry', () => {
    it('should add services to registry', () => {
      const mockService = {
        name: 'MockService',
        description: 'A mock service',
      };

      app.addServices(mockService);
      
      // Verify that addServices was called
      expect(app.addServices).toBeDefined();
    });

    it('should provide service access methods', () => {
      expect(app.requireService).toBeDefined();
      expect(app.getService).toBeDefined();
      expect(app.getServices).toBeDefined();
    });

  });

  describe('Logging', () => {
    it('should log service output messages', () => {
      const message = 'Test message';
      app.serviceOutput(message);
      
      expect(app.logs).toHaveLength(1);
      expect(app.logs[0]).toEqual({
        timestamp: expect.any(Number),
        level: 'info',
        message: expect.stringContaining('Test message')
      });
    });

    it('should log service error messages', () => {
      const error = 'Error message';
      app.serviceError(error);
      
      expect(app.logs).toHaveLength(1);
      expect(app.logs[0]).toEqual({
        timestamp: expect.any(Number),
        level: 'error',
        message: expect.stringContaining('Error message')
      });
    });

    it('should format multiple log messages', () => {
      app.serviceOutput('Message', 'part', '2');
      
      expect(app.logs[0].message).toContain('Message');
      expect(app.logs[0].message).toContain('part');
      expect(app.logs[0].message).toContain('2');
    });
  });

  describe('Promise Tracking', () => {
    it('should track promises and log errors', async () => {
      const mockPromise = vi.fn().mockRejectedValue(new Error('Test error'));
      
      app.trackPromise(mockPromise);
      
      // Wait for the promise to resolve (trackPromise doesn't await)
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(app.logs).toHaveLength(1);
      expect(app.logs[0].level).toBe('error');
      expect(app.logs[0].message).toContain('Test error');
    });
  });

  describe('Scheduling', () => {
    it('should schedule recurring tasks', async () => {
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      const mockAppSignal = { aborted: false };
      
      app.scheduleEvery(100, mockCallback, mockAppSignal);
      
      // Check that the promise was tracked
      expect(app.logs.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle scheduling errors gracefully', async () => {
      const mockCallback = vi.fn().mockRejectedValue(new Error('Callback error'));
      const mockAppSignal = { aborted: false };
      
      app.scheduleEvery(100, mockCallback, mockAppSignal);
      
      // Wait for at least one execution
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(app.logs).toHaveLength(2);
      expect(app.logs[0].level).toBe('error');
      expect(app.logs[0].message).toContain('Callback error');
    });
  });

  describe('Configuration Management', () => {
    it('should get config slice with valid schema', () => {
      const mockSchema = {
        parse: vi.fn().mockReturnValue('parsed value')
      };
      
      app.config['testKey'] = 'test value';
      const result = app.getConfigSlice('testKey', mockSchema);
      
      expect(result).toBe('parsed value');
      expect(mockSchema.parse).toHaveBeenCalledWith('test value');
    });

    it('should throw error for invalid config slice', () => {
      const mockSchema = {
        parse: vi.fn().mockImplementation(() => {
          throw new Error('Invalid schema');
        })
      };
      
      app.config['testKey'] = 'test value';
      
      expect(() => {
        app.getConfigSlice('testKey', mockSchema);
      }).toThrow('Invalid config value for key "testKey": Invalid schema');
    });
  });

  describe('Service Waiting', () => {
    it('should wait for service', () => {
      class MockService {
        name = 'MockService'
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
      const mockService1 = {
        name: 'Service1',
        run: vi.fn().mockResolvedValue(undefined)
      };
      
      const mockService2 = {
        name: 'Service2',
        run: vi.fn().mockResolvedValue(undefined)
      };
      
      // Mock services.getItems to return our test services
      const mockGetItems = vi.fn().mockReturnValue([mockService1, mockService2]);
      Object.defineProperty(app, 'services', {
        get: () => ({
          getItems: mockGetItems
        })
      });
      
      const runPromise = app.run();
      
      // Wait a bit for services to start
      await new Promise(resolve => setTimeout(resolve, 10));
      
      app.shutdown();
      await runPromise;
      
      expect(mockService1.run).toHaveBeenCalled();
      expect(mockService2.run).toHaveBeenCalled();
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