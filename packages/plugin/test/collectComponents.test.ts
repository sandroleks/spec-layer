import { describe, it, expect } from 'vitest';
import { isAtomComponentName } from '../src/collectComponents';

describe('isAtomComponentName', () => {
  it('recognizes names that begin with a period as atom components', () => {
    expect(isAtomComponentName('.button-base')).toBe(true);
    expect(isAtomComponentName('.icon-parts')).toBe(true);
  });

  it('treats names with a non-leading period as non-atoms', () => {
    expect(isAtomComponentName('Button/.label')).toBe(false);
    expect(isAtomComponentName('Button')).toBe(false);
  });
});
