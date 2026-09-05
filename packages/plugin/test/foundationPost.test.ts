import { describe, it, expect } from 'vitest';
import { FoundationPostGate } from '../src/foundationPost';

describe('FoundationPostGate', () => {
  it('hands over a dump the UI has not seen', () => {
    const gate = new FoundationPostGate();
    const dump = { fileKey: 'F' };
    expect(gate.fresh(dump)).toBe(dump);
  });

  it('withholds the same object on the next selection', () => {
    const gate = new FoundationPostGate();
    const dump = { fileKey: 'F' };
    gate.fresh(dump);
    expect(gate.fresh(dump)).toBeUndefined();
    expect(gate.fresh(dump)).toBeUndefined();
  });

  it('hands over a refreshed dump even when its content is equal', () => {
    const gate = new FoundationPostGate();
    gate.fresh({ fileKey: 'F' });
    const refreshed = { fileKey: 'F' };
    expect(gate.fresh(refreshed)).toBe(refreshed);
  });

  it('treats a dump posted through another message as seen', () => {
    const gate = new FoundationPostGate();
    const dump = { fileKey: 'F' };
    gate.fresh(dump); // requestFoundation posted it on the 'foundation' message
    expect(gate.fresh(dump)).toBeUndefined(); // the next 'selection' omits it
  });
});
