import { describe, expect, it } from 'vitest';
import { ProgrammaticSelection } from '../src/programmaticSelection';

describe('ProgrammaticSelection', () => {
  it('suppresses the exact generated document selection once', () => {
    const guard = new ProgrammaticSelection();
    guard.expect('doc:1');
    expect(guard.consume(['doc:1'])).toBe(true);
    expect(guard.consume(['doc:1'])).toBe(false);
  });

  it('lets a different user selection through and clears the expectation', () => {
    const guard = new ProgrammaticSelection();
    guard.expect('doc:1');
    expect(guard.consume(['component:2'])).toBe(false);
    expect(guard.consume(['doc:1'])).toBe(false);
  });

  it('can cancel an expectation when selecting the document throws', () => {
    const guard = new ProgrammaticSelection();
    guard.expect('doc:1');
    guard.cancel();
    expect(guard.consume(['doc:1'])).toBe(false);
  });
});
