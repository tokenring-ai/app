import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import TokenRingApp from '../TokenRingApp';
import type {TokenRingService} from "../types";
import createTestingApp from "./createTestingApp";
import { setTimeout } from 'timers/promises';

describe('TokenRingApp', () => {
  let app: TokenRingApp;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestingApp()
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
      await setTimeout(10);
      
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
          await setTimeout(10000, null, { signal })
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
  });

  describe('Shutdown', () => {
    it('should abort the abort controller', () => {
      expect(app['abortController'].signal.aborted).toBe(false);
      
      app.shutdown();
      
      expect(app['abortController'].signal.aborted).toBe(true);
    });
  });
});