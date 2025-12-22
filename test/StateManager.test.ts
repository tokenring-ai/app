import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StateManager, { SerializableStateSlice } from '../StateManager.ts';

describe('StateManager', () => {
  let stateManager: StateManager<TestStateSlice>;

  interface TestStateSlice extends SerializableStateSlice {
    data: string;
    updateData(newData: string): void;
  }

  class MockStateSlice implements TestStateSlice {
    name = 'MockStateSlice';
    data: string;

    constructor(props: { initialData: string }) {
      this.data = props.initialData;
    }

    serialize(): object {
      return { data: this.data };
    }

    deserialize(data: object): void {
      this.data = (data as any).data;
    }

    updateData(newData: string): void {
      this.data = newData;
    }
  }

  class AnotherStateSlice implements TestStateSlice {
    name = 'AnotherStateSlice';
    data: string;

    constructor(props: { initialData: string }) {
      this.data = props.initialData;
    }

    serialize(): object {
      return { data: this.data };
    }

    deserialize(data: object): void {
      this.data = (data as any).data;
    }

    updateData(newData: string): void {
      this.data = newData;
    }
  }

  beforeEach(() => {
    stateManager = new StateManager<TestStateSlice>();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('State Initialization', () => {
    it('should initialize state for a class', () => {
      stateManager.initializeState(MockStateSlice, { initialData: 'test' });
      
      const state = stateManager.getState(MockStateSlice);
      expect(state).toBeInstanceOf(MockStateSlice);
      expect(state.data).toBe('test');
    });

    it('should throw error when getting uninitialized state', () => {
      expect(() => {
        stateManager.getState(MockStateSlice);
      }).toThrow('State slice MockStateSlice not found');
    });

    it('should throw error when mutating uninitialized state', () => {
      expect(() => {
        stateManager.mutateState(MockStateSlice, (state) => state.data);
      }).toThrow('State slice MockStateSlice not found');
    });

    it('should initialize multiple state slices independently', () => {
      stateManager.initializeState(MockStateSlice, { initialData: 'first' });
      stateManager.initializeState(AnotherStateSlice, { initialData: 'second' });

      const mockState = stateManager.getState(MockStateSlice);
      const anotherState = stateManager.getState(AnotherStateSlice);

      expect(mockState.data).toBe('first');
      expect(anotherState.data).toBe('second');
    });
  });

  describe('State Mutation', () => {
    beforeEach(() => {
      stateManager.initializeState(MockStateSlice, { initialData: 'initial' });
    });

    it('should mutate state and return result', () => {
      const result = stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('updated');
        return state.data;
      });

      expect(result).toBe('updated');
    });

    it('should update the actual state after mutation', () => {
      stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('mutated');
      });

      const updatedState = stateManager.getState(MockStateSlice);
      expect(updatedState.data).toBe('mutated');
    });

    it('should return undefined when mutation callback returns nothing', () => {
      const result = stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('silent update');
      });

      expect(result).toBeUndefined();
    });
  });

  describe('Serialization', () => {
    beforeEach(() => {
      stateManager.initializeState(MockStateSlice, { initialData: 'serializable' });
      stateManager.initializeState(AnotherStateSlice, { initialData: 'also serializable' });
    });

    it('should serialize all state slices', () => {
      const serialized = stateManager.serialize();

      expect(serialized).toEqual({
        MockStateSlice: { data: 'serializable' },
        AnotherStateSlice: { data: 'also serializable' }
      });
    });

    it('should handle empty state manager', () => {
      const emptyManager = new StateManager<TestStateSlice>();
      const serialized = emptyManager.serialize();

      expect(serialized).toEqual({});
    });
  });

  describe('Deserialization', () => {
    beforeEach(() => {
      stateManager.initializeState(MockStateSlice, { initialData: 'initial' });
      stateManager.initializeState(AnotherStateSlice, { initialData: 'initial' });
    });

    it('should deserialize existing state slices', () => {
      const data = {
        MockStateSlice: { data: 'deserialized 1' },
        AnotherStateSlice: { data: 'deserialized 2' }
      };

      stateManager.deserialize(data);

      expect(stateManager.getState(MockStateSlice).data).toBe('deserialized 1');
      expect(stateManager.getState(AnotherStateSlice).data).toBe('deserialized 2');
    });

    it('should call onMissing callback for unknown state slices', () => {
      const data = {
        UnknownStateSlice: { data: 'unknown' }
      };

      const onMissing = vi.fn();

      stateManager.deserialize(data, onMissing);

      expect(onMissing).toHaveBeenCalledWith('UnknownStateSlice');
    });

    it('should not call onMissing when all slices are known', () => {
      const data = {
        MockStateSlice: { data: 'known' }
      };

      const onMissing = vi.fn();

      stateManager.deserialize(data, onMissing);

      expect(onMissing).not.toHaveBeenCalled();
    });
  });

  describe('Iteration', () => {
    beforeEach(() => {
      stateManager.initializeState(MockStateSlice, { initialData: 'first' });
      stateManager.initializeState(AnotherStateSlice, { initialData: 'second' });
    });

    it('should iterate over all state slices', () => {
      const iterated: string[] = [];
      
      stateManager.forEach((slice) => {
        iterated.push(slice.name);
      });

      expect(iterated).toContain('MockStateSlice');
      expect(iterated).toContain('AnotherStateSlice');
    });

    it('should provide entries iterator', () => {
      const entries = Array.from(stateManager.entries());
      
      expect(entries).toHaveLength(2);
      expect(entries[0][0]).toBe('MockStateSlice');
      expect(entries[1][0]).toBe('AnotherStateSlice');
      expect(entries[0][1]).toBeInstanceOf(MockStateSlice);
      expect(entries[1][1]).toBeInstanceOf(AnotherStateSlice);
    });
  });

  describe('Subscriptions', () => {
    beforeEach(() => {
      stateManager.initializeState(MockStateSlice, { initialData: 'initial' });
    });

    it('should subscribe to state changes', async () => {
      const callback = vi.fn();
      
      const unsubscribe = stateManager.subscribe(MockStateSlice, callback);

      await new Promise(resolve => setTimeout(resolve, 0));

      // Initial call should happen in the next tick
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(stateManager.getState(MockStateSlice));
      
      unsubscribe();
    });

    it('should trigger subscription on state mutation', () => {
      const callback = vi.fn();
      const unsubscribe = stateManager.subscribe(MockStateSlice, callback);

      callback.mockClear();

      stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('changed');
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data).toBe('changed');
      
      unsubscribe();
    });

    it('should unsubscribe from changes', () => {
      const callback = vi.fn();
      const unsubscribe = stateManager.subscribe(MockStateSlice, callback);

      callback.mockClear();
      unsubscribe();

      stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('changed');
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = stateManager.subscribe(MockStateSlice, callback1);
      const unsub2 = stateManager.subscribe(MockStateSlice, callback2);

      callback1.mockClear();
      callback2.mockClear();

      stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('changed');
      });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      
      unsub1();
      unsub2();
    });
  });

  describe('Async State Waiting', () => {
    beforeEach(() => {
      stateManager.initializeState(MockStateSlice, { initialData: 'initial' });
    });

    it('should resolve immediately if predicate already true', async () => {
      const result = await stateManager.waitForState(MockStateSlice, (state) => {
        return state.data === 'initial';
      });

      expect(result.data).toBe('initial');
    });

    it('should wait for state change', async () => {
      const waitPromise = stateManager.waitForState(MockStateSlice, (state) => {
        return state.data === 'changed';
      });

      // Change state after a short delay
      setTimeout(() => {
        stateManager.mutateState(MockStateSlice, (state) => {
          state.updateData('changed');
        });
      }, 10);

      const result = await waitPromise;
      expect(result.data).toBe('changed');
    });

    it('should handle timeout in timedWaitForState', async () => {
      await expect(stateManager.timedWaitForState(
        MockStateSlice,
        (state) => state.data === 'never',
        50
      )).rejects.toThrow('Timeout waiting for state MockStateSlice');
    });

    it('should resolve with timeout if condition met', async () => {
      const result = await stateManager.timedWaitForState(
        MockStateSlice,
        (state) => state.data === 'initial',
        100
      );

      expect(result.data).toBe('initial');
    });

    it('should handle timeout with state change', async () => {
      const waitPromise = stateManager.timedWaitForState(
        MockStateSlice,
        (state) => state.data === 'changed',
        50
      );

      setTimeout(() => {
        stateManager.mutateState(MockStateSlice, (state) => {
          state.updateData('changed');
        });
      }, 10);

      const result = await waitPromise;
      expect(result.data).toBe('changed');
    });
  });

  describe('Async Subscription', () => {
    beforeEach(() => {
      stateManager.initializeState(MockStateSlice, { initialData: 'initial' });
    });

    it('should complete immediately if signal already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const generator = stateManager.subscribeAsync(MockStateSlice, controller.signal);
      const results: any[] = [];

      for await (const state of generator) {
        results.push(state.data);
        break;
      }

      expect(results).toEqual([]);
    });

    it('should yield state updates', async () => {
      const controller = new AbortController();
      const generator = stateManager.subscribeAsync(MockStateSlice, controller.signal);
      const results: string[] = [];

      // Trigger state changes
      setTimeout(() => {
        stateManager.mutateState(MockStateSlice, (state) => {
          state.updateData('first change');
        });
      }, 15);

      setTimeout(() => {
        stateManager.mutateState(MockStateSlice, (state) => {
          state.updateData('second change');
        });
      }, 30);

      for await (const state of generator) {
        results.push(state.data);
        if (results.length >= 3) {
          controller.abort();
        }
      }

      expect(results.length).toEqual(3);
      expect(results[0]).toBe('initial');
    }, 3000);

    it('should handle abort during iteration', async () => {
      const controller = new AbortController();
      const generator = stateManager.subscribeAsync(MockStateSlice, controller.signal);
      
      // Start async iteration
      const iteratePromise = (async () => {
        for await (const state of generator) {
          break; // Exit immediately
        }
      })();

      controller.abort();
      await iteratePromise;
    }, 1000);

    it('should buffer multiple state updates', async () => {
      const controller = new AbortController();
      const generator = stateManager.subscribeAsync(MockStateSlice, controller.signal);
      
      // Trigger multiple rapid changes
      stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('change 1');
      });
      stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('change 2');
      });
      stateManager.mutateState(MockStateSlice, (state) => {
        state.updateData('change 3');
      });

      const results: string[] = [];
      const iteratePromise = (async () => {
        for await (const state of generator) {
          results.push(state.data);
          if (results.length >= 1) {
            controller.abort();
          }
        }
      })();

      await iteratePromise;

      expect(results.length).toBe(1);
      expect(results[0]).toBe('change 3');
    }, 2000);
  });

  describe('Interface Implementation', () => {
    it('should have all required methods from interface', () => {
      expect(typeof stateManager.getState).toBe('function');
      expect(typeof stateManager.mutateState).toBe('function');
      expect(typeof stateManager.initializeState).toBe('function');
    });
  });
});