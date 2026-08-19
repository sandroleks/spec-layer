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

  // --- Fix round 1: defects found by empirically running the emitter's
  // output against the installed js-yaml. Each test below reproduces the
  // exact failure the reviewer reported before the fix. ---

  it('escapes C0 control characters other than \\n \\r \\t (defect 1)', () => {
    // BEL and NUL alone: needsQuote had no reason to quote, so the raw byte
    // was embedded and load() threw "the stream contains non-printable characters".
    const v = { a: 'x\x07y', b: 'x\x00y' };
    expect(roundTrip(v)).toEqual(v);
    // Quoting triggered for an unrelated reason (trailing space) still has to
    // escape the control char, not just wrap it in quotes.
    const v2 = { a: 'x\x07 ' };
    expect(roundTrip(v2)).toEqual(v2);
    // Vertical tab and ESC, to cover more than one control char per the brief.
    const v3 = { a: 'x\x0by', b: 'x\x1by' };
    expect(roundTrip(v3)).toEqual(v3);
  });

  it('quotes a lone \\r instead of emitting it as a plain scalar (defect 2)', () => {
    const v = { a: 'line1\rline2' };
    expect(roundTrip(v)).toEqual(v);
  });

  it('quotes a key containing a newline instead of splitting it across lines (defect 3)', () => {
    const v = { 'a\nb': 'x' };
    expect(roundTrip(v)).toEqual(v);
    const v2 = { 'a\rb': 'x' };
    expect(roundTrip(v2)).toEqual(v2);
  });

  it('falls back to double-quoted for CRLF content instead of losing the \\r bytes (defect 4)', () => {
    const v = { a: 'line1\r\nline2' };
    expect(roundTrip(v)).toEqual(v);
  });

  it('quotes YAML 1.1 special floats in all their spellings, as strings (defect 5)', () => {
    const v = {
      a: '.inf', b: '+.inf', c: '-.inf', d: '.Inf', e: '.INF',
      f: '.nan', g: '.NaN', h: '.NAN', i: '+.nan', j: '-.nan',
    };
    const rt = roundTrip(v) as Record<string, unknown>;
    for (const k of Object.keys(v)) {
      expect(typeof rt[k]).toBe('string');
    }
    expect(rt).toEqual(v);
  });
});

describe('flow style for short scalar collections', () => {
  it('renders a short all-scalar sequence inline', () => {
    expect(toYaml({ values: ['Primary', 'Outline', 'Ghost'] }))
      .toBe('values: [Primary, Outline, Ghost]\n');
  });

  it('renders a short all-scalar map inline', () => {
    expect(toYaml({ size: { value: 8, unit: 'px' } }))
      .toBe('size: { value: 8, unit: px }\n');
  });

  it('renders a map of short sequences inline at both levels', () => {
    expect(toYaml({ when: { type: ['Primary'], size: ['Large'] } }))
      .toBe('when: { type: [Primary], size: [Large] }\n');
  });

  it('stays block when any member is itself a collection that is not short', () => {
    const long = Array.from({ length: 12 }, (_, i) => `value-number-${i}`);
    const out = toYaml({ options: long });
    expect(out).toContain('\n  - value-number-0');
    expect(out).not.toContain('[value-number-0');
  });

  it('stays block when the rendered flow form would exceed the width budget', () => {
    const out = toYaml({ note: { a: 'x'.repeat(60), b: 'y'.repeat(60) } });
    expect(out).toContain('\n  a: ');
    expect(out).not.toContain('{ a: ');
  });

  it('stays block for a string that cannot be inline', () => {
    // A multi-line string is already handled by the block scalar path and must
    // not be dragged into a flow collection.
    const out = toYaml({ wrap: { text: 'line one\nline two' } });
    expect(out).not.toContain('{ text:');
  });

  it('quotes inside flow style exactly as it does in block style', () => {
    // A value needing quotes must still get them, and a comma or brace in a
    // scalar must not be able to break out of the flow collection.
    expect(toYaml({ a: ['yes', 'no'] })).toBe('a: ["yes", "no"]\n');
    expect(toYaml({ a: ['x, y'] })).toBe('a: ["x, y"]\n');
    expect(toYaml({ a: ['{ z }'] })).toBe('a: ["{ z }"]\n');
  });

  it('renders an empty collection as it did before', () => {
    expect(toYaml({ a: [], b: {} })).toBe('a: []\nb: {}\n');
  });

  it('round-trips a nested flow map through js-yaml', () => {
    const value = { bindings: [{ path: 'Container', when: { type: ['Primary'] } }] };
    expect(load(toYaml(value))).toEqual(value);
  });
});
