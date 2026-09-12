import { describe, it, expect } from 'vitest';
import {
  bumpFor, compareBump, isSemver, nextVersion, compareChanges,
  type ChangeEntity, type ChangeKind, type LibraryChange,
} from '../src/libraryDiff';

describe('bumpFor', () => {
  const structural: ChangeEntity[] = [
    'component', 'property', 'option', 'variant_axis', 'state', 'anatomy_part', 'collection', 'mode', 'token',
  ];
  const valueLike: ChangeEntity[] = ['binding', 'value', 'token_value', 'style'];

  it.each(structural)('%s removed or renamed is major, added is minor, changed is patch', (entity) => {
    expect(bumpFor(entity, 'removed')).toBe('major');
    expect(bumpFor(entity, 'renamed')).toBe('major');
    expect(bumpFor(entity, 'added')).toBe('minor');
    expect(bumpFor(entity, 'changed')).toBe('patch');
  });

  it.each(valueLike)('%s is patch for every kind', (entity) => {
    const kinds: ChangeKind[] = ['added', 'removed', 'renamed', 'changed'];
    for (const kind of kinds) expect(bumpFor(entity, kind)).toBe('patch');
  });
});

describe('compareBump', () => {
  it('orders patch < minor < major', () => {
    expect(compareBump('patch', 'minor')).toBeLessThan(0);
    expect(compareBump('minor', 'major')).toBeLessThan(0);
    expect(compareBump('major', 'patch')).toBeGreaterThan(0);
    expect(compareBump('minor', 'minor')).toBe(0);
  });
});

describe('isSemver', () => {
  it('accepts three dotted integers and nothing else', () => {
    expect(isSemver('1.0.0')).toBe(true);
    expect(isSemver('10.20.30')).toBe(true);
    expect(isSemver('1.0')).toBe(false);
    expect(isSemver('v1.0.0')).toBe(false);
    expect(isSemver('1.0.0-beta')).toBe(false);
    expect(isSemver(null)).toBe(false);
    expect(isSemver(100)).toBe(false);
  });
});

describe('nextVersion', () => {
  it.each([
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'patch', '1.2.4'],
    [null, 'major', '1.0.0'],
    [null, 'minor', '1.0.0'],
    [null, 'patch', '1.0.0'],
  ] as const)('%s + %s = %s', (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected);
  });

  it('refuses a current version it cannot parse rather than guessing', () => {
    expect(() => nextVersion('1.2', 'patch')).toThrow(RangeError);
  });
});

describe('compareChanges', () => {
  const change = (over: Partial<LibraryChange>): LibraryChange => ({
    kind: 'added', entity: 'token', component: null, id: 'a', name: 'a',
    from: null, to: null, scope: null, bump: 'minor', ...over,
  });

  it('sorts foundation changes first, then by component, entity, id, scope, kind', () => {
    const sorted = [
      change({ component: 'Button', id: 'b' }),
      change({ component: null, id: 'z' }),
      change({ component: 'Button', id: 'a', scope: 'size Large' }),
      change({ component: 'Button', id: 'a', scope: null }),
    ].sort(compareChanges);
    expect(sorted.map((c) => `${c.component ?? ''}|${c.id}|${c.scope ?? ''}`)).toEqual([
      '|z|', 'Button|a|', 'Button|a|size Large', 'Button|b|',
    ]);
  });
});
