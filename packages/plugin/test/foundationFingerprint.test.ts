import { describe, expect, it } from 'vitest';
import { FingerprintBaseline, foundationFingerprint } from '../src/foundationFingerprint';

describe('FingerprintBaseline', () => {
  it('matches nothing before the first scan', async () => {
    const baseline = new FingerprintBaseline();
    expect(await baseline.matches('v')).toBe(false);
  });

  it('matches the value the last scan read, and only that', async () => {
    const baseline = new FingerprintBaseline();
    baseline.set(Promise.resolve('v1'));
    expect(await baseline.matches('v1')).toBe(true);
    expect(await baseline.matches('v2')).toBe(false);
  });

  it('never matches a probe whose own read failed', async () => {
    const baseline = new FingerprintBaseline();
    baseline.set(Promise.resolve('v1'));
    expect(await baseline.matches(null)).toBe(false);
  });

  it('falls toward scanning when the scan\'s read fails', async () => {
    const baseline = new FingerprintBaseline();
    baseline.set(Promise.reject(new Error('unreadable')));
    expect(await baseline.matches('v1')).toBe(false);
  });

  // A probe can arrive while a scan is still running. It must compare with
  // the read that scan started, not the one before it, or a scan that just
  // saw a rename would be followed by a second full scan for nothing.
  it('waits for the read of a scan still in progress', async () => {
    const baseline = new FingerprintBaseline();
    baseline.set(Promise.resolve('old'));
    let finish!: (value: string) => void;
    baseline.set(new Promise<string>((resolve) => { finish = resolve; }));
    const answer = baseline.matches('new');
    finish('new');
    expect(await answer).toBe(true);
  });
});

const vars = [
  { id: 'VariableID:2', name: 'color/primary', collectionId: 'C:1' },
  { id: 'VariableID:1', name: 'space/sm', collectionId: 'C:2' },
];

describe('foundationFingerprint', () => {
  it('does not depend on input order', () => {
    expect(foundationFingerprint(vars)).toBe(foundationFingerprint([...vars].reverse()));
  });

  it('changes on a rename, a deletion, and an addition', () => {
    const base = foundationFingerprint(vars);
    const renamed = [{ ...vars[0], name: 'color/brand' }, vars[1]];
    expect(foundationFingerprint(renamed)).not.toBe(base);
    expect(foundationFingerprint([vars[0]])).not.toBe(base);
    expect(foundationFingerprint([...vars, { id: 'VariableID:3', name: 'x', collectionId: 'C:1' }])).not.toBe(base);
  });

  it('changes when a variable moves collection', () => {
    const moved = [{ ...vars[0], collectionId: 'C:9' }, vars[1]];
    expect(foundationFingerprint(moved)).not.toBe(foundationFingerprint(vars));
  });

  it('keeps a name containing the separator distinct from two names', () => {
    const a = foundationFingerprint([{ id: 'V:1', name: 'a\u001fb', collectionId: 'C' }]);
    const b = foundationFingerprint([{ id: 'V:1', name: 'a', collectionId: 'b\u001fC' }]);
    expect(a).not.toBe(b);
  });

  it('is empty with no variables', () => {
    expect(foundationFingerprint([])).toBe('');
  });

  it('changes when a FLOAT value changes in one mode', () => {
    const base = [{ id: 'V:1', name: 'space/sm', collectionId: 'C', values: { 'M:1': 8, 'M:2': 12 } }];
    const edited = [{ ...base[0], values: { 'M:1': 8, 'M:2': 16 } }];
    expect(foundationFingerprint(edited)).not.toBe(foundationFingerprint(base));
  });

  it('does not depend on mode key order', () => {
    const a = [{ id: 'V:1', name: 'space/sm', collectionId: 'C', values: { 'M:1': 8, 'M:2': 12 } }];
    const b = [{ id: 'V:1', name: 'space/sm', collectionId: 'C', values: { 'M:2': 12, 'M:1': 8 } }];
    expect(foundationFingerprint(a)).toBe(foundationFingerprint(b));
  });

  it('keeps a variable without values unaffected by another variable\'s values', () => {
    const color = { id: 'V:1', name: 'color/primary', collectionId: 'C' };
    const spaceA = { id: 'V:2', name: 'space/sm', collectionId: 'C', values: { 'M:1': 8 } };
    const spaceB = { ...spaceA, values: { 'M:1': 10 } };
    const entryOf = (fp: string): string => fp.split('\u001f')[0];
    expect(entryOf(foundationFingerprint([color, spaceA])))
      .toBe(entryOf(foundationFingerprint([color, spaceB])));
    expect(entryOf(foundationFingerprint([color, spaceA]))).toBe(JSON.stringify(['V:1', 'color/primary', 'C']));
  });

  it('encodes values as sorted mode pairs', () => {
    const fp = foundationFingerprint([{ id: 'V:1', name: 'r', collectionId: 'C', values: { b: 2, a: 1 } }]);
    expect(fp).toBe(JSON.stringify(['V:1', 'r', 'C', [['a', 1], ['b', 2]]]));
  });
});
