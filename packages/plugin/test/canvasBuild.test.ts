import { describe, it, expect } from 'vitest';
import { CanvasBuildGate, selectionToReplay, settleBuild } from '../src/canvasBuild';

describe('CanvasBuildGate', () => {
  it('lets the first build in and refuses a second until the first ends, whichever family each is', () => {
    const gate = new CanvasBuildGate();
    expect(gate.busy).toBe(false);
    expect(gate.begin()).toBe(true);   // a component build
    expect(gate.busy).toBe(true);
    expect(gate.begin()).toBe(false);  // a foundation build asked while it runs
    gate.end();
    expect(gate.busy).toBe(false);
    expect(gate.begin()).toBe(true);
  });

  it('ending an idle gate is harmless, so a finally block can always call it', () => {
    const gate = new CanvasBuildGate();
    gate.end();
    expect(gate.busy).toBe(false);
    expect(gate.begin()).toBe(true);
  });

  it('tracks a skipped selectionchange across end(), reset only by the next begin()', () => {
    const gate = new CanvasBuildGate();
    gate.begin();
    expect(gate.skippedSelection).toBe(false);
    gate.noteSkipped();
    expect(gate.skippedSelection).toBe(true);
    gate.end();
    // still readable after end(): the finally block checks it right here.
    expect(gate.skippedSelection).toBe(true);
    gate.begin();
    expect(gate.skippedSelection).toBe(false);
  });
});

describe('selectionToReplay', () => {
  it('does not replay when nothing was skipped', () => {
    expect(selectionToReplay({
      skipped: false, current: ['b'], atBegin: ['a'], programmatic: null,
    })).toBe(false);
  });

  it('does not replay when the current selection is unchanged from begin()', () => {
    expect(selectionToReplay({
      skipped: true, current: ['a'], atBegin: ['a'], programmatic: null,
    })).toBe(false);
  });

  it('does not replay when the current selection is just the build\'s own generated Section', () => {
    expect(selectionToReplay({
      skipped: true, current: ['section-1'], atBegin: ['a'], programmatic: ['section-1'],
    })).toBe(false);
  });

  it('replays a genuinely new user selection made during the build', () => {
    expect(selectionToReplay({
      skipped: true, current: ['b'], atBegin: ['a'], programmatic: ['section-1'],
    })).toBe(true);
  });

  it('replays a cleared selection when the build made no programmatic selection of its own', () => {
    // programmatic: null (not []): a Foundation path never selects anything,
    // so it has no basis to claim "my own selection was empty" -- an empty
    // current here can only be the user's own deselect, and must replay.
    expect(selectionToReplay({
      skipped: true, current: [], atBegin: ['a'], programmatic: null,
    })).toBe(true);
  });
});

describe('settleBuild', () => {
  it('returns to the page before replying, then releases the gate and replays with no yield after the reply', async () => {
    const gate = new CanvasBuildGate();
    gate.begin();
    const order: string[] = [];
    await settleBuild({
      restorePage: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        order.push('restore');
      },
      reply: () => {
        order.push('reply');
        // Anything the reply sets off, even a microtask, runs only after the
        // gate has been released.
        queueMicrotask(() => order.push(gate.busy ? 'next: gate held' : 'next: gate open'));
      },
      release: () => { gate.end(); order.push('release'); },
      replay: () => { order.push('replay'); },
    });
    expect(order).toEqual(['restore', 'reply', 'release', 'replay', 'next: gate open']);
  });

  it('lets the next request the reply prompts take the gate (Update all sends the next row on each reply)', async () => {
    const gate = new CanvasBuildGate();
    gate.begin();
    let nextTook: boolean | null = null;
    let nextArrived!: () => void;
    const arrived = new Promise<void>((resolve) => { nextArrived = resolve; });
    await settleBuild({
      // A real page switch back, taking a task of its own: had the reply gone
      // out before it, the next request below would reach a held gate.
      restorePage: () => new Promise<void>((resolve) => { setTimeout(resolve, 0); }),
      // The UI round trip: the next updateFoundationDoc arrives as a new task.
      reply: () => { setTimeout(() => { nextTook = gate.begin(); nextArrived(); }, 0); },
      release: () => gate.end(),
      replay: () => {},
    });
    await arrived;
    expect(nextTook).toBe(true);
  });

  it('still replies, releases and replays when the page switch is rejected', async () => {
    const gate = new CanvasBuildGate();
    gate.begin();
    const order: string[] = [];
    await settleBuild({
      restorePage: () => Promise.reject(new Error('page was deleted')),
      reply: () => { order.push('reply'); },
      release: () => { gate.end(); order.push('release'); },
      replay: () => { order.push('replay'); },
    });
    expect(order).toEqual(['reply', 'release', 'replay']);
    expect(gate.busy).toBe(false);
  });
});
