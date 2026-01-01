# @tokenring-ai/app

## Overview
Base application framework for TokenRing applications, providing service management, plugin architecture, and state management through a unified interface. The package serves as the foundational infrastructure for building modular, extensible TokenRing applications with comprehensive lifecycle management.

## Features
- **Service-Oriented Architecture**: Organizes functionality into configurable services
- **Plugin-Based Extensions**: Seamless integration with plugin system for modular functionality
- **Type-Safe Configuration**: Zod-based validation for all configuration schemas
- **Lifecycle Management**: Controlled initialization, startup, and shutdown processes
- **State Isolation**: Separate state slices with serialization support
- **Signal-Based Shutdown**: Graceful termination using AbortSignal
- **Promise Tracking**: Automatic error handling for async operations
- **Scheduled Tasks**: Built-in task scheduling for recurring operations
- **Comprehensive Logging**: Structured output for system messages and errors

## Installation

```bash
bun install @tokenring-ai/app
```

## Core Components/API

### TokenRingApp

The main application class that orchestrates services, configuration, and lifecycle management.

#### Constructor
```typescript
new TokenRingApp(
  packageDirectory: string,
  config: TokenRingAppConfig
)
```

#### Methods

##### Service Management
- `addServices(...services: TokenRingService[]): void`
  - Register services with the application
  - Services are automatically initialized in registration order

- `requireService<T>(serviceType: abstract new (...args: any[]) => T): T`
  - Get a service by type (throws error if not found)

- `getService<T>(serviceType: abstract new (...args: any[]) => T): T | undefined`
  - Get a service by type (returns undefined if not found)

- `getServices(): TokenRingService[]`
  - Get all registered services

- `waitForService<T>(serviceType: abstract new (...args: any[]) => T, callback: (service: T) => Promise<void> | void): void`
  - Wait for a service to become available

##### Configuration
- `getConfigSlice<T extends { parse: (any: any) => any }>(key: string, schema: T): z.output<T>`
  - Get validated config slice using Zod schema

##### Logging
- `serviceOutput(...messages: any[]): void`
  - Log system messages with formatted output

- `serviceError(...messages: any[]): void`
  - Log error messages with formatted output

##### Promise Management
- `trackPromise(initiator: (signal: AbortSignal) => Promise<void>): void`
  - Track an app-level promise and log any errors

##### Scheduling
- `scheduleEvery(interval: number, callback: () => Promise<void>, signal?: AbortSignal): void`
  - Schedule a recurring task with interval

##### Lifecycle
- `shutdown(): void`
  - Stop the application

- `run(): Promise<void>`
  - Start the application services

### PluginManager

Manages plugin installation and lifecycle.

#### Methods
- `installPlugins(plugins: TokenRingPlugin[]): Promise<void>`
  - Install plugins with configuration validation

- `getPlugins(): TokenRingPlugin[]`
  - Get all installed plugins

### StateManager

Type-safe state management with serialization support.

#### Methods
- `initializeState<StateClass, Props>(StateClass: new (props: Props) => StateClass, props: Props): void`
  - Initialize a state slice

- `getState<StateClass>(StateClass: new (...args: any[]) => StateClass): StateClass`
  - Get a state slice

- `mutateState<R, StateClass>(StateClass: new (...args: any[]) => StateClass, callback: (state: StateClass) => R): R`
  - Mutate state with a callback

## Usage Examples

### Basic Application Setup
```typescript
import TokenRingApp from "@tokenring-ai/app";

const app = new TokenRingApp("./", {
  apiKey: process.env.API_KEY,
  model: "gpt-4"
});
```

### Service Management
```typescript
// Define custom service
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

// Add service to application
app.addServices(new MyService());

// Get service by type
const myService = app.requireService(MyService);
```

### Configuration Validation
```typescript
const apiKey = app.getConfigSlice("apiKey", z.string().min(1));
const model = app.getConfigSlice("model", z.string().default("gpt-3.5-turbo"));
console.log(`Using model: ${model}`);
```

### State Management
```typescript
// Define state class
class UserState implements AgentStateSlice {
  name = "UserState";
  name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  serialize() { return { name: this.name }; }
  deserialize(data: any) { this.name = data.name; }
  show() { return [`User: ${this.name}`]; }
  reset(what: ResetWhat[]) { /* reset logic */ }
}

// Initialize state
const stateManager = new StateManager();
stateManager.initializeState(UserState, new UserState("John"));

// Update state
stateManager.mutateState(UserState, (state) => {
  state.name = "Jane";
});
```

### Scheduled Tasks
```typescript
// Schedule a task that runs every 5 seconds
app.scheduleEvery(5000, async () => {
  console.log("Running scheduled task");
});
```

## Configuration

### Application Configuration Schema

```typescript
export const TokenRingAppConfigSchema = z.record(z.string(), z.unknown());
export type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;
```

### Plugin Configuration

Plugins can define their own configuration schemas:

```typescript
const MyPluginConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().default('gpt-3.5-turbo')
});

const myPlugin = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "My custom plugin with config",
  config: MyPluginConfigSchema,
  install(app, config) {
    console.log(`Installing with API key: ${config.apiKey}`);
  },
  start(app, config) {
    console.log(`Starting with model: ${config.model}`);
  }
};
```

## API Reference

### TokenRingApp

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `addServices(...services: TokenRingService[])` | Register services with application | Array of services | void |
| `requireService<T>(serviceType: abstract new (...args: any[]) => T)` | Get service by type (throws if not found) | Service type | T |
| `getService<T>(serviceType: abstract new (...args: any[]) => T)` | Get service by type (returns undefined if not found) | Service type | T &#124; undefined |
| `waitForService<T>(serviceType, callback)` | Wait for service to be available | Service type, callback function | void |
| `getConfigSlice<T>(key, schema)` | Get validated config slice | Config key, Zod schema | Zod output type |
| `serviceOutput(...messages)` | Log system messages | Messages | void |
| `serviceError(...messages)` | Log error messages | Messages | void |
| `trackPromise(initiator)` | Track promise and log errors | Promise initiator function | void |
| `scheduleEvery(interval, callback, signal)` | Schedule recurring task | Interval (ms), callback, AbortSignal | void |
| `shutdown()` | Stop the application | None | void |
| `run()` | Start application services | None | Promise<void> |

### PluginManager

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `installPlugins(plugins)` | Install plugins with validation | Array of plugins | Promise<void> |
| `getPlugins()` | Get all installed plugins | None | TokenRingPlugin[] |

### StateManager

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `initializeState<StateClass, Props>(StateClass, props)` | Initialize state slice | State class, props | void |
| `getState<StateClass>(StateClass)` | Get state slice | State class | StateClass |
| `mutateState<R, StateClass>(StateClass, callback)` | Mutate state with callback | State class, callback function | R |

## Error Handling

The application provides comprehensive error handling:

- **Configuration Errors**: Zod validation errors with descriptive messages
- **Service Not Found**: Clear error when requiring a service that doesn't exist
- **Promise Errors**: Automatic logging of unhandled promise rejections
- **Lifecycle Errors**: Graceful shutdown handling during startup failures
- **State Errors**: Safe deserialization with validation

## Integration

The app package integrates with other TokenRing components:

### Plugin Integration

```typescript
// Register plugins with configuration
app.registerPlugin(myPlugin);
```

### Agent Integration

```typescript
// Access app services from agent
const appService = agent.requireServiceByType(TokenRingApp);
```

### Chat Service Integration

```typescript
// Use app services in chat commands
const model = app.getConfigSlice("model", z.string());
```

## Development

### Testing

```bash
bun test
bun test:coverage
```

### Building

```bash
bun run build
```

### Contribution Guidelines

- Follow established coding patterns
- Write unit tests for new functionality
- Ensure Zod schema validation for all configuration
- Update documentation for new features
- Test with multiple service configurations

## Dependencies

- `@tokenring-ai/agent` ^0.2.0
- `@tokenring-ai/utility` ^0.2.0
- `zod` ^latest

## License

MIT License - Copyright (c) 2025 Mark Dierolf