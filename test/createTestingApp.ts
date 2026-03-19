import TokenRingApp from "../TokenRingApp";

export default function createTestingApp() {
  return new TokenRingApp({
    app: {
      dataDirectory: '/tmp',
      configFileName: 'config',
      configSchema: {} as any,
    }
  });
}
