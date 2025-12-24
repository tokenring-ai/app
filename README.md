# @tokenring-ai/app

Base application framework for TokenRing applications, providing service management, plugin architecture, and state management.

## Overview

The `@tokenring-ai/app` package provides the foundational infrastructure for building modular, extensible TokenRing applications. It manages services, plugins, and application state through a unified interface.

## Installation

```bash
bun install @tokenring-ai/app
```

## Core Components

### TokenRingApp

The main application class that orchestrates services, state, and configuration.

```typescript
import TokenRingApp from "@tokenring-ai/app";

const app = new TokenRingApp(packageDirectory: string, config: Partial<TokenRingAppConfig>, defaultConfig: TokenRingAppConfig);
```

**Constructor Parameters:**
- `packageDirectory`: Package directory path
- `config`: Application configuration object
- `defaultConfig`: Default configuration that gets merged with provided config

**Key Features:**
- Service registry and dependency injection
- Plugin lifecycle management
- Configuration management with Zod validation
- Built-in logging utilities
- Promise tracking and error handling
- Scheduled task management
- Signal-based shutdown

**API Methods:**

**Service Management:**
```typescript
// Add services to the application
app.addServices(...services: TokenRingService[]): void

// Get a service by type (throws if not found)
app.requireService<T>(serviceType: abstract new (...args: any[]) => T): T

// Get a service by type (returns undefined if not found)
app.getService<T>(serviceType: abstract new (...args: any[]) => T): T | undefined

// Get all services
app.getServices(): TokenRingService[]

// Wait for a service to be available
app.waitForService<T>(
  serviceType: abstract new (...args: any[]) => T,
  callback: (service: T) => Promise<void> | void
): void
```

**Configuration Management:**
```typescript
// Get a config value with Zod validation
app.getConfigSlice<T extends { parse: (any: any) => any }>(
  key: string, 
  schema: T
): z.output<T>
```

**Logging:**
```typescript
// Log system messages with formatted output
app.serviceOutput(...messages: any[]): void

// Log error messages with formatted output
app.serviceError(...messages: any[]): void
```

**Promise Management:**
```typescript
// Track an app-level promise and log any errors that occur
app.trackPromise(initiator: (signal: AbortSignal) => Promise<void>): void
```

**Scheduling:**
```typescript
// Schedule a recurring task
app.scheduleEvery(
  interval: number, 
  callback: () => Promise<void>, 
  signal?: AbortSignal
): void
```

**Lifecycle:**
```typescript
// Stop the application
app.shutdown(): void
```

**Execution:**
```typescript
// Run the application services
app.run(): Promise<void>
```

### PluginManager

Manages plugin installation and lifecycle.

```typescript
import {PluginManager} from "@tokenring-ai/app";

const pluginManager = new PluginManager(app: TokenRingApp);

// Install plugins
await pluginManager.installPlugins(plugins: TokenRingPlugin[]): Promise<void>
```

**Plugin Lifecycle:**
1. **Registration** - Plugin is added to the registry
2. **Install** - Synchronous setup (optional)
3. **Start** - Async initialization (optional)

**API Methods:**
```typescript
// Get all installed plugins
pluginManager.getPlugins(): TokenRingPlugin[]
```

### StateManager

Type-safe state management with serialization support.

```typescript
// Initialize a state slice
app.initializeState<StateClass, Props>(
  StateClass: new (props: Props) => StateClass,
  props: Props
): void

// Get a state slice
app.getState<StateClass>(StateClass: new (...args: any[]) => StateClass): StateClass

// Mutate state with a callback
app.mutateState<R, StateClass>(
  StateClass: new (...args: any[]) => StateClass,
  callback: (state: StateClass) => R
): R
```

## Interfaces

### TokenRingService

```typescript
interface TokenRingService {
  name: string; // Must match class name
  description: string;
  
  // Optional lifecycle methods
  run?(signal: AbortSignal): Promise<void> | void;
  
  // Agent attachment methods
  attach?(agent: Agent): Promise<void> | void;
  detach?(agent: Agent): Promise<void> | void;
}
```

### TokenRingPlugin

```typescript
interface TokenRingPlugin {
  name: string;
  version: string;
  description: string;
  
  // Optional lifecycle methods
  install?(app: TokenRingApp): void; // Synchronous setup
  start?(app: TokenRingApp): Promise<void> | void; // Async initialization
}
```

### SerializableStateSlice

```typescript
interface SerializableStateSlice {
  name: string;
  serialize(): object;
  deserialize(data: object): void;
}
```

## Usage Example

```typescript
import TokenRingApp, {PluginManager} from "@tokenring-ai/app";

// Define your application configuration
const config = {
  apiKey: process.env.API_KEY,
  model: "gpt-4",
  // ... other config
};

// Create the application instance
const app = new TokenRingApp("./", config, defaultConfig);

// Define custom services
class MyService implements TokenRingService {
  name = "MyService";
  description = "A custom service";
  
  async start() {
    console.log("MyService started");
  }
  
  async doSomething() {
    return "Service result";
  }
}

// Add services to the application
app.addServices(new MyService());

// Install plugins
const pluginManager = new PluginManager(app);
const myPlugin = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "My custom plugin",
  install(app) {
    console.log("Installing plugin");
  },
  start(app) {
    console.log("Starting plugin");
  }
};
await pluginManager.installPlugins([myPlugin]);

// Use services
const myService = app.requireService(MyService);
const result = await myService.doSomething();

// Access configuration
const modelConfig = app.getConfigSlice("model", z.string());
console.log(`Using model: ${modelConfig}`);

// Logging
app.serviceOutput("Service started successfully");
app.serviceError("Something went wrong");

// Schedule a recurring task
app.scheduleEvery(5000, async () => {
  console.log("Running scheduled task");
});

// Run the application
await app.run();
```

## Configuration Schema

The application uses Zod for configuration validation. The base configuration schema is:

```typescript
export const TokenRingAppConfigSchema = z.record(z.string(), z.any());
export type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;
```

## Dependencies

- `@tokenring-ai/agent` ^0.2.0
- `@tokenring-ai/utility` ^0.2.0
- `zod` ^latest

## Architecture

The app package follows these design principles:

- **Service-Oriented**: Functionality is organized into services
- **Plugin-Based**: Extensions through a plugin system
- **Type-Safe**: TypeScript with generic type support
- **Lifecycle Management**: Controlled initialization and cleanup
- **State Isolation**: Separate state slices with serialization
- **Configuration Validation**: Zod-based configuration validation
- **Signal-Based**: Abort signals for graceful shutdown
- **Error Handling**: Built-in promise tracking and error logging

## License

MIT License - Copyright (c) 2025 Mark Dierolf