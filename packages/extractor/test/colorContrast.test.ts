import { describe, it, expect } from 'vitest';
import { colorRole, barsCleared, colorContrast, CONTRAST_AXIS_CAP } from '../src/colorContrast';
import type { FoundationSpec, FoundationValue } from '../src/foundation';
import * as packageRoot from '../src/index';

describe('colorRole', () => {
  it('reads text, icon, stroke, border and content as foreground', () => {
    expect(colorRole('color/text/primary/default')).toBe('foreground');
    expect(colorRole('color/icon/neutral/default')).toBe('foreground');
    expect(colorRole('color/stroke/primary/focus')).toBe('foreground');
    expect(colorRole('color/border/subtle')).toBe('foreground');
    expect(colorRole('color/content/muted')).toBe('foreground');
  });

  it('reads surface, background, bg, fill, canvas and base as background', () => {
    expect(colorRole('color/surface/primary/default')).toBe('background');
    expect(colorRole('color/background/page')).toBe('background');
    expect(colorRole('color/bg/subtle')).toBe('background');
    expect(colorRole('color/fill/neutral')).toBe('background');
    expect(colorRole('color/canvas/default')).toBe('background');
    expect(colorRole('color/base/white')).toBe('background');
  });

  it('resolves a name carrying both words by first match in path order', () => {
    // "text" at segment 1 wins over "surface" inside "on-surface" at segment 2.
    expect(colorRole('color/text/on-surface/default')).toBe('foreground');
    expect(colorRole('color/icon/on-surface/default')).toBe('foreground');
    // The reverse order resolves the other way, which is what makes it a rule
    // rather than a special case for the on-surface convention.
    expect(colorRole('color/surface/text-ish/default')).toBe('background');
  });

  it('treats an on- prefixed segment as foreground before splitting it', () => {
    expect(colorRole('color/on-surface/default')).toBe('foreground');
    expect(colorRole('color/on-background/muted')).toBe('foreground');
  });

  it('splits a hyphenated segment to find a role word', () => {
    expect(colorRole('color/bg-subtle/default')).toBe('background');
    expect(colorRole('color/text-muted/default')).toBe('foreground');
  });

  it('reads foreground and fg, the mirrors of background and bg', () => {
    // These were absent while `background` and `bg` were both present: pure
    // asymmetry with no design reason. Their absence silently dropped every
    // text token in any shadcn / Radix / Tailwind v4 library, which would hand
    // colorContrast a matrix with an EMPTY foreground axis.
    expect(colorRole('color/foreground')).toBe('foreground');
    expect(colorRole('color/muted-foreground')).toBe('foreground');
    expect(colorRole('color/card-foreground')).toBe('foreground');
    expect(colorRole('color/fg/default')).toBe('foreground');
  });

  it('keeps background and bg classifying as background', () => {
    // The foreground set is tested first within a segment, so adding the
    // mirrors must not capture their opposites.
    expect(colorRole('color/background/page')).toBe('background');
    expect(colorRole('color/bg/subtle')).toBe('background');
  });

  it('resolves a flat X-on-Y name by its role word, not by the tail', () => {
    // The `on-` guard fires only when a segment STARTS with `on-`, so in a flat
    // fg-on-surface name the guard misses, the hyphen split runs, and `surface`
    // in the tail used to win: the exact inversion the on- rule exists to
    // prevent. A leading role word now settles it first.
    expect(colorRole('color/fg-on-surface/default')).toBe('foreground');
    expect(colorRole('color/foreground-on-surface/default')).toBe('foreground');
  });

  it('is case insensitive', () => {
    expect(colorRole('Color/Surface/Primary')).toBe('background');
    expect(colorRole('COLOR/TEXT/PRIMARY')).toBe('foreground');
  });

  it('returns null when no segment carries a role word', () => {
    expect(colorRole('colors/blue/500')).toBeNull();
    expect(colorRole('brand/1')).toBeNull();
    expect(colorRole('')).toBeNull();
  });

  it('does not match a role word as a substring of a longer word', () => {
    // "subtext" is not "text", and "basement" is not "base". Substring matching
    // would misclassify both, and silently.
    expect(colorRole('color/subtext/default')).toBeNull();
    expect(colorRole('color/basement/default')).toBeNull();
  });

  it('skips empty segments from leading, trailing and repeated slashes', () => {
    expect(colorRole('/color/text/')).toBe('foreground');
    expect(colorRole('color//text//default')).toBe('foreground');
    expect(colorRole('///')).toBeNull();
    expect(colorRole('/')).toBeNull();
  });

  it('reads a segment that is exactly "on" as foreground', () => {
    // The bare segment is the degenerate form of the on- convention, so it
    // resolves the same way rather than falling through to a word match.
    expect(colorRole('color/on/default')).toBe('foreground');
  });

  it('trims whitespace around a segment before matching it', () => {
    expect(colorRole('color/  text  /default')).toBe('foreground');
    expect(colorRole('color/ on-surface /default')).toBe('foreground');
    expect(colorRole('   ')).toBeNull();
  });

  it('finds a role word in the last segment as readily as the first', () => {
    // Nothing privileges an early segment except order, so a name that only
    // says what it is at the leaf still classifies.
    expect(colorRole('color/brand/primary/text')).toBe('foreground');
    expect(colorRole('color/brand/primary/surface')).toBe('background');
  });

  it('claims any on- prefixed segment as foreground, colour role or not', () => {
    // A known and accepted false positive: the on- rule keys off the prefix
    // alone, so a name that happens to start a segment with on- is read as a
    // foreground. Narrowing it to known role words would give up the whole
    // point of the rule, which is to classify any on- segment as content drawn
    // on something.
    expect(colorRole('color/on-demand/highlight')).toBe('foreground');
    expect(colorRole('color/on-brand/default')).toBe('foreground');
    // The prefix is on- with the hyphen, so a word merely starting "on" is
    // not caught.
    expect(colorRole('color/only/default')).toBeNull();
    expect(colorRole('color/one-off/default')).toBeNull();
  });

  it('splits only on hyphens, so other separators inside a segment do not', () => {
    // A limitation of the convention this reads, not of the walk: names that
    // separate words with spaces, underscores or dots are not classified.
    expect(colorRole('color/text primary/default')).toBeNull();
    expect(colorRole('color/text_primary/default')).toBeNull();
    expect(colorRole('color.text.primary')).toBeNull();
  });
});

describe('barsCleared', () => {
  it('clears nothing below 3:1', () => {
    expect(barsCleared(2.23)).toEqual([]);
    expect(barsCleared(1)).toEqual([]);
  });
  it('clears aa-large from 3:1', () => {
    expect(barsCleared(3)).toEqual(['aa-large']);
    expect(barsCleared(4.22)).toEqual(['aa-large']);
  });
  it('clears aa from 4.5:1', () => {
    expect(barsCleared(4.5)).toEqual(['aa-large', 'aa']);
    expect(barsCleared(6.94)).toEqual(['aa-large', 'aa']);
  });
  it('clears aaa from 7:1', () => {
    expect(barsCleared(7)).toEqual(['aa-large', 'aa', 'aaa']);
    expect(barsCleared(21)).toEqual(['aa-large', 'aa', 'aaa']);
  });
  it('returns bars in ascending strictness so the last is the strongest', () => {
    expect(barsCleared(21)[2]).toBe('aaa');
  });

  it('clears a bar exactly at its threshold, so the comparisons are >= not >', () => {
    // Full float precision one step below each threshold. If any comparison
    // were >, the exact-threshold cases above would return one bar fewer, and
    // if any threshold were nudged down, these would return one bar more.
    expect(barsCleared(2.9999999999999996)).toEqual([]);
    expect(barsCleared(4.499999999999999)).toEqual(['aa-large']);
    expect(barsCleared(6.999999999999999)).toEqual(['aa-large', 'aa']);
  });

  it('returns [] for NaN, which is not distinguishable from a failing pair', () => {
    // Every comparison against NaN is false, so a NaN ratio reports the same
    // empty list as a genuinely low-contrast pair. Left as is on purpose: the
    // question this function answers is which bars a ratio clears, and NaN
    // clears none. A ratio can only be NaN because the luminance maths that
    // produced it was fed something invalid, so the place to catch that is
    // where the ratio is computed, not here, where rejecting it would mean a
    // second return shape for a case that cannot arise from valid colours.
    expect(barsCleared(NaN)).toEqual([]);
  });

  it('does not range check, so out of range ratios report by the same rule', () => {
    // A real contrast ratio is bounded to 1 through 21, but nothing here
    // depends on that and nothing clamps it. Values below 1 clear no bar for
    // the same reason 1 clears none, and values above 21 clear all three for
    // the same reason 21 does, so a range check would add a failure mode
    // without adding information. An out of range ratio is an upstream bug,
    // and clamping it here would hide it.
    expect(barsCleared(0)).toEqual([]);
    expect(barsCleared(-1)).toEqual([]);
    expect(barsCleared(-Infinity)).toEqual([]);
    expect(barsCleared(21.5)).toEqual(['aa-large', 'aa', 'aaa']);
    expect(barsCleared(Infinity)).toEqual(['aa-large', 'aa', 'aaa']);
  });

  it('returns a fresh array each call, so a caller mutating it changes nothing', () => {
    const first = barsCleared(7);
    first.push('aaa');
    expect(barsCleared(7)).toEqual(['aa-large', 'aa', 'aaa']);
  });
});

const hex = (h: string, alpha = 1): FoundationValue => ({ kind: 'color', hex: h, alpha });

function spec(
  variables: { name: string; valuesByMode: Record<string, FoundationValue> }[],
  modes = [{ modeId: 'm1', name: 'Light' }],
): FoundationSpec {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-08-18T00:00:00.000Z',
    textStyles: [],
    collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 'm1', modes,
      variables: variables.map((v) => ({
        name: v.name, group: '', resolvedType: 'COLOR' as const,
        description: '', codeSyntax: {}, valuesByMode: v.valuesByMode,
      })),
    }],
  };
}

describe('colorContrast', () => {
  it('measures every foreground against every background', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/text/b', valuesByMode: { m1: hex('#000000') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#722ed1') } },
    ]));
    expect(r.matrices).toHaveLength(1);
    expect(r.matrices[0].foregrounds).toEqual(['color/text/a', 'color/text/b']);
    expect(r.matrices[0].backgrounds).toEqual(['color/surface/x']);
    expect(r.measured).toBe(2);
  });

  it('reproduces the known Button failures', () => {
    const r = colorContrast(spec([
      { name: 'color/text/on-surface/default', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/text/primary/default', valuesByMode: { m1: hex('#722ed1') } },
      { name: 'color/surface/primary/disabled', valuesByMode: { m1: hex('#a9aeb8') } },
      { name: 'color/surface/primary/light-press', valuesByMode: { m1: hex('#ddbef6') } },
    ]));
    const f = (fg: string, bg: string) =>
      r.failures.find((x) => x.foreground.token === fg && x.background.token === bg);
    const disabled = f('color/text/on-surface/default', 'color/surface/primary/disabled')!;
    expect(disabled.ratio).toBeCloseTo(2.22, 2);  // floored from 2.2261, never rounded up
    expect(disabled.clears).toEqual([]);
    // 4.22 clears aa-large but not aa, so it is not a failure by the bar-based
    // definition and must NOT appear in `failures`.
    const press = r.matrices[0].cells[1][1]!;
    expect(press.ratio).toBeCloseTo(4.21, 2);  // floored from 4.2189, never rounded up
    expect(press.clears).toEqual(['aa-large']);
  });

  it('measures each mode separately', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff'), m2: hex('#000000') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#000000'), m2: hex('#ffffff') } },
    ], [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }]));
    expect(r.matrices.map((m) => m.mode)).toEqual(['Light', 'Dark']);
    expect(r.matrices[0].cells[0][0]!.ratio).toBeCloseTo(21, 1);
    expect(r.matrices[1].cells[0][0]!.ratio).toBeCloseTo(21, 1);
  });

  it('composites a translucent foreground over its background', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#000000', 0.5) } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#ffffff') } },
    ]));
    // #000 at 50% over white is #808080, which is about 3.95:1 against white.
    expect(r.matrices[0].cells[0][0]!.ratio).toBeCloseTo(3.95, 1);
  });

  it('skips a translucent background as unknowable', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#722ed1', 0.5) } },
    ]));
    expect(r.matrices[0].cells[0][0]).toBeNull();
    expect(r.measured).toBe(0);
  });

  it('counts colours that classify as neither role', () => {
    const r = colorContrast(spec([
      { name: 'colors/blue/500', valuesByMode: { m1: hex('#722ed1') } },
      { name: 'brand/1', valuesByMode: { m1: hex('#000000') } },
    ]));
    expect(r.unclassified).toBe(2);
    expect(r.matrices).toEqual([]);
    expect(r.measured).toBe(0);
  });

  it('caps each axis and reports how many tokens it dropped', () => {
    const many = Array.from({ length: CONTRAST_AXIS_CAP + 3 }, (_, i) => ({
      name: `color/text/t${i}`, valuesByMode: { m1: hex('#000000') },
    }));
    const r = colorContrast(spec([
      ...many,
      { name: 'color/surface/x', valuesByMode: { m1: hex('#ffffff') } },
    ]));
    expect(r.matrices[0].foregrounds).toHaveLength(CONTRAST_AXIS_CAP);
    expect(r.omitted).toBe(3);
  });

  it('ignores non-colour variables', () => {
    const s = spec([{ name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } }]);
    s.collections[0].variables.push({
      name: 'space/4', group: '', resolvedType: 'FLOAT',
      description: '', codeSyntax: {}, valuesByMode: { m1: { kind: 'number', value: 16 } },
    });
    const r = colorContrast(s);
    expect(r.unclassified).toBe(0);
  });
});

describe('colorContrast edge cases', () => {
  it('leaves a cell null where a variable has no value for that mode', () => {
    // The foreground exists only in Light. Dark therefore measures nothing, and
    // the missing cell is null rather than a fabricated ratio.
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#000000'), m2: hex('#111111') } },
    ], [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }]));
    expect(r.matrices[1].cells).toEqual([[null]]);
    expect(r.measured).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it('follows an alias to its colour and nulls one that never resolved', () => {
    // Role comes from the name, so an alias classifies either way; only the
    // value decides whether the pair can be measured.
    const alias = (target: string, resolved: FoundationValue | null): FoundationValue =>
      ({ kind: 'alias', targetName: target, targetCollection: 'Primitives', external: resolved === null, resolved });
    const r = colorContrast(spec([
      { name: 'color/text/unresolved', valuesByMode: { m1: alias('base/white', null) } },
      { name: 'color/text/resolved', valuesByMode: { m1: alias('base/white', hex('#ffffff')) } },
      { name: 'color/surface/x', valuesByMode: { m1: alias('base/black', hex('#000000')) } },
    ]));
    expect(r.unclassified).toBe(0);
    expect(r.matrices[0].cells[0]).toEqual([null]);
    expect(r.matrices[0].cells[1][0]!.ratio).toBeCloseTo(21, 1);
    expect(r.measured).toBe(1);
  });

  it('leaves a cell null for a value that resolved to nothing at all', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/surface/x', valuesByMode: { m1: { kind: 'unresolved', reason: 'external' } } },
    ]));
    expect(r.matrices[0].cells).toEqual([[null]]);
    expect(r.measured).toBe(0);
  });

  it('emits no matrix for a collection with no modes', () => {
    // Without a mode there is nothing to look a value up by, so an empty matrix
    // would carry no information and would read as "checked, all fine".
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#000000') } },
    ], []));
    expect(r.matrices).toEqual([]);
    expect(r.measured).toBe(0);
  });

  it('emits no matrix when a collection declares no background at all', () => {
    // Two foregrounds and nothing to sit them on. They are not `unclassified`,
    // because their names did declare a role, and they are not `omitted`,
    // because no cap dropped them. Only `measured` being 0 says nothing ran.
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/text/b', valuesByMode: { m1: hex('#000000') } },
    ]));
    expect(r).toEqual({
      measured: 0, unclassified: 0, omitted: 0, matrices: [], failures: [],
    });
  });

  const capSpec = () => spec([
    { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
    { name: 'color/text/b', valuesByMode: { m1: hex('#eeeeee') } },
    { name: 'color/surface/x', valuesByMode: { m1: hex('#000000') } },
    { name: 'color/surface/y', valuesByMode: { m1: hex('#111111') } },
  ]);

  it('measures nothing at a cap of 0 and reports every classified token omitted', () => {
    const r = colorContrast(capSpec(), 0);
    expect(r.matrices).toEqual([]);
    expect(r.measured).toBe(0);
    expect(r.omitted).toBe(4);
  });

  it('still measures the first pair at a cap of 1', () => {
    const r = colorContrast(capSpec(), 1);
    expect(r.matrices[0].foregrounds).toEqual(['color/text/a']);
    expect(r.matrices[0].backgrounds).toEqual(['color/surface/x']);
    expect(r.measured).toBe(1);
    expect(r.omitted).toBe(2);
  });

  it('sums the overflow of both axes without counting any variable twice', () => {
    // 5 foregrounds and 4 backgrounds at a cap of 2 keeps 2 of each and drops
    // 3 + 2. Every variable sits on exactly one axis, so 5 is the count of
    // distinct dropped variables, which is what `omitted` claims to be.
    const r = colorContrast(spec([
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `color/text/t${i}`, valuesByMode: { m1: hex('#000000') },
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        name: `color/surface/s${i}`, valuesByMode: { m1: hex('#ffffff') },
      })),
    ]), 2);
    expect(r.omitted).toBe(5);
    expect(r.measured).toBe(4);
  });

  it('takes axis order from the collection and repeats it exactly', () => {
    // No sort: each axis is in the order the collection lists its variables, so
    // the same input always produces byte-identical output. Sorting would be a
    // second, competing order for a reader comparing the matrix against Figma.
    const s = spec([
      { name: 'color/surface/z', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/text/b', valuesByMode: { m1: hex('#000000') } },
      { name: 'color/text/a', valuesByMode: { m1: hex('#722ed1') } },
      { name: 'color/surface/a', valuesByMode: { m1: hex('#000000') } },
    ]);
    const first = colorContrast(s);
    expect(first.matrices[0].foregrounds).toEqual(['color/text/b', 'color/text/a']);
    expect(first.matrices[0].backgrounds).toEqual(['color/surface/z', 'color/surface/a']);
    expect(colorContrast(s)).toEqual(first);
  });

  it('never reports a bar the exact ratio does not clear', () => {
    // This test previously pinned the opposite, and pinned a real defect. The
    // ratio was rounded, so white on #959595 (2.9953:1) was published as
    // "3.00, clears aa-large": a conformance claim the colours do not meet. The
    // old rationale was that the printed number and the bars must agree, which
    // is right, and that rounding was the way to get it, which was wrong.
    // Flooring achieves the same agreement without ever overstating, because 3,
    // 4.5 and 7 are all exactly representable at two decimals, so a floored
    // ratio clears a bar if and only if the exact ratio does.
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#959595') } },
    ]));
    expect(r.matrices[0].cells[0][0]).toEqual({ ratio: 2.99, clears: [] });
    expect(r.failures).toHaveLength(1);
  });

  it('denies AA to a brand blue that misses it by a thousandth', () => {
    // #0078d7 on white is 4.4988:1 and fails AA. Rounding published it as
    // "4.5:1 AA". This is the ordinary, non-contrived case: a reviewer found
    // 13,600 such false passes across 10.2 million real colour pairs, and zero
    // when flooring.
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#0078d7') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#ffffff') } },
    ]));
    expect(r.matrices[0].cells[0][0]).toEqual({ ratio: 4.49, clears: ['aa-large'] });
  });

  it('carries each collection\'s own unclassified and omitted counts on its matrix', () => {
    // The report's top-level totals are foundation-global. A consumer drawing ONE
    // collection's grid needs that collection's numbers, and nothing downstream
    // can recover them from a total: reporting a global count beside one grid
    // tells a reader that tokens were dropped from a collection they were not
    // dropped from.
    const foundation = spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#000000') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#ffffff') } },
    ]);
    foundation.collections.push({
      id: 'c2', name: 'Primitives', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Light' }],
      variables: [
        { name: 'palette/blue/500', group: '', resolvedType: 'COLOR' as const,
          description: '', codeSyntax: {}, valuesByMode: { m1: hex('#0000ff') } },
        { name: 'palette/red/500', group: '', resolvedType: 'COLOR' as const,
          description: '', codeSyntax: {}, valuesByMode: { m1: hex('#ff0000') } },
      ],
    });
    const r = colorContrast(foundation);
    // Two unclassified palette colours, both in Primitives, none in Semantic.
    expect(r.unclassified).toBe(2);
    const semantic = r.matrices.find((m) => m.collection === 'Semantic')!;
    expect(semantic.unclassified).toBe(0);
    expect(semantic.omitted).toBe(0);
    // Primitives classified nothing, so it emits no matrix to carry its counts;
    // the foundation total is where they remain visible.
    expect(r.matrices.map((m) => m.collection)).toEqual(['Semantic']);
  });

  it('records the composited foreground value on a failure, not the raw hex', () => {
    // A translucent foreground fails at the colour a user actually sees, so the
    // failure has to name that colour or the ratio cannot be reproduced.
    const r = colorContrast(spec([
      { name: 'color/text/faint', valuesByMode: { m1: hex('#000000', 0.1) } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#ffffff') } },
    ]));
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].foreground).toEqual({ token: 'color/text/faint', value: '#e6e6e6' });
    expect(r.failures[0].background).toEqual({ token: 'color/surface/x', value: '#ffffff' });
    expect(r.failures[0].clears).toEqual([]);
  });

  it('is exported from the package root', () => {
    expect(packageRoot.colorContrast).toBe(colorContrast);
    expect(packageRoot.CONTRAST_AXIS_CAP).toBe(CONTRAST_AXIS_CAP);
    expect(packageRoot.colorRole).toBe(colorRole);
    expect(packageRoot.barsCleared).toBe(barsCleared);
  });
});
