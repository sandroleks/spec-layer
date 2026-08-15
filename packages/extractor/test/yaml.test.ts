import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { toYaml, type YamlValue } from '../src/yaml';

/** Parse our own output with a real YAML implementation. This is the whole
 *  point of the dev dependency: the emitter is hand-rolled, so something that
 *  actually knows YAML has to confirm it round-trips. */
function roundTrip(v: YamlValue): unknown {
  return load(toYaml(v));
}

describe('toYaml', () => {
  it('emits scalars and nested maps', () => {
    const v = { a: 1, b: 'two', c: true, d: null, e: { f: 'g' } };
    expect(roundTrip(v)).toEqual(v);
  });

  it('omits undefined keys entirely rather than emitting null', () => {
    const out = toYaml({ a: 'x', b: undefined });
    expect(out).not.toContain('b');
    expect(roundTrip({ a: 'x', b: undefined })).toEqual({ a: 'x' });
  });

  it('emits lists of maps', () => {
    const v = { items: [{ name: 'a', n: 1 }, { name: 'b', n: 2 }] };
    expect(roundTrip(v)).toEqual(v);
  });

  it('emits an empty list inline', () => {
    expect(toYaml({ items: [] })).toBe('items: []\n');
  });

  it('quotes strings YAML would otherwise reinterpret', () => {
    const v = {
      hex: '#2563EB',
      colon: 'Style: Filled',
      yes: 'yes',
      no: 'no',
      numeric: '123',
      leading: ' padded',
      trailing: 'padded ',
      empty: '',
      dash: '- not a list',
      brace: '{not a map}',
      at: '@handle',
      tick: '`backtick',
      quote: "it's quoted",
      tilde: '~',
    };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips multi-line prose', () => {
    const v = { definition: 'Line one.\nLine two.\n\nLine four.' };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips multi-line text with trailing spaces on a line', () => {
    const v = { definition: 'Line one.   \nLine two.' };
    expect(roundTrip(v)).toEqual(v);
  });

  it('is deterministic', () => {
    const v = { b: 1, a: [{ z: 'x' }] };
    expect(toYaml(v)).toBe(toYaml(v));
  });

  it('ends with exactly one newline', () => {
    const out = toYaml({ a: 1 });
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  // --- Supplementary edge cases called out in the task brief as easy to get
  // subtly wrong. Not part of the brief's Step 2 fixture, added to prove they
  // actually work rather than take the sketch on faith. ---

  it('emits an empty map inline', () => {
    expect(toYaml({ meta: {} })).toBe('meta: {}\n');
    expect(roundTrip({ meta: {} })).toEqual({ meta: {} });
  });

  it('round-trips a map nested directly inside a list item', () => {
    const v = { rows: [{ a: { x: 1, y: 2 }, b: 'sibling' }] };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips a list nested directly inside a list item', () => {
    const v = { rows: [{ a: [1, 2, 3], b: 'sibling' }] };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips a bare list of lists (list directly inside a list item, no map wrapper)', () => {
    const v = { rows: [[1, 2], [3, 4]] };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips strings that are exactly the reserved words, as strings', () => {
    const v = { a: 'yes', b: 'no', c: '~', d: '123', e: '' };
    const rt = roundTrip(v) as Record<string, unknown>;
    for (const k of Object.keys(v)) {
      expect(typeof rt[k]).toBe('string');
    }
    expect(rt).toEqual(v);
  });

  it('round-trips multiple trailing newlines without dropping trailing blank lines', () => {
    const v = { a: 'x\n\n' };
    expect(roundTrip(v)).toEqual(v);
    const v2 = { a: 'x\n\n\n' };
    expect(roundTrip(v2)).toEqual(v2);
  });

  it('round-trips a string that is a single newline', () => {
    const v = { a: '\n' };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips deeply nested lists of maps containing lists', () => {
    const v = {
      sections: [
        { name: 'first', items: [{ id: 1, tags: ['a', 'b'] }, { id: 2, tags: [] }] },
        { name: 'second', items: [] },
      ],
    };
    expect(roundTrip(v)).toEqual(v);
  });
});
