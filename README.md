# @tokenring-ai/app

Base application framework for TokenRing: service management, layered configuration, plugin lifecycle, typed state management, and debugging snapshots.

## Overview

`@tokenring-ai/app` is the foundation every TokenRing application is built on. `TokenRingApp` owns the service registry and the application lifecycle, exposes the state manager, tracks background tasks, and records structured logs. The package also ships the plugin runtime (`PluginManager`, `TokenRingPlugin`), the layered configuration system (`AppConfigurationState`, `ConfigurationService`, `buildTokenRingAppConfig`), and the debugging snapshot service (`DebugService`) that is registered on every app by default.

The package is a service framework rather than a plugin: it defines no chat commands and no agent tools. Plugins installed into a `TokenRingApp` provide their own commands, tools, hooks, and RPC endpoints.

## Installation

```bash
bun add @tokenring-ai/app
```

## Chat Commands

This package defines no chat commands.

## Tools

This package defines no tools.

## Configuration

The app-level configuration slice is defined by `TokenRingAppConfigSchema.app`. Other top-level config keys belong to installed plugins and are merged into the runtime config by the layered configuration system.

```yaml
app:
  workingDirectory: /home/user/.tokenring
  workspaceDirectory: /home/user/projects/demo
  configDirectories:
    - /home/user/.tokenring/config
  shutdownMonitorIntervalMs: 2000
  serviceRestartDelayMs: 5000
  printLogs: false
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| workingDirectory | string | Yes | – | Base directory that `getWorkingDirectoryResolvedPath()` resolves paths against. |
| workspaceDirectory | string | Yes | – | Base directory that `getWorkspaceResolvedPath()` resolves paths against, and where `DebugService` writes its `debug` folder. |
| configDirectories | string[] | Yes | – | Directories scanned for `**/*.yaml` config files by `buildTokenRingAppConfig` / `buildTokenRingAppConfigLayers`. |
| shutdownMonitorIntervalMs | number | No | 2000 | Interval at which the shutdown monitor reports still-blocking services during shutdown. |
| serviceRestartDelayMs | number | No | 5000 | Delay between a service's `run()` exiting or throwing and its automatic restart. |
| printLogs | boolean | No | false | Accepted by the schema for compatibility; `TokenRingApp` always writes info logs to `console.log` and error logs to `console.error` regardless of this value. |

The app-level schema attaches no `.meta()` annotations. Plugin configuration UI schemas are introspected server-side by `buildConfigUISchema` from each plugin's zod config schema (see ConfigurationService below).

## Core Components

### TokenRingApp

The main application class. It owns the service registry, the state manager, the abort signal, the shutdown monitor, and all log output.

#### Constructor

```typescript
constructor(
  public readonly initialConfig: TokenRingAppConfig,
  overrideLayers?: { globalConfig?: ConfigLayer; workspaceConfig?: ConfigLayer },
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| initialConfig | TokenRingAppConfig | The validated application configuration. |
| overrideLayers | `{ globalConfig?: ConfigLayer; workspaceConfig?: ConfigLayer }` | Optional sparse override layers seeded into `AppConfigurationState`. |

The constructor:

- Sets `appConfig` to `initialConfig.app`.
- Initializes the `AppLogsState` and `AppConfigurationState` state slices.
- Registers a `DebugService` instance, so debugging works on every app regardless of installed plugins.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| sessionId | string | Unique per-instance session id (`generateHumanId`). |
| stateManager | StateManager<AppStateSlice<any>> | State manager holding the app's state slices. |
| initializeState | bound StateManager method | Bound `stateManager.initializeState`. |
| mutateState | bound StateManager method | Bound `stateManager.mutateState`. |
| getState | bound StateManager method | Bound `stateManager.getState`. |
| waitForState | bound StateManager method | Bound `stateManager.waitForState`. |
| subscribeStateAsync | bound StateManager method | Bound `stateManager.subscribeAsync`. |
| timedWaitForState | bound StateManager method | Bound `stateManager.timedWaitForState`. |
| runningServices | Set<TokenRingService> | Services whose `run()` loop is currently executing. |
| stoppingServices | Set<TokenRingService> | Services whose `stop()` is currently executing. |
| backgroundTasks | Map<string, number> | Count of pending background tasks per service name. |
| services | TypedRegistry<TokenRingService> | Registry of all registered services. |
| requireService | bound registry method | `services.requireItemByType`. |
| addService | bound registry method | `services.addOne`. |
| addServices | bound registry method | `services.addMany`. |
| getService | bound registry method | `services.getItemByType`. |
| getServices | bound registry method | `services.getItems`. |
| appConfig | TokenRingAppConfig["app"] | The `app` slice of the initial config. |
| logs | LogEntry[] (getter) | All log entries, combining info and error entries. |
| isShuttingDown | boolean (getter) | True once the internal `AbortController` has been aborted. |

#### Methods

##### Service management

```typescript
requireService<T>(serviceType: abstract new (...args: any[]) => T): T
```

Get a service by its class. Throws when the service is not registered.

```typescript
getService<T>(serviceType: abstract new (...args: any[]) => T): T | undefined
```

Get a service by its class, or `undefined` when not registered.

```typescript
waitForService<R extends TokenRingService>(
  serviceType: abstract new (...args: any[]) => R,
  callback: (service: R) => void,
): void
```

Invoke `callback` immediately when the service is already registered, otherwise when it is registered later.

##### Logging

Log entries are always printed to the console (`console.log` for info, `console.error` for error) and appended to `AppLogsState`.

```typescript
serviceOutput(service: TokenRingService, ...messages: any[]): void
```

Log an info-level entry prefixed with `[<service.name>]`.

```typescript
serviceError(service: TokenRingService, ...messages: any[]): void
```

Log an error-level entry prefixed with `[<service.name>]`.

```typescript
async *subscribeLogsAsync(position: number, signal: AbortSignal): AsyncGenerator<LogEntry, void, unknown>
```

Yield log entries appended after `position`, then continue yielding new entries until `signal` aborts. Entries appended while the generator is suspended at a yield are still delivered on the next iteration (the cursor advances only after the slice is yielded).

##### Background tasks

```typescript
runBackgroundTask(service: TokenRingService, initiator: (signal: AbortSignal) => Promise<void>): void
```

Track an app-level promise under `service.name`. Rejections are logged as error entries via `serviceError`, and completion decrements the count in `backgroundTasks`.

##### State

```typescript
generateStateCheckpoint(): Record<string, object>
```

Serialize every initialized state slice, keyed by slice name.

```typescript
restoreState(state: AppSessionCheckpoint["state"]): void
```

Deserialize a checkpoint into the state manager. Slices registered in the app but missing from the checkpoint log an info message: `Error while restoring state: State slice <name> not found in app checkpoint`.

##### Lifecycle

```typescript
shutdown(reason?: string): void
```

Abort the internal `AbortController` with the given reason (default `"App shutdown for unknown reason"`) and log `Shutting down: <reason>`. Safe to call multiple times; only the first call acts.

```typescript
async run(): Promise<void>
```

Run the application lifecycle:

1. Call `start(signal)` on every registered service that defines it.
2. Run every service's `run(signal)` in a loop, concurrently:
   - If `run()` returns without error while not aborted, log `Exited unexpectedly. Restarting in <delay>s...`.
   - If `run()` throws while not aborted, log `Died with error: <error> Restarting in <delay>s...`.
   - Between restarts wait `serviceRestartDelayMs`; the loop stops when the abort signal fires.
3. If a start or run error occurs it is captured and shutdown is triggered.
4. Stop every registered service that defines `stop()`, then re-throw: the captured run error first, then a single stop error as-is, or multiple stop errors as an `AggregateError` (`"Multiple services failed to stop cleanly"`).

During shutdown a monitor (a fire-and-forget, unref'd timer) writes a status line to `process.stdout` every `shutdownMonitorIntervalMs` listing the services and background tasks still blocking shutdown.

```typescript
getWorkingDirectoryResolvedPath(pathToResolve: string): string
```

Resolve a path against `appConfig.workingDirectory` with `path.resolve`.

```typescript
getWorkspaceResolvedPath(pathToResolve: string): string
```

Resolve a path against `appConfig.workspaceDirectory` with `path.resolve`.

### StateManager

Typed state management with serialization, subscriptions, and async observation. State slices are keyed by their class.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| state | EnhancedMap<new (...args: any[]) => SpecificStateSliceType, SpecificStateSliceType> | Map of initialized slices keyed by class. |

#### Methods

```typescript
initializeState<S, T extends SpecificStateSliceType>(ClassType: new (props: S) => T, props: S): Readonly<T>
```

Instantiate `ClassType` with `props` and register it. If the `startingState` passed to the constructor contains data under the slice's `name`, it is deserialized (validated with the slice's `serializationSchema`).

```typescript
getState<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T): Readonly<T>
```

Get a slice. Throws `State slice <name> not found` when it has not been initialized.

```typescript
mutateState<R, T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T, callback: (state: T) => R): Readonly<R>
```

Call `callback` with the slice, then notify all subscribers. Throws `State slice <name> not found` when the slice has not been initialized.

```typescript
forEach(cb: (item: SpecificStateSliceType) => void): void
```

Iterate over all initialized slices.

```typescript
serialize(): Record<string, object>
```

Serialize every slice, keyed by slice `name`.

```typescript
deserialize(data: Record<string, unknown>, onMissing?: (key: string) => void): void
```

For each initialized slice, look up `data[slice.name]`; when absent, call `onMissing(slice.name)`, otherwise validate the value against the slice's `serializationSchema` and call `deserialize` on it. Subscribers are not automatically notified by this method.

```typescript
slices(): IterableIterator<Readonly<SpecificStateSliceType>>
```

Iterate over all initialized slices.

```typescript
subscribe<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T, callback: (state: Readonly<T>) => void): () => void
```

Subscribe to a slice. The callback is invoked immediately (via `queueMicrotask`) with the current state and again after every mutation. Returns an unsubscribe function.

```typescript
waitForState<T extends SpecificStateSliceType>(
  ClassType: new (...args: any[]) => T,
  predicate: (state: Readonly<T>) => boolean,
  signal: AbortSignal,
): Promise<Readonly<T>>
```

Resolve with the current state when `predicate` already holds, otherwise resolve on the next mutation that satisfies it. Rejects with `signal.reason` (or `"Operation was aborted"`) when the signal aborts first.

```typescript
timedWaitForState<T extends SpecificStateSliceType>(
  ClassType: new (...args: any[]) => T,
  predicate: (state: Readonly<T>) => boolean,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Readonly<T>>
```

Like `waitForState`, but rejects with `Timeout waiting for state <name>` after `timeoutMs`, and with the abort reason when the signal aborts first.

```typescript
async *subscribeAsync<T extends SpecificStateSliceType>(
  ClassType: new (...args: any[]) => T,
  signal: AbortSignal,
): AsyncGenerator<Readonly<T>, void, unknown>
```

Yield the current state first, then the latest state after each mutation (rapid mutations are coalesced - only the newest value is yielded per iteration). Completes when `signal` aborts.

### SerializableStateSlice

Abstract base class for state slices that can be serialized and deserialized.

```typescript
abstract class SerializableStateSlice<SerializationSchema extends z.ZodType> {
  constructor(
    public readonly name: string,
    public readonly serializationSchema: SerializationSchema,
  )

  abstract serialize(): z.input<SerializationSchema>;

  abstract deserialize(data: z.output<SerializationSchema>): void;
}
```

| Method | Description |
|--------|-------------|
| serialize() | Serialize state to a value matching the schema's input type. |
| deserialize() | Restore state from a value validated by `serializationSchema.parse(...)`. |

### AppStateSlice

Marker base class for app-level state slices.

```typescript
abstract class AppStateSlice<SerializationSchema extends z.ZodType>
  extends SerializableStateSlice<SerializationSchema> {}
```

### AppLogsState

State slice holding the application's log entries.

| Property | Type | Description |
|----------|------|-------------|
| logs | LogEntry[] | All log entries in append order. |

```typescript
class AppLogsState extends AppStateSlice<typeof serializationSchema> {
  logs: LogEntry[] = [];

  constructor();

  addLog(level: "info" | "error", message: string): void;
  getLogs(): LogEntry[];
  serialize(): z.output<typeof serializationSchema>;
  deserialize(data: z.output<typeof serializationSchema>): void;
}
```

| Method | Description |
|--------|-------------|
| addLog() | Append `{ timestamp, level, message }` (timestamp is `Date.now()`). |
| getLogs() | Return the log array. |
| serialize() | Return `{ logs }` for checkpointing. |
| deserialize() | Replace `logs` with a copy of the validated entries. |

### AppConfigurationState

State slice holding the composed application configuration as a stack of layers. Precedence, lowest to highest: `appConfig` + `pluginConfigs` + `globalConfig` + `workspaceConfig`.

| Property | Type | Description |
|----------|------|-------------|
| appConfig | TokenRingAppConfig | The config the app booted with; never modified and never serialized. |
| pluginConfigs | Record<string, ConfigLayer> | Default config contributed by each installed plugin, keyed by plugin name. |
| globalConfig | ConfigLayer | Sparse overrides from the user's home directory. |
| workspaceConfig | ConfigLayer | Sparse overrides from the workspace directory. |
| mergedConfig | TokenRingAppConfig | All layers merged. Object identity is stable for the app's lifetime; contents are replaced in place so services holding a reference observe changes. |
| requiresRestartToFullyApplyConfig | boolean | Set to true when a config change touched a plugin that cannot be reconfigured live. Sticky once set. |

```typescript
class AppConfigurationState extends AppStateSlice<typeof serializationSchema> {
  constructor({ appConfig, globalConfig, workspaceConfig }: AppConfigurationStateProps);

  getOverrideLayer(scope: ConfigScope): ConfigLayer;
  getLayersBelow(scope: ConfigScope): TokenRingAppConfig;
  previewWithOverrideLayer(scope: ConfigScope, layer: ConfigLayer): TokenRingAppConfig;
  serialize(): z.input<typeof serializationSchema>;
  deserialize(data: z.output<typeof serializationSchema>): void;

  static setPluginConfigs(app: TokenRingApp, pluginConfigs: Record<string, ConfigLayer>): void;
  static setPluginConfig(app: TokenRingApp, pluginName: string, config: ConfigLayer): void;
  static removePluginConfig(app: TokenRingApp, pluginName: string): void;
  static setUserConfig(app: TokenRingApp, globalConfig: ConfigLayer): void;
  static setProjectConfig(app: TokenRingApp, workspaceConfig: ConfigLayer): void;
  static setOverrideLayer(app: TokenRingApp, scope: ConfigScope, layer: ConfigLayer): void;
}
```

| Method | Description |
|--------|-------------|
| getOverrideLayer(scope) | Return the override layer for `scope` (`global` or `workspace`). |
| getLayersBelow(scope) | Merge everything at or below `scope` without the scope's own layer. |
| previewWithOverrideLayer(scope, layer) | Merge `layer` into the stack for `scope` without applying it. |
| serialize() | Serialize `pluginConfigs`, `globalConfig`, and `workspaceConfig` (the mutable layers). |
| deserialize(data) | Restore the mutable layers and recompute `mergedConfig`. |
| setPluginConfigs / setPluginConfig / removePluginConfig | Register, replace, or remove a plugin's default config layer. |
| setUserConfig / setProjectConfig | Replace the global or workspace override layer. |
| setOverrideLayer(scope, layer) | Route a layer to the global or workspace layer by scope. |

All static mutators update the layer and recompute `mergedConfig` through `app.mutateState`, so subscribers to this slice are notified.

### PluginManager

Manages plugin installation, reconfiguration, and the plugin registry. Implements `TokenRingService` and is registered with the app via `app.addService(new PluginManager(app))` (the constructor itself does not register it).

| Property | Type | Description |
|----------|------|-------------|
| name | `"PluginManager"` | Service name. |
| description | `"Manages plugins"` | Service description. |
| generation | number | Bumped whenever the installed plugin set changes, so caches can be invalidated. |
| getPlugins | bound registry method | `plugins.valuesArray`. |

```typescript
class PluginManager implements TokenRingService {
  readonly name = "PluginManager";
  description = "Manages plugins";

  getPlugins(): TokenRingPlugin<any, any>[];
  get generation(): number;

  run(signal: AbortSignal): Promise<void>;
  installPlugins(plugins: TokenRingPlugin<any, any>[]): Promise<void>;
  reconfigurePlugins(): Promise<void>;
}
```

#### run

```typescript
run(signal: AbortSignal): Promise<void>
```

Subscribes to `AppConfigurationState` and calls `reconfigurePlugins()` on every change until `signal` aborts. Makes the manager react to live configuration edits.

#### installPlugins

```typescript
installPlugins(plugins: TokenRingPlugin<any, any>[]): Promise<void>
```

Installs plugins in phased order:

1. **Register configs.** For every plugin that declares a `config`, its default config is registered in `AppConfigurationState.pluginConfigs`.
2. **Early install.** For every plugin with `earlyInstall`, log `Early Installing plugin "<name>"` and call `earlyInstall(app, immutableConfigSchema?.parse(app.initialConfig))`. Errors are logged and thrown, preventing registration.
3. **Install.** For every plugin with `install`, log `Installing plugin "<name>"` and call `install(app, immutableConfigSchema?.parse(app.initialConfig))`, then register the plugin. Errors are logged and thrown; the plugin is not registered.
4. **Configure.** For every plugin with a `configSchema` and a `reconfigure` method, log `Configuring plugin "<name>"` and call `reconfigure(app, configFor(plugin))`, then register the plugin. Errors are logged and thrown.
5. **Start.** For every plugin with `start`, log `Starting plugin "<name>"` and call `start(app)`. Errors are logged and thrown.

After all phases complete, `generation` is incremented.

#### reconfigurePlugins

```typescript
reconfigurePlugins(): Promise<void>
```

Hands the current merged configuration to every installed plugin whose config slice changed since it last received one:

1. Read `AppConfigurationState.mergedConfig`.
2. For each installed plugin with a `configSchema`, parse its slice from the merged config. Skip it when the parsed slice is deep-equal to the plugin's last applied snapshot.
3. If the plugin defines `reconfigure`, log `Reconfiguring plugin "<name>"` and call `reconfigure(app, config)`. The config handed to the plugin is a fresh copy; a copy is kept privately for change detection, so a plugin mutating its config does not pollute it.
4. Otherwise log `Plugin "<name>" does not support live reconfiguration` and set `AppConfigurationState.requiresRestartToFullyApplyConfig = true` (sticky, and only mutated on transition so subscribers are not re-notified).

Takes no arguments and returns `void`; combine with `ConfigurationService` (or the `run` loop above) to react to config changes.

### DebugService

Captures debugging snapshots of live app and agent state and writes them to `<workspaceDirectory>/debug` as pretty-printed JSON. It is registered automatically by the `TokenRingApp` constructor, so every app has it (resolve it with `app.requireService(DebugService)`).

| Property | Type | Description |
|----------|------|-------------|
| name | `"DebugService"` | Service name. |
| description | `"Captures snapshots of app and agent state for debugging"` | Service description. |

```typescript
class DebugService implements TokenRingService {
  readonly name = "DebugService";
  description = "Captures snapshots of app and agent state for debugging";

  registerSnapshotSource(source: DebugSnapshotSource): void;
  getDebugDirectory(): string;
  listTargets(): DebugTarget[];
  capture(target: DebugTargetRef): Promise<string | null>;
  listSnapshots(): Promise<DebugSnapshotInfo[]>;
  readSnapshot(name: string): Promise<string | null>;
  deleteSnapshot(name: string): Promise<boolean>;
  startRecording(targets: DebugTargetRef[], intervalMs: number): void;
  stopRecording(): void;
  run(signal: AbortSignal): Promise<void>;
  stop(): void;
}
```

| Method | Description |
|--------|-------------|
| registerSnapshotSource(source) | Register a capture source. Application state is registered as the `app` source on construction. |
| getDebugDirectory() | Return `getWorkspaceResolvedPath("debug")`. The directory is created lazily on first capture. |
| listTargets() | Return every registered source's targets. |
| capture(target) | Capture one target and write `<kind>-<id>-<timestamp>.json`. Returns the file name, or `null` when the target no longer exists. |
| listSnapshots() | List snapshots newest first with `name`, `kind`, `sizeBytes`, and `capturedAt`. |
| readSnapshot(name) | Return the raw JSON text, or `null` when missing or when the name is invalid. |
| deleteSnapshot(name) | Delete a snapshot; returns whether it existed. |
| startRecording(targets, intervalMs) | Start the recorder: mutate `DebugState`, then capture immediately via a background task. |
| stopRecording() | Stop the recorder by mutating `DebugState`. |
| run(signal) | Service loop: poll `DebugState` every 500 ms and capture the recorded targets when due. |
| stop() | Call `stopRecording()`. |

Snapshot files are named `<kind>-<id>-<timestamp>.json`. Application state uses kind `app` and id `state`, so its files are `app-state-<timestamp>.json`. The timestamp format is `YYYYMMDDTHH:MM:SS` (local time); same-second captures get a counter suffix (`-2`, `-3`, ...). Names supplied over RPC are validated so they can never escape the debug directory. A state slice that throws during serialization appears as `{ __serializationError: <message> }` in the dump instead of losing the whole snapshot.

#### Snapshot types

```typescript
interface DebugSnapshotSource {
  readonly kind: string;
  readonly displayName: string;
  listTargets(): DebugTarget[];
  captureTarget(id: string): unknown;
}

interface DebugTarget {
  kind: string;
  id: string;
  label: string;
  description: string;
}

interface DebugSnapshotInfo {
  name: string;
  kind: string;
  sizeBytes: number;
  capturedAt: number;
}
```

### DebugState

State slice tracking the debug recorder. Only the recorder writes to it; the UI reads it to drive the record button.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| recording | boolean | false | Whether the recorder is running. |
| intervalMs | number | 5000 | Capture interval. Clamped to at least `MIN_RECORDING_INTERVAL_MS` (1000) on start. |
| targets | DebugTargetRef[] | [] | The targets currently being recorded. |
| startedAt | number \| null | null | When the current recording started. |
| lastCaptureAt | number \| null | null | When the most recent capture finished. |
| captureCount | number | 0 | Number of successful captures in the current recording. |
| lastSnapshot | string \| null | null | File name of the most recent captured snapshot. |
| lastError | string \| null | null | Error message from the most recent failed capture. |

```typescript
class DebugState extends AppStateSlice<typeof serializationSchema> {
  start(targets: DebugTargetRef[], intervalMs: number): void;
  stop(): void;
  recordCapture(snapshotName: string): void;
  recordFailure(error: string): void;
  serialize(): z.output<typeof serializationSchema>;
  deserialize(data: z.output<typeof serializationSchema>): void;
}
```

| Method | Description |
|--------|-------------|
| start(targets, intervalMs) | Set `recording = true`, replace targets, clamp the interval, and reset capture counters. `startedAt = Date.now()`. |
| stop() | Set `recording = false` and `startedAt = null`. |
| recordCapture(name) | Set `lastCaptureAt`, increment `captureCount`, set `lastSnapshot`, clear `lastError`. |
| recordFailure(error) | Set `lastCaptureAt` and `lastError`. |

`DebugTargetRef` is `z.object({ kind: z.string(), id: z.string() })` and `MIN_RECORDING_INTERVAL_MS` is exported as `1000`.

### ConfigurationService

Owns the editable override layers of `AppConfigurationState` (the `global` user layer and the `workspace` project layer, which takes precedence). It generates UI schemas, redacts sensitive values over the wire, validates candidate overrides, swaps the running layer, persists it atomically to that scope's file, and live-reconfigures plugins. Implements `TokenRingService`; register it with `app.addService(new ConfigurationService(app, options))`.

```typescript
interface ConfigurationServiceOptions {
  configSchema: z.ZodType;                       // The composed app config schema (all plugin shapes merged).
  overridesFiles: Record<ConfigScope, string>;   // File each override scope is persisted to.
  overlayError?: string;                         // Boot-time error when an overrides file was rejected.
}

type ConfigScope = "global" | "workspace";
const configScopes = ["global", "workspace"] as const;

type ConfigApplyResult = { ok: true } | { ok: false; issues: ConfigValidationIssue[] };
interface ConfigValidationIssue {
  path: (string | number)[];
  message: string;
}
```

| Property | Type | Description |
|----------|------|-------------|
| name | `"ConfigurationService"` | Service name. |
| description | `"Manages configuration overrides and live plugin reconfiguration"` | Service description. |
| overlayError | string \| undefined | Boot-time rejection message for the UI banner, when one occurred. |
| overridesFiles | Record<ConfigScope, string> | File path each scope is persisted to. |

```typescript
class ConfigurationService implements TokenRingService {
  getUISchemas(): ConfigUIPluginSchema[];
  getOverrides(scope: ConfigScope): ConfigLayer;
  getEffectiveConfig(): unknown;
  getRedactedValues(): { effective: Record<string, unknown>; overrides: Record<ConfigScope, Record<string, unknown>> };
  validateOverrides(scope: ConfigScope, candidateOverrides: ConfigLayer): { ok: true; normalized: ConfigLayer; parsed: unknown } | { ok: false; issues: ConfigValidationIssue[] };
  apply(scope: ConfigScope, candidateOverrides: ConfigLayer): Promise<ConfigApplyResult>;
  resetPath(scope: ConfigScope, path: string[]): Promise<ConfigApplyResult>;
}
```

| Method | Description |
|--------|-------------|
| getUISchemas() | Generated UI schema per installed plugin with configurable content. Rebuilt when `PluginManager.generation` changes. |
| getOverrides(scope) | Deep clone of the current override layer for `scope`. |
| getEffectiveConfig() | The running merged config parsed with the composed schema. |
| getRedactedValues() | Effective config and per-scope overrides for the UI-schema-covered slices, with sensitive values redacted to `{ __sensitive: true, isSet }`. Slices without a UI schema are never sent. |
| validateOverrides(scope, overrides) | Validate the full desired override set for one scope (idempotent PUT semantics, not a patch) without persisting or reconfiguring. Rejects unknown top-level keys, resolves sensitive sentinels, prunes values equal to the layers below, and parses the preview. |
| apply(scope, overrides) | Validate; on success swap the running layer, live-reconfigure plugins (rolling back if a plugin rejects the config), and only then persist the overrides file atomically. Concurrent calls are serialized. |
| resetPath(scope, path) | Remove the override at `path` (empty path clears all) and re-apply. |

`apply` and `resetPath` return `{ ok: true }` on success or `{ ok: false, issues }` with pathed validation issues on failure. A config the running app rejected is never written to disk.

### buildConfigUISchema

Introspects a plugin's zod config schema into a serializable `ConfigUINode` tree for the configuration UI. It derives field types and constraints from the zod definition and overlays `ConfigFieldMeta` attached via `.meta()`. It never throws: any construct it cannot map becomes an `opaque` node the UI renders as a raw YAML editor.

```typescript
function buildConfigUISchema(plugin: TokenRingPlugin<any, any>): ConfigUIPluginSchema | null;
```

Returns one node per top-level config key the plugin owns (`slices`), or `null` for plugins without config. Supported mappings include: strings to text fields (with min/max length), numbers to number fields (with min/max/decimals), booleans to checkboxes, enums and literal unions to selects, string arrays to `stringList`, object arrays to `list` nodes, records to `map` nodes, discriminated unions of objects to `variant` nodes, and objects to `group` nodes. Wrapper types (`.optional()`, `.default()`, `.prefault()`) are peeled for required-ness and defaults; `.meta()` on an inner node wins over wrappers. Fields marked `sensitive` are redacted and rendered as password inputs.

### buildTokenRingAppConfig and buildTokenRingAppConfigLayers

Build the application configuration by loading multiple YAML layers and validating with Zod.

```typescript
interface BuildConfigOptions {
  globalConfigFile?: string;    // Global config file, e.g. ~/.tokenring/config.yaml.
  workspaceConfigFile?: string; // Workspace config file, e.g. <workspaceDirectory>/config.yaml.
}

interface TokenRingAppConfigLayers<T extends z.ZodType> {
  appConfig: z.output<T>;         // CLI defaults merged with configDirectories YAML, parsed.
  globalConfig: ConfigLayer;      // Sparse user overrides as loaded ({} when absent or rejected).
  workspaceConfig: ConfigLayer;   // Sparse project overrides as loaded ({} when absent or rejected).
  overlayError: string | undefined; // Set when an override file exists but was rejected.
}

async function buildTokenRingAppConfigLayers<T extends z.ZodType>(
  configSchema: T,
  defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>,
  options: BuildConfigOptions = {},
): Promise<TokenRingAppConfigLayers<T>>;

async function buildTokenRingAppConfig<T extends z.ZodType>(
  configSchema: T,
  defaultConfig: z.input<T> & z.input<typeof TokenRingAppConfigSchema>,
  options: BuildConfigOptions = {},
): Promise<z.output<T>>;
```

**Config loading process** (`buildTokenRingAppConfigLayers`):

1. Start from `defaultConfig`.
2. For each directory in `defaultConfig.app.configDirectories` (in order), scan it with the glob `**/*.yaml` and deep-merge each file (later files and later directories win), then parse the result with `configSchema` to produce `appConfig` - the immutable app layer.
3. Load the sparse `globalConfigFile` overlay, then the `workspaceConfigFile` overlay. Each is parsed as YAML, must be a mapping, and is validated on top of the layers below it. When an overlay file is missing it contributes `{}`; when it is malformed, a non-mapping, or schema-invalid, that layer is dropped (`{}`) and the failure is recorded in `overlayError` (multiple errors joined with newlines). A rejected override never prevents boot.

`buildTokenRingAppConfig` merges all layers (project wins over user) and returns the parsed result - the convenience one-shot that also computes the effective config you would pass to `new TokenRingApp(...)`.

## Public Types

### TokenRingService

```typescript
interface TokenRingService {
  readonly name: string;
  readonly description: string;

  run?(signal: AbortSignal): MaybePromise<void>;

  start?(signal: AbortSignal): MaybePromise<void>;

  stop?(): MaybePromise<void>;

  attach?(agent: Agent, creationContext: AgentCreationContext): void;

  detach?(agent: Agent): void;
}
```

| Member | Description |
|--------|-------------|
| name | Unique service name. |
| description | Human-readable service description. |
| run | Main service loop, called after `start()`. Exited or thrown services are automatically restarted after `serviceRestartDelayMs`. |
| start | Initialization, called before `run()`. |
| stop | Cleanup, called during shutdown. |
| attach / detach | Optional agent integration hooks. |

### TokenRingPlugin

```typescript
type TokenRingPlugin<ConfigType extends ZodType = ZodNever, ImmutableConfigType extends ZodType = ZodNever> = {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly config?: Record<string, unknown>;          // Default config contributed as a layer.
  readonly configSchema?: ConfigType;                 // Parses the plugin's slice from the merged config.
  readonly immutableConfigSchema?: ImmutableConfigType; // Parses the plugin's slice from the initial config.
  earlyInstall?: (app: TokenRingApp, config: ImmutableConfigType extends ZodNever ? undefined : z.output<ImmutableConfigType>) => MaybePromise<void>;
  install?: (app: TokenRingApp, config: ImmutableConfigType extends ZodNever ? undefined : z.output<ImmutableConfigType>) => MaybePromise<void | undefined>;
  start?: (app: TokenRingApp) => MaybePromise<void>;
  reconfigure?: (app: TokenRingApp, config: z.output<ConfigType>) => MaybePromise<void>;
};
```

| Member | Description |
|--------|-------------|
| config | Plain default config object, registered into `AppConfigurationState.pluginConfigs` on install. |
| configSchema | Zod schema for the plugin's config slice. Presence enables change detection and live `reconfigure`. |
| immutableConfigSchema | Zod schema for the plugin's boot-time config slice, handed to `earlyInstall` and `install`. |
| earlyInstall | Runs first with the parsed immutable config (or `undefined` when no `immutableConfigSchema`). Failures prevent registration. |
| install | Runs with the app and the parsed immutable config (or `undefined` when no `immutableConfigSchema`) once all `earlyInstall` hooks have run. The plugin is registered after it succeeds. |
| start | Runs last; failures still leave the plugin registered if install succeeded. |
| reconfigure | Present when the plugin declares a `configSchema`; called with the plugin's parsed slice whenever it changes. |

```typescript
type TokenRingPluginOrBuilder =
  | TokenRingPlugin<any, any>
  | ((app: TokenRingApp) => MaybePromise<TokenRingPlugin<any, any>>);
```

### Other exported types

| Type | Description |
|------|-------------|
| AppStateSlice<S> | Abstract base for app state slices; extends `SerializableStateSlice`. |
| SerializableStateSlice<S> | Abstract base with `serialize()` / `deserialize()`, from `@tokenring-ai/app/StateManager`. |
| StateStorageInterface<T> | Interface with `getState`, `mutateState`, and `initializeState`, implemented by `StateManager`. |
| LogEntry | `{ timestamp: number; level: "info" \| "error"; message: string }` (defined in `TokenRingApp.ts` and `state/AppLogsState.ts`). |
| AppSessionCheckpoint | `z.input<typeof AppSessionCheckpointSchema>`, with `sessionId`, `createdAt`, `hostname`, `workspaceDirectory`, and `state`. |
| TokenRingAppConfig | `z.output<typeof LooseTokenRingAppConfigSchema>`. |
| AppConfigItem | Type alias for `ConfigFieldSpec`, kept for backwards compatibility. |
| ConfigurationError | `new ConfigurationError(serviceName, message, options?)` - formats its message as `[<serviceName>: <message>]`. |
| NotImplementedError | `new NotImplementedError(providerOrServiceName, message, options?)` - formats its message as `[<providerOrServiceName>: <message>]`. |
| ConfigFieldMeta | `.meta()` annotations plugin authors attach to zod config nodes (label, description, uiType, options, sensitive, restartRequired, advanced, order, hidden, placeholder, unit). |
| ConfigUINode | Serializable config UI tree node (`group`, `field`, `list`, `map`, `variant`, `secret`, `opaque`). |
| ConfigScope / configScopes | `"global" \| "workspace"` and `["global", "workspace"] as const`. |

## Services and Lifecycle

The package is a service framework, not a plugin, so it registers no plugin lifecycle hooks of its own. Services implement `TokenRingService` and are added with `app.addService(...)`:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import PluginManager from "@tokenring-ai/app/PluginManager";
import ConfigurationService from "@tokenring-ai/app/config/ConfigurationService";

const app = new TokenRingApp(initialConfig);
app.addService(new PluginManager(app));
app.addService(
  new ConfigurationService(app, {
    configSchema: composedSchema,
    overridesFiles: { global: globalConfigFile, workspace: workspaceConfigFile },
  }),
);
```

`DebugService` is added automatically by the `TokenRingApp` constructor; `PluginManager` and `ConfigurationService` are added by the host application (typically inside a plugin's `install`).

### Plugin lifecycle

Plugins define their own lifecycle through the `TokenRingPlugin` hooks, driven by `PluginManager.installPlugins`:

| Phase | Hook | When | Failure behavior |
|-------|------|------|------------------|
| Config registration | `config` | Before any hooks | Layer added to `AppConfigurationState.pluginConfigs`. |
| Early install | `earlyInstall(app, immutableConfig)` | First phase | Logged and thrown; plugin not registered. |
| Install | `install(app, immutableConfig)` | After all early installs | Logged and thrown; plugin not registered. |
| Configure | `reconfigure(app, config)` | After install | Logged and thrown; the plugin stays registered (registration already happened during install). |
| Start | `start(app)` | Last phase | Logged and thrown; plugin stays registered if install succeeded. |

After installation, config changes are pushed to plugins by `PluginManager.reconfigurePlugins()` - either directly or through `ConfigurationService.apply` / `resetPath`, which swap the layer, reconfigure, and persist atomically.

## RPC Endpoints

The package ships two RPC endpoints, built with `createRPCEndpoint` from `@tokenring-ai/rpc`.

### /rpc/app

`AppRpcSchema` (name "App RPC") exposes plugin, log, and debugging information.

| Method | Type | Description |
|--------|------|-------------|
| listPlugins | query | List installed plugins with name, displayName, version, description, and hasConfig. |
| getLogs | query | Return all log entries. |
| streamLogs | stream | Stream log entries appended after a position. |
| listDebugTargets | query | List everything that can be captured right now. |
| captureDebugSnapshot | mutation | Capture one target to a snapshot file. |
| listDebugSnapshots | query | List stored snapshots newest first. |
| readDebugSnapshot | query | Read a snapshot's raw JSON text. |
| deleteDebugSnapshot | mutation | Delete a snapshot. |
| startDebugRecording | mutation | Start the recorder for at least one target at the given interval. |
| stopDebugRecording | mutation | Stop the recorder. |
| streamDebugRecording | stream | Stream the current recording status. |

#### listPlugins

**Input**: `{}`

**Result**:

```typescript
{
  plugins: Array<{
    name: string;
    displayName: string;
    version: string;
    description: string;
    hasConfig: boolean; // true when the plugin declares a configSchema
  }>;
}
```

#### getLogs

**Input**: `{}` — **Result**: `{ logs: LogEntry[] }`.

#### streamLogs

Subscription stream over `AppLogsState` that yields incremental log chunks. **Input**:

```typescript
{ fromPosition?: number } // defaults to 0
```

**Result** (per yield):

```typescript
{
  logs: LogEntry[];  // entries appended after the previous yield
  position: number;  // cursor for the next request
}
```

#### listDebugTargets

**Input**: `{}` — **Result**: `{ targets: DebugTarget[] }`.

#### captureDebugSnapshot

**Input**: `DebugTargetRef`, i.e. `{ kind: string; id: string }`.

| Status | Additional Fields | Description |
|--------|-------------------|-------------|
| success | name: string | Snapshot written; returns the file name. |
| targetNotFound | – | The target no longer exists or its kind is unknown. |

#### listDebugSnapshots

**Input**: `{}` — **Result**: `{ snapshots: DebugSnapshotInfo[] }` (newest first).

#### readDebugSnapshot

**Input**: `{ name: string }`.

| Status | Additional Fields | Description |
|--------|-------------------|-------------|
| success | name: string, content: string | Raw snapshot JSON text. |
| notFound | – | No snapshot with that name (or the name is invalid). |

#### deleteDebugSnapshot

**Input**: `{ name: string }`.

| Status | Additional Fields | Description |
|--------|-------------------|-------------|
| success | – | Snapshot deleted. |
| notFound | – | No snapshot with that name. |

#### startDebugRecording

**Input**:

```typescript
{
  targets: DebugTargetRef[];        // at least 1 target
  intervalMs: number;               // minimum MIN_RECORDING_INTERVAL_MS (1000)
}
```

**Result**: `DebugRecordingStatus` (see below).

#### stopDebugRecording

**Input**: `{}` — **Result**: `DebugRecordingStatus`.

#### streamDebugRecording

Subscription stream over `DebugState`; each yield is the current `DebugRecordingStatus`.

```typescript
interface DebugRecordingStatus {
  recording: boolean;
  intervalMs: number;
  targets: DebugTargetRef[];
  startedAt: number | null;
  lastCaptureAt: number | null;
  captureCount: number;
  lastSnapshot: string | null;
  lastError: string | null;
}
```

### /rpc/config

`ConfigRpcSchema` (name "Config RPC") is the surface for the configuration UI.

| Method | Type | Description |
|--------|------|-------------|
| getConfigSchema | query | Return the generated UI schema per plugin, per-scope overrides files, and any boot-time overlay error. |
| getConfigValues | query | Return the effective config and per-scope overrides for UI-schema-covered slices. |
| validateConfig | mutation | Validate a candidate override set for a scope without persisting. |
| applyConfig | mutation | Validate, apply, and persist the full desired override set for a scope. |
| resetConfig | mutation | Remove the override at a path (empty path clears all) and re-apply. |

#### getConfigSchema

**Input**: `{}`

**Result**:

```typescript
{
  plugins: ConfigUIPluginSchema[];                 // one per installed plugin with configurable content
  overridesFiles: { global: string; workspace: string };
  overlayError: string | null;                     // boot-time overlay rejection, for the UI banner
}
```

#### getConfigValues

**Input**: `{}`

**Result**:

```typescript
{
  effective: Record<string, unknown>;             // redacted effective config, UI-schema slices only
  overrides: { global: Record<string, unknown>; workspace: Record<string, unknown> };
}
```

#### validateConfig

**Input**: `{ scope: ConfigScope; overrides: Record<string, unknown> }`

| Status | Additional Fields | Description |
|--------|-------------------|-------------|
| ok: true | – | Candidate overrides are valid. |
| ok: false | issues: { path: (string \| number)[]; message: string }[] | Pathed validation issues; nothing is persisted. |

#### applyConfig

**Input**: `{ scope: ConfigScope; overrides: Record<string, unknown> }` — the FULL desired override set for `scope` (idempotent PUT semantics, not a patch). Returns the same `ok` discriminated union as `validateConfig`.

#### resetConfig

**Input**: `{ scope: ConfigScope; path: string[] }` — removes the override at `path` (empty path clears all). Returns the same `ok` discriminated union as `validateConfig`.

**Sensitive values.** Reads never send secrets in plaintext: sensitive fields arrive as `{ __sensitive: true, isSet: boolean }`. Writes send `{ __sensitive: "keep" }` to preserve the stored value at that path (dropped entirely when nothing is stored), or a plaintext replacement.

## Package Exports

The package's index module (`@tokenring-ai/app`) exports:

```typescript
import TokenRingApp from "@tokenring-ai/app"; // default export

import buildConfigUISchema from "@tokenring-ai/app/config/buildConfigUISchema"; // re-exported (default)
import ConfigurationService from "@tokenring-ai/app/config/ConfigurationService"; // re-exported (default)
import DebugService from "@tokenring-ai/app/debug/DebugService"; // re-exported (default)
import PluginManager from "@tokenring-ai/app/PluginManager"; // re-exported (default)

export {
  TokenRingApp, // default
  buildConfigUISchema,
  ConfigurationService,
  DebugService,
  PluginManager,
  // types
  ConfigFieldMeta,
  ConfigScope, configScopes,
  ConfigFieldSpec, ConfigUINode, ConfigUIPluginSchema,
  DebugSnapshotInfo, DebugSnapshotSource, DebugTarget,
  AppConfigurationState, ConfigLayer, DebugState, DebugTargetRef,
  TokenRingPlugin,
};
```

Additional modules are reachable through subpath imports thanks to the `"./*": "./*.ts"` export map:

```typescript
import StateManager, { SerializableStateSlice, StateStorageInterface } from "@tokenring-ai/app/StateManager";
import { TokenRingService, AppStateSlice, ConfigurationError, NotImplementedError } from "@tokenring-ai/app/types";
import { TokenRingAppConfigSchema, TokenRingAppConfig, AppSessionCheckpointSchema } from "@tokenring-ai/app/schema";
import buildTokenRingAppConfig, { buildTokenRingAppConfigLayers } from "@tokenring-ai/app/buildTokenRingAppConfig";
import AppRpcSchema from "@tokenring-ai/app/rpc/schema";
import ConfigRpcSchema from "@tokenring-ai/app/rpc/configSchema";
import appRpcEndpoint from "@tokenring-ai/app/rpc/app";
import configRpcEndpoint from "@tokenring-ai/app/rpc/config";
import { AppLogsState } from "@tokenring-ai/app/state/AppLogsState";
import { AppConfigurationState } from "@tokenring-ai/app/state/AppConfigurationState";
import { DebugState } from "@tokenring-ai/app/state/DebugState";
```

## Dependencies

| Package | Purpose |
|---------|---------|
| @tokenring-ai/agent (workspace:*) | Agent types for `TokenRingService.attach` / `detach`. |
| @tokenring-ai/utility (workspace:*) | `TypedRegistry`, `KeyedRegistry`, `EnhancedMap`, `deepClone`, `formatLogMessages`, `generateHumanId`. |
| @tokenring-ai/rpc (workspace:*) | `createRPCEndpoint` for the app and config RPC endpoints. |
| zod (^4.4.3) | Schema validation for configuration, state serialization, and RPC. |

**Dev dependencies:** typescript (^7.0.2) for type checking (`bun run build`).

## Testing

```bash
bun test
```

Run the suite with `bun test --watch` or `bun test --coverage`. The suite covers the `TokenRingApp` lifecycle, service registry, logging, and background tasks; `StateManager` serialization, subscriptions, and async observation; `PluginManager` installation and reconfiguration; `AppConfigurationState` layering; `ConfigurationService` validation, apply/reset, scopes, and sensitive-value handling; `buildTokenRingAppConfigLayers` layering and overlay rejection; `buildConfigUISchema` introspection; `DebugService` snapshots and recording; and the app/config RPC endpoints.

## License

MIT License — see LICENSE file for details.
