import { describe, expect, it } from "bun:test";
import type { LogEntry } from "../TokenRingApp";
import TokenRingApp from "../TokenRingApp";
import type { TokenRingService } from "../types";

const testService: TokenRingService = { name: "App", description: "App" };

describe("TokenRingApp Logs State", () => {
  it("should store logs in state manager", () => {
    const app = new TokenRingApp({
      app: {
        dataDirectory: "/tmp",
        configDirectories: [],
        shutdownMonitorIntervalMs: 2000,
        serviceRestartDelayMs: 5000,
        printLogs: false,
      },
    });

    // Add a log
    app.serviceOutput(testService, "Test message");

    // Verify log is in the state
    expect(app.logs).toHaveLength(1);
    expect(app.logs[0]?.message).toContain("Test message");
    expect(app.logs[0]?.level).toBe("info");
  });

  it("should persist logs in checkpoint", () => {
    const app = new TokenRingApp({
      app: {
        dataDirectory: "/tmp",
        configDirectories: [],
        shutdownMonitorIntervalMs: 2000,
        serviceRestartDelayMs: 5000,
        printLogs: false,
      },
    });

    // Add some logs
    app.serviceOutput(testService, "Info message");
    app.serviceError(testService, "Error message");

    // Generate checkpoint
    const checkpoint = app.generateStateCheckpoint();

    // Verify logs are in checkpoint
    expect(checkpoint).toHaveProperty("AppLogsState");
    const appLogsCheckpoint = checkpoint.AppLogsState as { logs: LogEntry[] };
    expect(appLogsCheckpoint.logs).toHaveLength(2);
    expect(appLogsCheckpoint.logs[0]?.message).toContain("Info message");
    expect(appLogsCheckpoint.logs[1]?.message).toContain("Error message");
    expect(appLogsCheckpoint.logs[1]?.level).toBe("error");
  });

  it("should restore logs from checkpoint", () => {
    const app1 = new TokenRingApp({
      app: {
        dataDirectory: "/tmp",
        configDirectories: [],
        shutdownMonitorIntervalMs: 2000,
        serviceRestartDelayMs: 5000,
        printLogs: false,
      },
    });

    // Add logs to first app
    app1.serviceOutput(testService, "Restored message");
    const checkpoint = app1.generateStateCheckpoint();

    // Create second app and restore state
    const app2 = new TokenRingApp({
      app: {
        dataDirectory: "/tmp",
        configDirectories: [],
        shutdownMonitorIntervalMs: 2000,
        serviceRestartDelayMs: 5000,
        printLogs: false,
      },
    });

    app2.restoreState(checkpoint);

    // Verify logs were restored
    expect(app2.logs).toHaveLength(1);
    expect(app2.logs[0]?.message).toContain("Restored message");
  });

  it("should not skip logs appended while a subscriber processes an entry", async () => {
    const app = new TokenRingApp({
      app: {
        dataDirectory: "/tmp",
        configDirectories: [],
        shutdownMonitorIntervalMs: 2000,
        serviceRestartDelayMs: 5000,
        printLogs: false,
      },
    });
    const controller = new AbortController();
    const logs = app.subscribeLogsAsync(0, controller.signal);

    app.serviceOutput(testService, "First message");
    const first = await logs.next();
    expect(first.value?.message).toContain("First message");

    // Append while the generator is suspended at the first yield. Since the
    // state object is mutable, advancing the cursor after this point used to
    // mark the second message as consumed without ever yielding it.
    app.serviceOutput(testService, "Second message");
    const second = await logs.next();
    expect(second.value?.message).toContain("Second message");

    controller.abort();
    await logs.next();
  });
});
