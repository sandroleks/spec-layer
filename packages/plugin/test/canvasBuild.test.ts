import { describe, it, expect } from 'vitest';
import { CanvasBuildGate } from '../src/canvasBuild';

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
});
