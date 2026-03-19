import {describe, expect, it} from 'vitest';
import TokenRingApp from '../TokenRingApp';
import {AppLogsState} from '../state/AppLogsState';

describe('TokenRingApp Logs State', () => {
  it('should store logs in state manager', () => {
    const app = new TokenRingApp({
      app: {
        dataDirectory: '/tmp',
        configFileName: 'config',
        configSchema: {} as any,
      }
    });

    // Add a log
    app.serviceOutput(app, 'Test message');
    
    // Verify log is in the state
    expect(app.logs).toHaveLength(1);
    expect(app.logs[0].message).toContain('Test message');
    expect(app.logs[0].level).toBe('info');
  });

  it('should persist logs in checkpoint', () => {
    const app = new TokenRingApp({
      app: {
        dataDirectory: '/tmp',
        configFileName: 'config',
        configSchema: {} as any,
      }
    });

    // Add some logs
    app.serviceOutput(app, 'Info message');
    app.serviceError(app, 'Error message');
    
    // Generate checkpoint
    const checkpoint = app.generateStateCheckpoint();
    
    // Verify logs are in checkpoint
    expect(checkpoint).toHaveProperty('AppLogsState');
    expect(checkpoint.AppLogsState).toHaveProperty('logs');
    expect(checkpoint.AppLogsState.logs).toHaveLength(2);
    expect(checkpoint.AppLogsState.logs[0].message).toContain('Info message');
    expect(checkpoint.AppLogsState.logs[1].message).toContain('Error message');
    expect(checkpoint.AppLogsState.logs[1].level).toBe('error');
  });

  it('should restore logs from checkpoint', () => {
    const app1 = new TokenRingApp({
      app: {
        dataDirectory: '/tmp',
        configFileName: 'config',
        configSchema: {} as any,
      }
    });

    // Add logs to first app
    app1.serviceOutput(app1, 'Restored message');
    const checkpoint = app1.generateStateCheckpoint();
    
    // Create second app and restore state
    const app2 = new TokenRingApp({
      app: {
        dataDirectory: '/tmp',
        configFileName: 'config',
        configSchema: {} as any,
      }
    });
    
    app2.restoreState(checkpoint);
    
    // Verify logs were restored
    expect(app2.logs).toHaveLength(1);
    expect(app2.logs[0].message).toContain('Restored message');
  });
});
