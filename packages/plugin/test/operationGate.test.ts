import { describe, expect, it } from 'vitest';
import {
  beginOperation,
  createOperationGate,
  deferSelection,
  finishOperation,
} from '../src/ui/viewModel/operationGate';

describe('component operation gate', () => {
  it('allows selection normally when no build is active', () => {
    expect(deferSelection(createOperationGate())).toBe(false);
  });

  it('defers selection during a build and applies it once when the build ends', () => {
    const gate = createOperationGate();
    expect(beginOperation(gate)).toBe(true);
    expect(deferSelection(gate)).toBe(true);
    expect(deferSelection(gate)).toBe(true);
    expect(finishOperation(gate)).toBe(true);
    expect(finishOperation(gate)).toBe(false);
  });

  it('refuses overlapping component operations', () => {
    const gate = createOperationGate();
    expect(beginOperation(gate)).toBe(true);
    expect(beginOperation(gate)).toBe(false);
  });
});
