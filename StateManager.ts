export interface SerializableStateSlice {
  name: string;
  serialize: () => object;
  deserialize: (data: object) => void;
}

export interface StateStorageInterface<SpecificStateSliceType extends SerializableStateSlice> {
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

export default class StateManager<SpecificStateSliceType extends SerializableStateSlice> implements StateStorageInterface<SpecificStateSliceType> {
  state = new Map<string, SpecificStateSliceType>();
  private subscribers = new Map<string, Set<(state: any) => void>>();

  initializeState<S, T extends SpecificStateSliceType>(
    ClassType: new (props: S) => T,
    props: S,
  ): void {
    this.state.set(ClassType.name, new ClassType(props));
  }

  mutateState<R, T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    callback: (state: T) => R,
  ): R {
    const state = this.state.get(ClassType.name) as T;
    if (!state) {
      throw new Error(`State slice ${ClassType.name} not found`);
    }
    const result = callback(state);
    this.subscribers.get(ClassType.name)?.forEach(cb => cb(state));
    return result;
  }

  getState<T extends SpecificStateSliceType>(ClassType: new (...args: any[]) => T): T {
    const stateSlice = this.state.get(ClassType.name);
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
      Array.from(this.state.entries()).map(([key, slice]) => [
        key,
        slice.serialize(),
      ]),
    );
  }

  deserialize(data: Record<string, object>, onMissing?: (key: string) => void): void {
    for (const key in data) {
      const slice = this.state.get(key);
      if (slice) {
        slice.deserialize(data[key]);
      } else {
        onMissing?.(key);
      }
    }
  }

  entries(): IterableIterator<[string, SpecificStateSliceType]> {
    return this.state.entries();
  }

  subscribe<T extends SpecificStateSliceType>(
    ClassType: new (...args: any[]) => T,
    callback: (state: T) => void,
  ): () => void {
    const key = ClassType.name;
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);

    queueMicrotask(() => {
      if (this.subscribers.get(key)?.has(callback)) {
        callback(this.getState(ClassType))
      }
    });

    return () => this.subscribers.get(key)?.delete(callback);
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
