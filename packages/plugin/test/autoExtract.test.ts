import { afterEach, describe, it, expect, vi } from 'vitest';
import { autoExtract, createState } from '../src/ui/actions';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autoExtract', () => {
  it('does nothing without a selected node', () => {
    const onReading = vi.fn();
    autoExtract(createState(), onReading);
    expect(onReading).not.toHaveBeenCalled();
  });

  it('reports ready immediately when a spec is already extracted', () => {
    const state = createState();
    state.currentSpec = { name: 'x' } as never;
    state.currentNode = { id: '1', name: 'x' } as never;
    const onReady = vi.fn();
    autoExtract(state, vi.fn(), onReady);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('brackets deferred extraction with reading state and then reports ready', () => {
    const state = createState();
    state.currentNode = {
      id: '1:1',
      name: 'Button',
      type: 'COMPONENT',
      visible: true,
      children: [],
    };
    const events: string[] = [];
    let scheduled: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      scheduled = callback;
      return 1;
    });

    autoExtract(
      state,
      (reading) => { events.push(`reading:${reading}`); },
      () => { events.push('ready'); },
    );

    expect(events).toEqual(['reading:true']);
    expect(state.currentSpec).toBeNull();
    scheduled?.(0);
    expect(state.currentSpec?.name).toBe('Button');
    expect(events).toEqual(['reading:true', 'reading:false', 'ready']);
  });

  it('clears reading state and reports ready even when extraction fails', () => {
    const state = createState();
    const broken = {} as Record<string, unknown>;
    Object.defineProperty(broken, 'name', {
      get: () => { throw new Error('broken node'); },
    });
    state.currentNode = broken as never;
    const events: string[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    expect(() => {
      autoExtract(
        state,
        (reading) => { events.push(`reading:${reading}`); },
        () => { events.push('ready'); },
      );
    }).not.toThrow();

    expect(events).toEqual(['reading:true', 'reading:false', 'ready']);
    expect(state.currentSpec).toBeNull();
  });
});
