import EnhancedMap from "@tokenring-ai/utility/map/enhancedMap";
import type { z } from "zod";

export abstract class SerializableStateSlice<SerializationSchema extends z.ZodType> {
  constructor(
    public readonly name: string,
    public readonly serializationSchema: SerializationSchema,
  ) {}

  abstract serialize(): z.input<SerializationSchema>;

  abstract deserialize(data: z.output<SerializationSchema>): void;
}

export interface StateStorageInterface<SpecificStateSliceType extends SerializableStateSlice<any>> {
  getState<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T): T;

  mutateState<R, T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T, callback: (state: T) => R): R;

  initializeState<S, T extends SpecificStateSliceType>(ClassType: new (props: S) => T, props: S): void;
}

export default class StateManager<SpecificStateSliceType extends SerializableStateSlice<any>> implements StateStorageInterface<SpecificStateSliceType> {
  state = new EnhancedMap<new (...args: any[]) => SpecificStateSliceType, SpecificStateSliceType>();
  private subscribers = new EnhancedMap<new (...args: any[]) => SpecificStateSliceType, Set<(state: any) => void>>();

  constructor(private startingState: Record<string, unknown> = {}) {}

  initializeState<S, T extends SpecificStateSliceType>(ClassType: new (props: S) => T, props: S): Readonly<T> {
    const slice = new ClassType(props);
    this.state.set(ClassType, slice);

    if (Object.hasOwn(this.startingState, slice.name)) {
      slice.deserialize(slice.serializationSchema.parse(this.startingState[slice.name]));
    }

    return slice;
  }

  mutateState<R, T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T, callback: (state: T) => R): Readonly<R> {
    const state = this.state.get(ClassType) as T | undefined;
    if (!state) {
      throw new Error(`State slice ${ClassType.name} not found`);
    }
    const result = callback(state);
    for (const subscriber of this.subscribers.get(ClassType) ?? []) {
      subscriber(state);
    }
    return result;
  }

  getState<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T): Readonly<T> {
    const stateSlice = this.state.get(ClassType);
    if (!stateSlice) {
      throw new Error(`State slice ${ClassType.name} not found`);
    }
    return stateSlice as T;
  }

  forEach(cb: (item: SpecificStateSliceType) => void) {
    this.state.forEach(cb);
  }

  serialize(): Record<string, object> {
    return Object.fromEntries(
      this.state.mapValues(slice => {
        try {
          return [slice.name, slice.serialize()];
        } catch (error: unknown) {
          // One broken slice must not lose the rest of the debug snapshot.
          return [slice.name, { __serializationError: error instanceof Error ? error.message : String(error) }];
        }
      }),
    );
  }

  deserialize(data: Record<string, unknown>, onMissing?: (key: string) => void): void {
    for (const slice of this.state.values()) {
      const sliceData = data[slice.name];
      if (sliceData === undefined) {
        onMissing?.(slice.name);
        continue;
      }
      slice.deserialize(slice.serializationSchema.parse(sliceData));
    }
  }

  slices(): IterableIterator<Readonly<SpecificStateSliceType>> {
    return this.state.values();
  }

  subscribe<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T, callback: (state: Readonly<T>) => void): () => void {
    if (!this.subscribers.has(ClassType)) {
      this.subscribers.set(ClassType, new Set());
    }
    this.subscribers.get(ClassType)?.add(callback);

    queueMicrotask(() => {
      if (this.subscribers.get(ClassType)?.has(callback)) {
        callback(this.getState(ClassType));
      }
    });

    return () => this.subscribers.get(ClassType)?.delete(callback);
  }

  async timedWaitForState<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    predicate: (state: Readonly<T>) => boolean,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<Readonly<T>> {
    const state = this.getState(ClassType);
    if (predicate(state)) {
      return state;
    }

    if (signal.aborted) {
      throw signal.reason ?? new Error("Operation was aborted");
    }

    return await new Promise((resolve, reject) => {
      let cleanup = () => {};

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for state ${ClassType.name}`));
      }, timeoutMs);

      const abortHandler = () => {
        cleanup();
        reject(signal.reason ?? new Error("Operation was aborted"));
      };

      signal.addEventListener("abort", abortHandler);

      const unsubscribe = this.subscribe(ClassType, state => {
        if (predicate(state)) {
          cleanup();
          resolve(state);
        }
      });

      cleanup = () => {
        clearTimeout(timeout);
        unsubscribe();
        signal.removeEventListener("abort", abortHandler);
      };
    });
  }

  waitForState<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    predicate: (state: Readonly<T>) => boolean,
    signal: AbortSignal,
  ): Promise<Readonly<T>> {
    const state = this.getState(ClassType);
    if (predicate(state)) {
      return Promise.resolve(state);
    }

    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new Error("Operation was aborted"));
    }

    return new Promise((resolve, reject) => {
      let unsubscribe: () => void = () => {};

      const abortHandler = () => {
        unsubscribe();
        reject(signal.reason ?? new Error("Operation was aborted"));
      };

      signal.addEventListener("abort", abortHandler);

      unsubscribe = this.subscribe(ClassType, state => {
        if (predicate(state)) {
          unsubscribe();
          signal.removeEventListener("abort", abortHandler);
          resolve(state);
        }
      });
    });
  }

  async *subscribeAsync<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    signal: AbortSignal,
  ): AsyncGenerator<Readonly<T>, void, unknown> {
    // Check if already aborted
    if (signal.aborted) {
      return;
    }

    // Create a queue to buffer state updates
    let latestItem: Readonly<T> | null = this.getState(ClassType);
    let resolveNext: (() => void) | null = null;
    let isComplete = false;

    // Set up abort handler
    const abortHandler = () => {
      isComplete = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    signal.addEventListener("abort", abortHandler);

    // Subscribe to state changes
    const unsubscribe = this.subscribe(ClassType, state => {
      latestItem = state;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- can be mutated asynchronously
      while (!isComplete && !signal.aborted) {
        // Wait for next item in queue
        if (latestItem === null) {
          await new Promise<void>(resolve => {
            resolveNext = resolve;
          });
        }

        // Yield  queued items
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- can be mutated asynchronously
        if (latestItem && !signal.aborted) {
          const item = latestItem;
          latestItem = null;
          yield item;
        }
      }
    } finally {
      unsubscribe();
      signal.removeEventListener("abort", abortHandler);
    }
  }
}
