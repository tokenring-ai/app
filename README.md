# @tokenring-ai/app

## Overview

Base application framework for TokenRing applications, providing service management, plugin architecture, and state management through a unified interface. The package serves as the foundational infrastructure for building modular, extensible TokenRing applications with comprehensive lifecycle management.

## Features

- **Service-Oriented Architecture**: Organizes functionality into configurable services with registry-based management
- **Plugin-Based Extensions**: Seamless integration with plugin system for modular functionality
- **Type-Safe Configuration**: Zod-based validation for all configuration schemas with layered config loading
- **Lifecycle Management**: Controlled initialization, startup, and shutdown processes with automatic service restart on error
- **State Isolation**: Separate state slices with serialization and deserialization support
- **Signal-Based Shutdown**: Graceful termination using AbortSignal
- **Background Task Management**: Automatic error handling for async background tasks
- **Comprehensive Logging**: Structured output for system messages and errors with service context
- **Async State Subscriptions**: Support for async state observation with abort handling
- **Service Auto-Restart**: Services that exit unexpectedly are automatically restarted after 5 seconds
- **Session Tracking**: Each app instance has a unique session ID for tracking and debugging

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

| Parameter        | Type               | Description                                  |
|------------------|--------------------|----------------------------------------------|
| packageDirectory | string             | Path to the application directory            |
| config           | TokenRingAppConfig | Application configuration as key-value pairs |

#### Properties

| Property         | Type                            | Description                         |
|------------------|---------------------------------|-------------------------------------|
| config           | TokenRingAppConfig              | The application configuration       |
| packageDirectory | string                          | Path to the application directory   |
| logs             | LogEntry[]                      | Array of logged system messages     |
| sessionId        | string                          | Unique session ID for this instance |
| services         | TypedRegistry<TokenRingService> | Registry of all registered services |
| abortController  | AbortController                 | Internal abort controller for shutdown |

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
  callback: (service: T) => void
): void
```
Wait for a service to become available. The callback is invoked when the service is registered.

##### Logging

```typescript
serviceOutput(service: TokenRingService, ...messages: any[]): void
```
Log system messages with formatted output. Messages are prefixed with the service name.

```typescript
serviceError(service: TokenRingService, ...messages: any[]): void
```
Log error messages with formatted output. Messages are prefixed with the service name and logged at error level.

##### Background Task Management

```typescript
runBackgroundTask(service: TokenRingService, initiator: (signal: AbortSignal) => Promise<void>): void
```
Track an app-level promise and log any errors that occur. The task runs in the background and errors are automatically logged to the service.

##### Configuration

```typescript
getConfigSlice<T extends { parse: (any: any) => any }>(key: string, schema: T): z.output<T>
```
Get a validated config slice using a Zod schema. Throws if the key doesn't exist or validation fails.

##### Lifecycle

```typescript
shutdown(reason: string = "App shutdown for unknown reason"): void
```
Stop the application by aborting the internal AbortController. Accepts an optional reason string.

```typescript
async run(): Promise<void>
```
Start all registered services and run the application lifecycle:
1. Calls `start()` on all registered services
2. Runs `run()` on all services that have it in a loop
   - If a service exits unexpectedly, it logs an error and restarts after 5 seconds
   - If a service throws an error, it logs the error and restarts after 5 seconds
   - Services continue running until the abort signal is triggered
3. Calls `stop()` on all registered services when shutdown

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
Mutate state with a callback. Returns the callback result. Automatically notifies all subscribers after mutation.

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
Deserialize state slices. Unknown keys trigger the onMissing callback. Validates data against serialization schema.

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
Subscribe to state changes. Returns an unsubscribe function. The callback is invoked immediately via `queueMicrotask` with the current state.

```typescript
waitForState<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  predicate: (state: T) => boolean
): Promise<T>
```
Wait for a state predicate to become true. Returns a promise that resolves when the predicate is satisfied.

```typescript
timedWaitForState<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  predicate: (state: T) => boolean,
  timeoutMs: number
): Promise<T>
```
Wait for a state predicate with timeout. Rejects with an error if the timeout is exceeded.

```typescript
subscribeAsync<T extends SerializableStateSlice>(
  StateClass: new (...args: any[]) => T,
  signal: AbortSignal
): AsyncGenerator<T, void, unknown>
```
Async generator that yields state updates until aborted. Buffers state updates and yields them one at a time.

### PluginManager

Manages plugin installation and lifecycle. Implements `TokenRingService`.

#### Constructor

```typescript
constructor(app: TokenRingApp)
```
Creates a new PluginManager and automatically registers it as a service with the provided app.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| name | "PluginManager" | Service name |
| description | "Manages plugins" | Service description |

#### Methods

```typescript
getPlugins(): TokenRingPlugin<ZodObject>[]
```
Get all installed plugins.

```typescript
async installPlugins(plugins: TokenRingPlugin<any>[]): Promise<void>
```
Install plugins with configuration validation. The process is:
1. Call `install()` on all plugins (if defined)
2. Register all plugins
3. Call `start()` on all plugins (if defined)

Errors during installation prevent plugin registration. Errors during startup also prevent the plugin from being considered successfully installed.

```typescript
async reconfigurePlugins(newConfig: TokenRingAppConfig): Promise<{ restartRequired: boolean }>
```
Reconfigure all plugins with new application configuration. The process is:
1. For each plugin with configuration, compare the current config slice with the new config slice
2. If the config changed and the plugin has a `reconfigure()` method, call it
3. If the config changed but the plugin doesn't support reconfiguration, set `restartRequired` to true

Returns `{ restartRequired: boolean }` indicating whether any plugins require a restart.

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

| Parameter        | Type                  | Description                                         |
|------------------|-----------------------|-----------------------------------------------------|
| workingDirectory | string                | Path to source/working directory                    |
| dataDirectory    | string                | Path to data directory                              |
| configFileName   | string                | Base name of config files (without extension)       |
| configSchema     | ConfigSchema          | Zod schema for validation                           |
| defaultConfig    | z.input<ConfigSchema> | Default configuration                               |
| mergeConfig      | function              | Optional config merge function (default: deepMerge) |

**Config Loading Order**: Config files are loaded from `~` (home) and `dataDirectory` in that order, with extensions `.ts`, `.mjs`, `.cjs`, `.js`. The config is validated at each step to ensure it is complete and well-formed.

**Additional Behavior**:
- Creates the data directory if it doesn't exist
- Creates a `.gitignore` file in the data directory if it doesn't exist (with `*.sqlite*` pattern)
- Merges configs using `deepMerge` or custom merge function
- Validates the merged config at each step

## Types

### TokenRingService

Interface for services that can be registered with the application.

```typescript
interface TokenRingService {
  readonly name: string;
  description: string;
  run?(signal: AbortSignal): Promise<void>;
  start?(signal: AbortSignal): Promise<void> | void;
  stop?(): Promise<void> | void;
  attach?(agent: Agent, creationContext: AgentCreationContext): void;
  detach?(agent: Agent): void;
}
```

| Method | Description |
|--------|-------------|
| `name` | Unique service name |
| `description` | Human-readable service description |
| `run` | Main service loop. Called after `start()`. Exited services are automatically restarted after 5 seconds |
| `start` | Initialization logic. Called before `run()` |
| `stop` | Cleanup logic. Called during shutdown |
| `attach` | Attach to an agent with creation context |
| `detach` | Detach from an agent |

### TokenRingPlugin

There are two types of plugins:

#### Simple Plugin (no config)

```typescript
{
  readonly name: string;
  version: string;
  description: string;
  install?: (app: TokenRingApp) => void; // Install does not allow awaiting, anything awaited must be done in start
  start?: (app: TokenRingApp) => Promise<void> | void;
}
```

#### Plugin with Configuration

```typescript
{
  readonly name: string;
  version: string;
  description: string;
  config: ConfigType;  // Zod schema
  install?: (app: TokenRingApp, config: z.output<ConfigType>) => void;
  start?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
  reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => Promise<void> | void;
}
```

**Important Notes**:
- `install()` cannot be awaited. Any async operations must be done in `start()`
- `start()` is called after all plugins are installed
- `reconfigure()` is called when plugin configuration changes and the plugin supports reconfiguration

### SerializableStateSlice

Interface for state slices that can be serialized and deserialized.

```typescript
interface SerializableStateSlice<SerializationSchema> {
  readonly name: string;
  serialize: () => z.input<SerializationSchema>;
  deserialize: (data: z.output<SerializationSchema>) => void;
  serializationSchema: SerializationSchema;
}
```

### StateStorageInterface

Interface for state storage implementations.

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

console.log(app.sessionId); // Unique session ID for this instance
```

### Service Management

```typescript
import TokenRingApp, { TokenRingService } from "@tokenring-ai/app";

class MyService implements TokenRingService {
  name = "MyService";
  description = "A custom service";

  async start(signal: AbortSignal) {
    console.log("MyService starting");
  }

  async run(signal: AbortSignal) {
    console.log("MyService running");
    while (!signal.aborted) {
      // Do work
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async stop() {
    console.log("MyService stopping");
  }

  doSomething() {
    return "Service result";
  }
}

// Add service to application
app.addServices(new MyService());

// Get service by type
const myService = app.requireService(MyService);

// Start the application
await app.run();
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
    // Note: Cannot await here, use start() for async operations
  },
  start(app, config) {
    console.log(`Starting with model: ${config.model}`);
  },
  reconfigure(app, config) {
    console.log(`Reconfiguring with model: ${config.model}`);
  }
};

// Add plugin to application via PluginManager
const pluginManager = new PluginManager(app);
await pluginManager.installPlugins([myPlugin]);
```

### State Management

```typescript
import StateManager from "@tokenring-ai/app/StateManager";
import type { SerializableStateSlice } from "@tokenring-ai/app/StateManager";
import { z } from "zod";

const serializationSchema = z.object({
  data: z.string(),
});

interface UserState extends SerializableStateSlice<typeof serializationSchema> {
  name: string;
  email: string;
}

class UserStateSlice implements UserState {
  readonly name = "UserState";
  serializationSchema = serializationSchema;
  email: string;

  constructor(public name: string, email: string) {
    this.email = email;
  }

  serialize() {
    return { name: this.name, email: this.email };
  }

  deserialize(data: z.output<typeof serializationSchema>) {
    this.name = data.name;
    this.email = data.email;
  }
}

// Initialize state
const stateManager = new StateManager<UserState>();
stateManager.initializeState(
  UserStateSlice,
  { name: "John", email: "john@example.com" }
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
const signal = new AbortController().signal;
const stateStream = stateManager.subscribeAsync(UserStateSlice, signal);
for await (const state of stateStream) {
  console.log("New state:", state);
}

// Wait for state predicate
await stateManager.waitForState(UserStateSlice, (state) => state.name === "Jane");

// Wait for state predicate with timeout
try {
  await stateManager.timedWaitForState(UserStateSlice, (state) => state.name === "Jane", 5000);
} catch (error) {
  console.log("Timeout waiting for state");
}

// Iterate over state entries
for (const [key, slice] of stateManager.entries()) {
  console.log(`State: ${key}`, slice);
}
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

### Plugin Manager Usage

```typescript
import PluginManager from "@tokenring-ai/app/PluginManager";
import type { TokenRingPlugin } from "@tokenring-ai/app";

const pluginManager = new PluginManager(app);

const myPlugin: TokenRingPlugin = {
  name: "MyPlugin",
  version: "1.0.0",
  description: "Custom plugin",
  install(app) {
    // Set up plugin (cannot await)
  },
  start(app) {
    // Start plugin (can await)
  }
};

await pluginManager.installPlugins([myPlugin]);

// Get all installed plugins
const plugins = pluginManager.getPlugins();
```

### Plugin Reconfiguration

```typescript
import { z } from "zod";
import type { TokenRingPlugin } from "@tokenring-ai/app";

const MyPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  models: z.array(z.string()).default([])
});

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

// Add plugin via PluginManager
await pluginManager.installPlugins([myPlugin]);

// Later, when app config changes:
const { restartRequired } = await pluginManager.reconfigurePlugins(newAppConfig);
if (restartRequired) {
  console.log("Some plugins require restart");
}
```

### Background Task Management

```typescript
import TokenRingApp, { TokenRingService } from "@tokenring-ai/app";

class BackgroundService implements TokenRingService {
  name = "BackgroundService";
  description = "Runs background tasks";

  run(signal: AbortSignal) {
    // Run a background task that will be tracked
    app.runBackgroundTask(this, async (signal) => {
      while (!signal.aborted) {
        const result = await longRunningOperation();
        processResult(result);
      }
    });
  }
}

const app = new TokenRingApp("/path", {});
app.addServices(new BackgroundService());

// Errors in background tasks are automatically logged
```

### Service Auto-Restart

```typescript
import TokenRingApp, { TokenRingService } from "@tokenring-ai/app";

class UnstableService implements TokenRingService {
  name = "UnstableService";
  description = "Service that may exit unexpectedly";

  async run(signal: AbortSignal) {
    // If this exits without error, it will restart after 5 seconds
    // If this throws an error, it will restart after 5 seconds
    // Services continue restarting until shutdown is called
    await doWork();
  }
}

const app = new TokenRingApp("/path", {});
app.addServices(new UnstableService());

// The service will automatically restart if it exits unexpectedly
await app.run();
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

| Method                                      | Description                                          |
|---------------------------------------------|------------------------------------------------------|
| `addServices(...services)`                  | Register services with application                   |
| `requireService(serviceType)`               | Get service by type (throws if not found)            |
| `getService(serviceType)`                   | Get service by type (returns undefined if not found) |
| `getServices()`                             | Get all registered services                          |
| `waitForService(serviceType, callback)`     | Wait for service to be available                     |
| `getConfigSlice(key, schema)`               | Get validated config slice                           |
| `serviceOutput(service, ...messages)`       | Log system messages with service context             |
| `serviceError(service, ...messages)`        | Log error messages with service context              |
| `runBackgroundTask(service, initiator)`     | Track background task and log errors                 |
| `shutdown(reason?)`                         | Stop the application with optional reason            |
| `run()`                                     | Start application services and run lifecycle         |

### StateManager

| Method                                              | Description                |
|-----------------------------------------------------|----------------------------|
| `initializeState(StateClass, props)`                | Initialize state slice     |
| `getState(StateClass)`                              | Get state slice            |
| `mutateState(StateClass, callback)`                 | Mutate state with callback |
| `serialize()`                                       | Serialize all state slices |
| `deserialize(data, onMissing)`                      | Deserialize state slices   |
| `forEach(cb)`                                       | Iterate over state slices  |
| `entries()`                                         | Get [key, value] iterator  |
| `subscribe(StateClass, callback)`                   | Subscribe to changes       |
| `waitForState(StateClass, predicate)`               | Wait for state predicate   |
| `timedWaitForState(StateClass, predicate, timeout)` | Wait with timeout          |
| `subscribeAsync(StateClass, signal)`                | Async state generator      |

### PluginManager

| Method                          | Description                     |
|---------------------------------|---------------------------------|
| `installPlugins(plugins)`       | Install plugins with validation |
| `getPlugins()`                  | Get all installed plugins       |
| `reconfigurePlugins(newConfig)` | Reconfigure all plugins         |

### buildTokenRingAppConfig

| Parameter          | Description                                         |
|--------------------|-----------------------------------------------------|
| `workingDirectory` | Path to source/working directory                    |
| `dataDirectory`    | Path to data directory                              |
| `configFileName`   | Base name of config files (without extension)       |
| `configSchema`     | Zod schema for validation                           |
| `defaultConfig`    | Default configuration                               |
| `mergeConfig`      | Optional config merge function (default: deepMerge) |

## Error Handling

The application provides comprehensive error handling:

- **Configuration Errors**: Zod validation errors with descriptive messages when config is invalid
- **Service Not Found**: Clear error when requiring a service that doesn't exist via `requireService()`
- **Promise Errors**: Automatic logging of errors in background tasks via `runBackgroundTask()`
- **Lifecycle Errors**: Graceful shutdown handling during startup failures; services that exit unexpectedly are restarted after 5 seconds
- **State Errors**: Safe deserialization with error callbacks for unknown keys; schema validation on deserialize
- **Plugin Errors**: Errors during plugin installation prevent plugin registration; errors during startup also prevent successful installation

## Integration

### Service Registration

Services are registered with the application using the `addServices` method:

```typescript
import { TokenRingService } from "@tokenring-ai/app";

class MyService implements TokenRingService {
  name = "MyService";
  description = "A custom service";

  async start(signal: AbortSignal) {
    // Initialization
  }

  async run(signal: AbortSignal) {
    // Main loop
  }

  async stop() {
    // Cleanup
  }
}

app.addServices(new MyService());
```

### State Serialization

```typescript
import fs from "node:fs";

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

app.runBackgroundTask(service, async (signal) => {
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
import { z } from "zod";
import type { TokenRingPlugin } from "@tokenring-ai/app";

const MyPluginSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional()
});

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

await pluginManager.installPlugins([myPlugin]);

// Later, when app config changes:
const { restartRequired } = await pluginManager.reconfigurePlugins(newAppConfig);
if (restartRequired) {
  console.log("Some plugins require restart");
}
```

### Service Attach/Detach

Services can optionally implement `attach` and `detach` methods to integrate with agents:

```typescript
import type { TokenRingService } from "@tokenring-ai/app";
import type { Agent, AgentCreationContext } from "@tokenring-ai/agent";

class AgentAwareService implements TokenRingService {
  name = "AgentAwareService";
  description = "Service that integrates with agents";

  attach(agent: Agent, creationContext: AgentCreationContext) {
    // Attach to agent during creation
  }

  detach(agent: Agent) {
    // Detach from agent
  }
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
- Write unit tests for new functionality using vitest
- Ensure Zod schema validation for all configuration
- Update documentation for new features
- Test with multiple service configurations

## License

MIT License - see [LICENSE](./LICENSE) file for details.
