import { describe, it, expect } from 'vitest';
import { CanvasBuildGate, selectionToReplay } from '../src/canvasBuild';

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
