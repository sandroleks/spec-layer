import { describe, expect, it } from 'vitest';
import { foundationFingerprint } from '../src/foundationFingerprint';

const vars = [
  { id: 'VariableID:2', name: 'color/primary', collectionId: 'C:1' },
  { id: 'VariableID:1', name: 'space/sm', collectionId: 'C:2' },
];
const styles = [
  { id: 'S:b', name: 'Body' },
  { id: 'S:a', name: 'Shadow/1' },
];

describe('foundationFingerprint', () => {
  it('does not depend on input order', () => {
    expect(foundationFingerprint(vars, styles))
      .toBe(foundationFingerprint([...vars].reverse(), [...styles].reverse()));
  });

  it('changes on a rename, a deletion, and an addition', () => {
    const base = foundationFingerprint(vars, styles);
    const renamed = [{ ...vars[0], name: 'color/brand' }, vars[1]];
    expect(foundationFingerprint(renamed, styles)).not.toBe(base);
    expect(foundationFingerprint(vars, [styles[0]])).not.toBe(base);
    expect(foundationFingerprint([...vars, { id: 'VariableID:3', name: 'x', collectionId: 'C:1' }], styles)).not.toBe(base);
  });

  it('changes when a variable moves collection', () => {
    const moved = [{ ...vars[0], collectionId: 'C:9' }, vars[1]];
    expect(foundationFingerprint(moved, styles)).not.toBe(foundationFingerprint(vars, styles));
  });

  it('keeps a name containing the separator distinct from two names', () => {
    const a = foundationFingerprint([{ id: 'V:1', name: 'a\u001fb', collectionId: 'C' }], []);
    const b = foundationFingerprint([{ id: 'V:1', name: 'a', collectionId: 'b\u001fC' }], []);
    expect(a).not.toBe(b);
  });

  it('has a fixed shape with no variables or styles', () => {
    expect(foundationFingerprint([], [])).toBe('v:|s:');
  });
});
