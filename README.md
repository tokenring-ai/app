# @tokenring-ai/app

Base application framework for TokenRing applications, providing service management, plugin architecture, and state management.

## Overview

The `@tokenring-ai/app` package provides the foundational infrastructure for building modular, extensible TokenRing applications. It manages services, plugins, and application state through a unified interface.

## Core Components

### TokenRingApp

The main application class that orchestrates services, state, and configuration.

```typescript
import TokenRingApp from "@tokenring-ai/app";

const app = new TokenRingApp(config);
```

**Key Features:**
- Service registry and dependency injection
- State management with serialization support
- Configuration management with Zod validation
- Plugin lifecycle management

**API:**
```typescript
// Service Management
app.addServices(...services: TokenRingService[])
app.requireService<T>(ServiceClass): T
app.getService<T>(ServiceClass): T | undefined
app.waitForService<T>(ServiceClass, callback)

// State Management
app.initializeState(StateClass, props)
app.getState(StateClass): StateSlice
app.mutateState(StateClass, callback)

// Configuration
app.getConfigSlice(key, zodSchema)

// Logging
app.serviceOutput(...messages)
app.serviceError(...messages)
```

### PluginManager

Manages plugin installation and lifecycle.

```typescript
import {PluginManager} from "@tokenring-ai/app";

const pluginManager = new PluginManager();
await pluginManager.installPlugins(plugins, app);
```

**Plugin Lifecycle:**
1. Registration
2. `install()` - Synchronous setup
3. `start()` - Async initialization

### StateManager

Type-safe state management with serialization.

```typescript
// Initialize state
app.initializeState(MyStateClass, { initialData });

// Read state
const state = app.getState(MyStateClass);

// Mutate state
app.mutateState(MyStateClass, (state) => {
  state.updateValue(newValue);
  return result;
});
```

## Interfaces

### TokenRingService

Services provide functionality to the application and can attach to agents.

```typescript
interface TokenRingService {
  name: string;
  description: string;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  attach?(agent: Agent): Promise<void> | void;
  detach?(agent: Agent): Promise<void> | void;
  getContextItems?(agent: Agent): AsyncGenerator<ContextItem>;
}
```

### TokenRingPlugin

Plugins extend application functionality.

```typescript
interface TokenRingPlugin {
  name: string;
  version: string;
  description: string;
  install?(app: TokenRingApp): void;
  start?(app: TokenRingApp): Promise<void> | void;
}
```

### SerializableStateSlice

State slices that can be persisted and restored.

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

// Create app with config
const app = new TokenRingApp({
  apiKey: process.env.API_KEY,
  model: "gpt-4"
});

// Add services
app.addServices(
  new MyService(),
  new AnotherService()
);

// Install plugins
const pluginManager = new PluginManager();
app.addServices(pluginManager);
await pluginManager.installPlugins([myPlugin], app);

// Initialize state
app.initializeState(AppState, { userId: "123" });

// Use services
const myService = app.requireService(MyService);
await myService.doSomething();
```

## Architecture

The app package follows these design principles:

- **Service-Oriented**: Functionality is organized into services
- **Plugin-Based**: Extensions through a plugin system
- **Type-Safe**: TypeScript with generic type support
- **Lifecycle Management**: Controlled initialization and cleanup
- **State Isolation**: Separate state slices with serialization

## License

MIT License - Copyright (c) 2025 Mark Dierolf
