# @tokenring-ai/app

Base application framework for TokenRing applications, providing service management, plugin architecture, and state management.

## Overview

The `@tokenring-ai/app` package provides the foundational infrastructure for building modular, extensible TokenRing applications. It manages services, plugins, and application state through a unified interface.

## Installation

```bash
npm install @tokenring-ai/app
```

## Core Components

### TokenRingApp

The main application class that orchestrates services, state, and configuration.

```typescript
import TokenRingApp from "@tokenring-ai/app";

const app = new TokenRingApp(config, defaultConfig);
```

**Constructor Parameters:**
- `config`: Application configuration object
- `defaultConfig` (optional): Default configuration that gets merged with provided config

**Key Features:**
- Service registry and dependency injection
- Plugin lifecycle management
- Configuration management with Zod validation
- Built-in logging utilities

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
): z.infer<T>
```

**Logging:**
```typescript
// Log system messages with formatted output
app.serviceOutput(...messages: any[]): void

// Log error messages with formatted output
app.serviceError(...messages: any[]): void
```

### PluginManager

Manages plugin installation and lifecycle.

```typescript
import {PluginManager} from "@tokenring-ai/app";

const pluginManager = new PluginManager();
app.addServices(pluginManager);

// Install plugins
await pluginManager.installPlugins(plugins, app);
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
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  
  // Agent attachment methods
  attach?(agent: Agent): Promise<void> | void;
  detach?(agent: Agent): Promise<void> | void;
  
  // Context item provider
  getContextItems?(agent: Agent): AsyncGenerator<ContextItem>;
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
const app = new TokenRingApp(config);

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
const pluginManager = new PluginManager();
app.addServices(pluginManager);
await pluginManager.installPlugins([myPlugin], app);

// Use services
const myService = app.requireService(MyService);
const result = await myService.doSomething();

// Access configuration
const modelConfig = app.getConfigSlice("model", z.string());
console.log(`Using model: ${modelConfig}`);

// Logging
app.serviceOutput("Service started successfully");
app.serviceError("Something went wrong");
```

## Configuration Schema

The application uses Zod for configuration validation. The base configuration schema is:

```typescript
export const TokenRingAppConfigSchema = z.record(z.string(), z.any());
export type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;
```

## Dependencies

- `@tokenring-ai/utility` ^0.1.0

## Architecture

The app package follows these design principles:

- **Service-Oriented**: Functionality is organized into services
- **Plugin-Based**: Extensions through a plugin system
- **Type-Safe**: TypeScript with generic type support
- **Lifecycle Management**: Controlled initialization and cleanup
- **State Isolation**: Separate state slices with serialization
- **Configuration Validation**: Zod-based configuration validation

## Integration with TokenRing Ecosystem

The `@tokenring-ai/app` package is designed to work seamlessly with other TokenRing packages:

- **@tokenring-ai/agent**: Agent management and execution
- **@tokenring-ai/ai-client**: AI model integration
- **@tokenring-ai/chat**: Chat interface
- **@tokenring-ai/filesystem**: File system operations
- **@tokenring-ai/database**: Database integration
- And many more...

## License

MIT License - Copyright (c) 2025 Mark Dierolf