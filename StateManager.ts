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
    return callback(state);
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

  entries(): IterableIterator<[string, SerializableStateSlice]> {
    return this.state.entries();
  }
}
