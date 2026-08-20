import { describe, it, expect } from 'vitest';
import { colorRole, barsCleared } from '../src/colorContrast';

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
