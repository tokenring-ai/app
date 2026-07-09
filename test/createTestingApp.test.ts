import TokenRingApp from "../TokenRingApp";

export default function createTestingApp() {
  return new TokenRingApp({
    app: {
      dataDirectory: "/tmp",
      configDirectories: [],
      shutdownMonitorIntervalMs: 2000,
      serviceRestartDelayMs: 5000,
      printLogs: false,
    }
  });
}
