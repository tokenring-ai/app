# @tokenring-ai/app

## Overview

Base application framework for TokenRing applications, providing service management, plugin architecture, and state management through a unified interface. The package serves as the foundational infrastructure for building modular, extensible TokenRing applications with comprehensive lifecycle management.

## Features

- **Service-Oriented Architecture**: Organizes functionality into configurable services with registry-based management
- **Plugin-Based Extensions**: Seamless integration with plugin system for modular functionality
- **Type-Safe Configuration**: Zod-based validation for all configuration schemas with layered config loading
- **Lifecycle Management**: Controlled initialization, startup, and shutdown processes
- **State Isolation**: Separate state slices with serialization and deserialization support
- **Signal-Based Shutdown**: Graceful termination using AbortSignal
- **Promise Tracking**: Automatic error handling for async operations
- **Scheduled Tasks**: Built-in task scheduling for recurring operations
- **Comprehensive Logging**: Structured output for system messages and errors
- **Async State Subscriptions**: Support for async state observation with abort handling

## Installation

```bash
bun install @tokenring-ai/app
```

## Core Components

### TokenRingApp

The main application class that orchestrates services, configuration, and lifecycle management.

#### Constructor

```typescript
constructor(readonly packageDirectory: string, readonly config: TokenRingAppConfig)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| packageDirectory | string | Path to the application directory |
| config | TokenRingAppConfig | Application configuration as key-value pairs |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| config | TokenRingAppConfig | The application configuration |
| packageDirectory | string | Path to the application directory |
| logs | LogEntry[] | Array of logged system messages |
| services | TypedRegistry<TokenRingService> | Registry of all registered services |

#### Methods

##### Service Management

```typescript
addServices(...services: TokenRingService[]): void
```
Register services with the application. Services are automatically initialized in registration order.

```typescript
requireService<T>(serviceType: abstract new (...args: any[]) => T): T
```
Get a service by type. Throws an error if the service is not found.

```typescript
getService<T>(serviceType: abstract new (...args: any[]) => T): T | undefined
```
Get a service by type. Returns undefined if the service is not found.

```typescript
getServices(): TokenRingService[]
```
Get all registered services.

```typescript
waitForService<T extends TokenRingService>(
  serviceType: abstract new (...args: any[]) => T,
  callback: (service: R) => void
): void
```
Wait for a service to become available. The callback is invoked when the service is registered.

##### Logging

```typescript
serviceOutput(...messages: any[]): void
```
Log system messages with formatted output.

```typescript
serviceError(...messages: any[]): void
```
Log error messages with formatted output.

##### Promise Management

```typescript
trackPromise(initiator: (signal: AbortSignal) => Promise<void>): void
```
Track an app-level promise and log any errors that occur.

##### Scheduling

```typescript
scheduleEvery(
  interval: number,
  callback: () => Promise<void>,
  signal?: AbortSignal
): void
```
Schedule a recurring task with a specified interval. The task runs until aborted.

##### Configuration

```typescript
getConfigSlice<T extends { parse: (any: any) => any }>(key: string, schema: T): z.output<T>
```
Get a validated config slice using a Zod schema. Throws if the key doesn't exist or validation fails.

##### Lifecycle

```typescript
shutdown(): void
```
Stop the application by aborting the internal AbortController.

```typescript
run(): Promise<void>
```
Start all registered services. Returns a promise that resolves when all services complete or the abort signal is triggered.

### StateManager

Type-safe state management with serialization support.

#### Constructor

```typescript
constructor()
```

#### Methods

```typescript
initializeState<S, T extends SerializableStateSlice>(
  StateClass: new (props: S) => T,
  props: S
): void
```
Initialize a state slice with the given class and props.

```typescript
getState<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T
): T
```
Get a state slice by class. Throws if not initialized.

```typescript
mutateState<R, T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  callback: (state: T) => R
): R
```
Mutate state with a callback. Returns the callback result.

```typescript
serialize(): Record<string, object>
```
Serialize all state slices to a record.

```typescript
deserialize(
  data: Record<string, object>,
  onMissing?: (key: string) => void
): void
```
Deserialize state slices. Unknown keys trigger the onMissing callback.

```typescript
forEach(cb: (item: SerializableStateSlice) => void): void
```
Iterate over all state slices.

```typescript
entries(): IterableIterator<[string, SerializableStateSlice]>
```
Get an iterator of [key, value] pairs for all state slices.

```typescript
subscribe<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  callback: (state: T) => void
): () => void
```
Subscribe to state changes. Returns an unsubscribe function.

```typescript
waitForState<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  predicate: (state: T) => boolean
): Promise<T>
```
Wait for a state predicate to become true.

```typescript
timedWaitForState<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  predicate: (state: T) => boolean,
  timeoutMs: number
): Promise<T>
```
Wait for a state predicate with timeout.

```typescript
subscribeAsync<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  signal: AbortSignal
): AsyncGenerator<T, void, unknown>
```
Async generator that yields state updates until aborted.

### PluginManager

Manages plugin installation and lifecycle. Implements `TokenRingService`.

#### Constructor

```typescript
constructor(app: TokenRingApp)
```

#### Methods

```typescript
getPlugins(): TokenRingPlugin<unknown>[]
```
Get all installed plugins.

```typescript
async installPlugins(plugins: TokenRingPlugin<any>[]): Promise<void>
```
Install plugins with configuration validation. All plugins are installed first, then started. Errors during installation prevent plugin registration.

```typescript
async reconfigurePlugins(newConfig: TokenRingAppConfig): Promise<{ restartRequired: boolean }>
```
Reconfigure all plugins with new application configuration. Plugins with `reconfigure` methods are updated if their config changed. Plugins without reconfiguration support require a restart.

### buildTokenRingAppConfig

```typescript
async function buildTokenRingAppConfig<ConfigSchema extends ZodObject>({
  workingDirectory,
  dataDirectory,
  configFileName,
  configSchema,
  defaultConfig,
  mergeConfig
}: CreateTokenRingAppOptions<ConfigSchema>): Promise<z.output<ConfigSchema>>
```

Build application configuration by loading from multiple locations with Zod validation.

| Parameter | Type | Description |
|-----------|------|-------------|
| workingDirectory | string | Path to source/working directory |
| dataDirectory | string | Path to data directory |
| configFileName | string | Base name of config files (without extension) |
| configSchema | ConfigSchema | Zod schema for validation |
| defaultConfig | z.input<ConfigSchema> | Default configuration |
| mergeConfig | function | Optional config merge function (default: deepMerge) |

**Config Loading Order:** Config files are loaded from `~` (home) and `dataDirectory` in that order, with extensions `.ts`, `.mjs`, `.cjs`, `.js`.

## Types

### TokenRingService

```typescript
interface TokenRingService {
  name: string;
  description: string;

  run?(signal: AbortSignal): Promise<void> | void;
  attach?(agent: Agent): void;
  detach?(agent: Agent): void;
}
```

### TokenRingPlugin

```typescript
type TokenRingPlugin<ConfigType> = {
  name: string;
  version: string;
  description: string;
  install?: (app: TokenRingApp) => void | undefined; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp) => Promise<void> | void;
} | {
  name: string;
  version: string;
  description: string;
  config: ConfigType;
  install?: (app: TokenRingApp, config: z.output<ConfigType>) => void | undefined; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
  reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
};
```

### SerializableStateSlice

```typescript
interface SerializableStateSlice {
  name: string;
  serialize(): object;
  deserialize(data: object): void;
}
```

### StateStorageInterface

```typescript
interface StateStorageInterface<T extends SerializableStateSlice<any>> {
  getState<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T): T;

  mutateState<R, T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    callback: (state: T) => R,
  ): R;

  initializeState<S, T extends SpecificStateSliceType>(
    ClassType: new (props: S) => T,
    props: S,
  ): void;
}
```

### TokenRingAppConfig

```typescript
export const TokenRingAppConfigSchema = z.record(z.string(), z.unknown());
export type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;
```

### LogEntry

```typescript
type LogEntry = {
  timestamp: number;
  level: "info" | "error";
  message: string;
};
```

## Usage Examples

### Basic Application Setup

```typescript
import TokenRingApp from "@tokenring-ai/app";

const app = new TokenRingApp("/path/to/app", {
  apiKey: process.env.API_KEY,
  model: "gpt-4"
});
```

### Service Management

```typescript
import TokenRingApp, { TokenRingService } from "@tokenring-ai/app";

class MyService implements TokenRingService {
  name = "MyService";
  description = "A custom service";

  async run(signal: AbortSignal) {
    console.log("MyService started");
    signal.addEventListener("abort", () => {
      console.log("MyService stopped");
    });
  }

  doSomething() {
    return "Service result";
  }
}

// Add service to application
app.addServices(new MyService());

// Get service by type
const myService = app.requireService(MyService);
```

### Plugin with Configuration

```typescript
import { z } from "zod";
import type { TokenRingPlugin } from "@tokenring-ai/app";

const MyPluginConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().default("gpt-3.5-turbo")
});

const myPlugin: TokenRingPlugin<typeof MyPluginConfigSchema> = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "My custom plugin with config",
  config: MyPluginConfigSchema,
  install(app, config) {
    console.log(`Installing with API key: ${config.apiKey}`);
  },
  start(app, config) {
    console.log(`Starting with model: ${config.model}`);
  },
  reconfigure(app, config) {
    console.log(`Reconfiguring with model: ${config.model}`);
  }
};

// Services can be registered directly
app.addServices(myPlugin);
```

### State Management

```typescript
import StateManager from "@tokenring-ai/app/StateManager";
import type { SerializableStateSlice } from "@tokenring-ai/app/StateManager";

interface UserState extends SerializableStateSlice {
  name: string;
  email: string;
}

class UserStateSlice implements UserState {
  name = "UserState";
  name: string;
  email: string;

  constructor(props: { name: string; email: string }) {
    this.name = props.name;
    this.email = props.email;
  }

  serialize() {
    return { name: this.name, email: this.email };
  }

  deserialize(data: object) {
    this.name = (data as UserState).name;
    this.email = (data as UserState).email;
  }
}

// Initialize state
const stateManager = new StateManager<UserState>();
stateManager.initializeState(
  UserStateSlice,
  new UserStateSlice({ name: "John", email: "john@example.com" })
);

// Update state
const result = stateManager.mutateState(UserStateSlice, (state) => {
  state.name = "Jane";
  return state.name;
});

console.log(result); // "Jane"

// Subscribe to changes
const unsubscribe = stateManager.subscribe(UserStateSlice, (state) => {
  console.log("State changed:", state);
});

// Async state observation
const stateStream = stateManager.subscribeAsync(UserStateSlice, signal);
for await (const state of stateStream) {
  console.log("New state:", state);
}
```

### Scheduled Tasks

```typescript
// Schedule a task that runs every 5 seconds
app.scheduleEvery(5000, async () => {
  const result = await fetchData();
  console.log("Scheduled task result:", result);
});

// The task can be stopped by shutting down the app
app.shutdown();
```

### Build Config from Files

```typescript
import buildTokenRingAppConfig from "@tokenring-ai/app/buildTokenRingAppConfig";
import { z } from "zod";

const AppConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().default("gpt-4")
});

const config = await buildTokenRingAppConfig({
  workingDirectory: "/path/to/app",
  dataDirectory: "/path/to/data",
  configFileName: "app.config",
  configSchema: AppConfigSchema,
  defaultConfig: {
    apiKey: "",
    model: "gpt-3.5-turbo"
  }
});
```

### Plugin Configuration

```typescript
import PluginManager from "@tokenring-ai/app/PluginManager";
import type { TokenRingPlugin } from "@tokenring-ai/app";

const pluginManager = new PluginManager(app);

const myPlugin: TokenRingPlugin = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "Custom plugin",
  install(app) {
    // Set up plugin
  },
  start(app) {
    // Start plugin
  }
};

await pluginManager.installPlugins([myPlugin]);
```

### Plugin Reconfiguration

```typescript
const myPlugin: TokenRingPlugin<typeof MyPluginConfigSchema> = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "Plugin with reconfiguration support",
  config: MyPluginConfigSchema,
  install(app, config) {
    // Initial setup
  },
  start(app, config) {
    // Start service
  },
  reconfigure(app, config) {
    // Handle config changes
  }
};

app.addServices(myPlugin);

// Later, when app config changes:
const { restartRequired } = await pluginManager.reconfigurePlugins(newAppConfig);
if (restartRequired) {
  console.log("Some plugins require restart");
}
```

## Configuration

### Application Configuration Schema

```typescript
const TokenRingAppConfigSchema = z.record(z.string(), z.unknown());
type TokenRingAppConfig = z.infer<typeof TokenRingAppConfigSchema>;
```

### Plugin Configuration Schema

```typescript
const MyPluginSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  models: z.array(z.string()).default([])
});

const myPlugin: TokenRingPlugin<typeof MyPluginSchema> = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "Plugin with config",
  config: MyPluginSchema,
  install(app, config) {
    // Config is already validated
    if (config.enabled) {
      // Initialize plugin
    }
  }
};
```

## API Reference

### TokenRingApp

| Method | Description |
|--------|-------------|
| `addServices(...services)` | Register services with application |
| `requireService(serviceType)` | Get service by type (throws if not found) |
| `getService(serviceType)` | Get service by type (returns undefined if not found) |
| `getServices()` | Get all registered services |
| `waitForService(serviceType, callback)` | Wait for service to be available |
| `getConfigSlice(key, schema)` | Get validated config slice |
| `serviceOutput(...messages)` | Log system messages |
| `serviceError(...messages)` | Log error messages |
| `trackPromise(initiator)` | Track promise and log errors |
| `scheduleEvery(interval, callback, signal)` | Schedule recurring task |
| `shutdown()` | Stop the application |
| `run()` | Start application services |

### StateManager

| Method | Description |
|--------|-------------|
| `initializeState(StateClass, props)` | Initialize state slice |
| `getState(StateClass)` | Get state slice |
| `mutateState(StateClass, callback)` | Mutate state with callback |
| `serialize()` | Serialize all state slices |
| `deserialize(data, onMissing)` | Deserialize state slices |
| `forEach(cb)` | Iterate over state slices |
| `entries()` | Get [key, value] iterator |
| `subscribe(StateClass, callback)` | Subscribe to changes |
| `waitForState(StateClass, predicate)` | Wait for state predicate |
| `timedWaitForState(StateClass, predicate, timeout)` | Wait with timeout |
| `subscribeAsync(StateClass, signal)` | Async state generator |

### PluginManager

| Method | Description |
|--------|-------------|
| `installPlugins(plugins)` | Install plugins with validation |
| `getPlugins()` | Get all installed plugins |
| `reconfigurePlugins(newConfig)` | Reconfigure all plugins |

### buildTokenRingAppConfig

| Parameter | Description |
|-----------|-------------|
| `workingDirectory` | Path to source/working directory |
| `dataDirectory` | Path to data directory |
| `configFileName` | Base name of config files (without extension) |
| `configSchema` | Zod schema for validation |
| `defaultConfig` | Default configuration |
| `mergeConfig` | Optional config merge function (default: deepMerge) |

## Error Handling

The application provides comprehensive error handling:

- **Configuration Errors**: Zod validation errors with descriptive messages
- **Service Not Found**: Clear error when requiring a service that doesn't exist
- **Promise Errors**: Automatic logging of unhandled promise rejections
- **Lifecycle Errors**: Graceful shutdown handling during startup failures
- **State Errors**: Safe deserialization with error callbacks
- **Plugin Errors**: Errors during plugin installation prevent plugin registration

## Integration

### Service Registration

Services are registered with the application using the `addServices` method:

```typescript
import { TokenRingService } from "@tokenring-ai/app";

class MyService implements TokenRingService {
  name = "MyService";
  description = "A custom service";

  async run(signal: AbortSignal) {
    // Service logic
  }
}

app.addServices(new MyService());
```

### State Serialization

```typescript
// Save state
const serialized = stateManager.serialize();
await fs.writeFile("state.json", JSON.stringify(serialized));

// Load state
const data = JSON.parse(await fs.readFile("state.json", "utf-8"));
stateManager.deserialize(data, (key) => {
  console.log(`Unknown state: ${key}`);
});
```

### Abort Signal Handling

```typescript
const app = new TokenRingApp("/path", {});

app.trackPromise(async (signal) => {
  while (!signal.aborted) {
    const result = await longRunningOperation();
    processResult(result);
  }
});

// Stop the app
app.shutdown();
```

### Plugin Reconfiguration

```typescript
const myPlugin: TokenRingPlugin<typeof MyPluginSchema> = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "Plugin with reconfiguration support",
  config: MyPluginSchema,
  install(app, config) {
    // Initial setup
  },
  start(app, config) {
    // Start service
  },
  reconfigure(app, config) {
    // Handle config changes
  }
};

app.addServices(myPlugin);

// Later, when app config changes:
const { restartRequired } = await pluginManager.reconfigurePlugins(newAppConfig);
if (restartRequired) {
  console.log("Some plugins require restart");
}
```

## Development

### Testing

```bash
bun test
bun test:watch
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

## License

MIT License - see [LICENSE](./LICENSE) file for details.
