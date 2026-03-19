import {z} from "zod";

export type StateSnapshot = Record<string, unknown>;

export abstract class SerializableStateSlice<SerializationSchema extends z.ZodTypeAny> {
  constructor(public readonly name: string, public readonly serializationSchema: SerializationSchema) {}
  abstract serialize(): z.input<SerializationSchema>;
  abstract deserialize(data: z.output<SerializationSchema>): void;

  getValidatedState(stateSnapshot: StateSnapshot): z.output<SerializationSchema> | null {
    if (Object.hasOwn(stateSnapshot, this.name)) {
      return this.serializationSchema.parse(stateSnapshot[this.name]);
    }
    return null;
  }
}

export interface StateStorageInterface<SpecificStateSliceType extends SerializableStateSlice<any>> {
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

export default class StateManager<SpecificStateSliceType extends SerializableStateSlice<any>> implements StateStorageInterface<SpecificStateSliceType> {
  state = new Map<new (...args: any[]) => SpecificStateSliceType, SpecificStateSliceType>();
  private subscribers = new Map<new (...args: any[]) => SpecificStateSliceType, Set<(state: any) => void>>();

  constructor(private startingState: Record<string, unknown> = {}) {}

  setStartingState(state: Record<string, unknown>) {
    this.startingState = state;
  }

  initializeState<S, T extends SpecificStateSliceType>(
    ClassType: new (props: S) => T,
    props: S,
  ): void {
    const slice = new ClassType(props)
    this.state.set(ClassType, slice);

    if (Object.hasOwn(this.startingState, slice.name)) {
      slice.deserialize(slice.serializationSchema.parse(this.startingState[slice.name]));
    }
  }

  mutateState<R, T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    callback: (state: T) => R,
  ): R {
    const state = this.state.get(ClassType) as T;
    if (!state) {
      throw new Error(`State slice ${ClassType.name} not found`);
    }
    const result = callback(state);
    this.subscribers.get(ClassType)?.forEach(cb => cb(state));
    return result;
  }

  getState<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T): T {
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
      Array.from(this.state.values()).map(slice => [
        slice.name,
        slice.serialize(),
      ]),
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

  slices(): IterableIterator<SpecificStateSliceType> {
    return this.state.values();
  }

  subscribe<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    callback: (state: T) => void,
  ): () => void {
    if (!this.subscribers.has(ClassType)) {
      this.subscribers.set(ClassType, new Set());
    }
    this.subscribers.get(ClassType)!.add(callback);

    queueMicrotask(() => {
      if (this.subscribers.get(ClassType)?.has(callback)) {
        callback(this.getState(ClassType))
      }
    });

    return () => this.subscribers.get(ClassType)?.delete(callback);
  }

  async timedWaitForState<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    predicate: (state: T) => boolean,
    timeoutMs: number,
  ): Promise<T> {
    const state = this.getState(ClassType);
    if (predicate(state)) {
      return state;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for state ${ClassType.name}`));
      }, timeoutMs);

      const unsubscribe = this.subscribe(ClassType, (state) => {
        if (predicate(state)) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(state);
        }
      });
    });
  }

  async waitForState<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    predicate: (state: T) => boolean,
  ): Promise<T> {
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(ClassType, (state) => {
        if (predicate(state)) {
          unsubscribe();
          resolve(state);
        }
      });
    });
  }

  async * subscribeAsync<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    signal: AbortSignal
  ): AsyncGenerator<T, void, unknown> {
    // Check if already aborted
    if (signal.aborted) {
      return;
    }

    // Create a queue to buffer state updates
    let latestItem: T | null = this.getState(ClassType);
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

    signal.addEventListener('abort', abortHandler);

    // Subscribe to state changes
    const unsubscribe = this.subscribe(ClassType, (state) => {
      latestItem = state
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    try {
      while (!isComplete && !signal?.aborted) {
        // Wait for next item in queue
        if (latestItem === null) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }

        // Yield  queued items
        if (latestItem && !signal?.aborted) {
          const item = latestItem;
          latestItem = null;
          yield item;
        }
      }
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', abortHandler);
    }
  }
}
