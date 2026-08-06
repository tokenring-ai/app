import TokenRingApp from "../TokenRingApp";

export default function createTestingApp() {
  return new TokenRingApp({
    app: {
      workingDirectory: "/tmp",
      workspaceDirectory: "/tmp",
      configDirectories: [],
      shutdownMonitorIntervalMs: 2000,
      serviceRestartDelayMs: 5000,
      printLogs: false,
    },
  });
}
