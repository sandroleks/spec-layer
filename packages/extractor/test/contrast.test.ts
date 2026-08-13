import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio, blend, requiredRatio } from '../src/contrast';
import { resolveTokenColor, checkContrast, type ContrastFinding } from '../src/contrast';
import type { FoundationSpec } from '../src/foundation';
import type { IntermediateSpec } from '../src/extract';

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(near(relativeLuminance('#000000'), 0)).toBe(true);
    expect(near(relativeLuminance('#ffffff'), 1)).toBe(true);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(near(contrastRatio('#000000', '#ffffff'), 21, 0.05)).toBe(true);
  });
  it('is 1:1 for a colour against itself', () => {
    expect(near(contrastRatio('#3366cc', '#3366cc'), 1)).toBe(true);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 10);
  });
  it('matches a known reference pair', () => {
    // #767676 on #ffffff is the canonical "exactly AA" grey.
    expect(near(contrastRatio('#767676', '#ffffff'), 4.54, 0.02)).toBe(true);
  });
});

describe('blend', () => {
  it('returns the foreground at full alpha', () => {
    expect(blend('#ff0000', 1, '#ffffff')).toBe('#ff0000');
  });
  it('returns the background at zero alpha', () => {
    expect(blend('#ff0000', 0, '#ffffff')).toBe('#ffffff');
  });
  it('composites at half alpha', () => {
    expect(blend('#000000', 0.5, '#ffffff')).toBe('#808080');
  });
});

describe('requiredRatio', () => {
  it('is 3 for 24px and above', () => {
    expect(requiredRatio(24, 400)).toBe(3);
  });
  it('is 3 for 18.66px bold', () => {
    expect(requiredRatio(18.66, 700)).toBe(3);
  });
  it('is 4.5 for 18.66px regular', () => {
    expect(requiredRatio(18.66, 400)).toBe(4.5);
  });
  it('is 4.5 for small text and when the size is unknown', () => {
    expect(requiredRatio(14, 700)).toBe(4.5);
    expect(requiredRatio(undefined, undefined)).toBe(4.5);
  });

  // The cases above pin each boundary only from ABOVE, so widening a boundary
  // downward (>= 24 becoming >= 20, or the bold rule becoming >= 16 at weight
  // >= 600) leaves every one of them green while silently relaxing AA for real
  // text. These pin the same boundaries from just below.
  it('is 4.5 just below every large-text boundary', () => {
    expect(requiredRatio(23, 400)).toBe(4.5);   // just under the 24px cutoff
    expect(requiredRatio(18, 700)).toBe(4.5);   // bold, but under 18.66px
    expect(requiredRatio(18.66, 600)).toBe(4.5); // big enough, but under weight 700
  });
});

const foundation = (vars: Record<string, string>): FoundationSpec => ({
  fileKey: 'f', extractedAt: '', textStyles: [],
  collections: [{
    id: 'c1', name: 'Core', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }],
    variables: Object.entries(vars).map(([name, hex]) => ({
      name, group: 'g', resolvedType: 'COLOR' as const, description: '', codeSyntax: {},
      valuesByMode: { m1: { kind: 'color' as const, hex, alpha: 1 } },
    })),
  }],
});

const baseSpec = (over: Partial<IntermediateSpec>): IntermediateSpec => ({
  name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: 'n',
  anatomy: [], anatomyComponentId: 'n', props: [], variants: [], variantInstances: [],
  states: [], tokens: [], related: [], gaps: [], layout: [], rawValues: [], contrast: { evaluated: 0, skipped: 0, findings: [] },
  ...over,
});

describe('resolveTokenColor', () => {
  it('resolves a colour variable in its collection default mode', () => {
    expect(resolveTokenColor(foundation({ 'text/muted': '#767676' }), 'text/muted'))
      .toEqual({ hex: '#767676', alpha: 1 });
  });
  it('returns null for an unknown token', () => {
    expect(resolveTokenColor(foundation({}), 'nope')).toBeNull();
  });
});

describe('checkContrast', () => {
  const spec = baseSpec({
    anatomy: [
      { id: 'c', name: 'Container', type: 'FRAME', nested: false, depth: 0 },
      { id: 'l', name: 'label', type: 'TEXT', nested: false, depth: 1 },
    ],
    variantInstances: [{ nodeId: 'v0', name: 'Style=Filled', values: { Style: 'Filled' } }],
    tokens: [
      { part: 'Container', property: 'fill', conditions: {}, token: 'surface/default' },
      { part: 'label', property: 'fill', conditions: {}, token: 'text/faint' },
    ],
  });

  it('flags text below AA against its nearest painted ancestor', () => {
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#bbbbbb' });
    const report = checkContrast(spec, f);
    const findings: ContrastFinding[] = report.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      part: 'label', backgroundPart: 'Container',
      foreground: '#bbbbbb', background: '#ffffff', required: 4.5,
    });
    expect(findings[0].ratio).toBeLessThan(4.5);
    // A failing pair is still a MEASURED pair: it counts as evaluated, not skipped.
    expect(report.evaluated).toBe(1);
    expect(report.skipped).toBe(0);
  });

  it('counts a passing pair as evaluated rather than reporting nothing at all', () => {
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#595959' });
    expect(checkContrast(spec, f)).toEqual({ evaluated: 1, skipped: 0, findings: [] });
  });

  it('skips disabled variants, which WCAG exempts', () => {
    const disabled = baseSpec({
      ...spec,
      variantInstances: [{ nodeId: 'v0', name: 'State=Disabled', values: { State: 'Disabled' } }],
    });
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#bbbbbb' });
    // Nothing was measured and nothing is claimed: an exempt variant is not a
    // pass, so `evaluated` stays 0.
    expect(checkContrast(disabled, f)).toEqual({ evaluated: 0, skipped: 0, findings: [] });
  });

  it('counts an unresolvable colour as skipped, never as a pass', () => {
    expect(checkContrast(spec, foundation({}))).toEqual({ evaluated: 0, skipped: 1, findings: [] });
  });

  it('counts a text part with no fill rule at all as skipped', () => {
    // The overwhelmingly common real case: the label's colour is hardcoded, so
    // extractTokens emits no fill rule for it and extractGaps reports it as a
    // hardcoded colour. Claiming AA here would contradict our own gap report.
    const hardcoded = baseSpec({
      ...spec,
      tokens: [{ part: 'Container', property: 'fill', conditions: {}, token: 'surface/default' }],
    });
    expect(checkContrast(hardcoded, foundation({ 'surface/default': '#ffffff' })))
      .toEqual({ evaluated: 0, skipped: 1, findings: [] });
  });

  it('skips a part whose name is not unique in the anatomy', () => {
    // header > label and footer > label are two parts with one name. Every
    // lookup in checkContrast is by that flat name, so the first matching rule
    // wins and either verdict would be a coin toss.
    const collided = baseSpec({
      anatomy: [
        { id: 'c', name: 'Container', type: 'FRAME', nested: false, depth: 0 },
        { id: 'h', name: 'header', type: 'FRAME', nested: false, depth: 1 },
        { id: 'h1', name: 'label', type: 'TEXT', nested: false, depth: 2 },
        { id: 'f', name: 'footer', type: 'FRAME', nested: false, depth: 1 },
        { id: 'f1', name: 'label', type: 'TEXT', nested: false, depth: 2 },
      ],
      variantInstances: [{ nodeId: 'v0', name: 'Style=Filled', values: { Style: 'Filled' } }],
      tokens: [
        { part: 'Container', property: 'fill', conditions: {}, token: 'surface/default' },
        { part: 'label', property: 'fill', conditions: {}, token: 'text/aaa' },
        { part: 'label', property: 'fill', conditions: {}, token: 'text/zzz' },
      ],
    });
    // text/zzz on white is 1.36:1, a blatant failure; text/aaa passes. Which
    // one first-match-wins picks is arbitrary, so neither verdict is reported.
    // Both labels are counted: they are two parts on the frame, and the reason
    // neither can be checked is precisely that they cannot be told apart.
    const f = foundation({ 'surface/default': '#ffffff', 'text/aaa': '#000000', 'text/zzz': '#dddddd' });
    expect(checkContrast(collided, f)).toEqual({ evaluated: 0, skipped: 2, findings: [] });
  });

  it('skips a translucent background rather than assuming a white page behind it', () => {
    const translucent: FoundationSpec = {
      fileKey: 'f', extractedAt: '', textStyles: [],
      collections: [{
        id: 'c1', name: 'Core', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }],
        variables: [
          {
            name: 'surface/default', group: 'g', resolvedType: 'COLOR', description: '', codeSyntax: {},
            valuesByMode: { m1: { kind: 'color', hex: '#ffffff', alpha: 0.5 } },
          },
          {
            name: 'text/faint', group: 'g', resolvedType: 'COLOR', description: '', codeSyntax: {},
            valuesByMode: { m1: { kind: 'color', hex: '#bbbbbb', alpha: 1 } },
          },
        ],
      }],
    };
    // Compositing over an assumed white page would report 1.9:1 as a finding,
    // but on a dark page the real ratio is different. Unknown, so unchecked.
    expect(checkContrast(spec, translucent)).toEqual({ evaluated: 0, skipped: 1, findings: [] });
  });

  // Anatomy is depth-first pre-order, not a tree of pointers: the entry
  // immediately preceding a part at some smaller depth is not necessarily its
  // ancestor. It can be an earlier, already-closed sibling subtree at that
  // same shallower depth. A naive "closest earlier entry with smaller depth"
  // scan would walk straight through an unpainted true parent and latch onto
  // that unrelated sibling's fill — a real background, but not the one behind
  // this text. Depth-first order guarantees the FIRST smaller-depth entry
  // scanning backward is always the immediate parent (nothing between them
  // has a smaller depth), so resolution must climb the ancestor chain level
  // by level (parent, then grandparent, ...), not jump to any earlier
  // lower-depth entry.
  it('does not attribute an earlier sibling subtree as the background when the true parent is unpainted', () => {
    const hole = baseSpec({
      anatomy: [
        { id: 'a', name: 'SiblingA', type: 'FRAME', nested: false, depth: 0 },
        { id: 'a1', name: 'SiblingAChild', type: 'FRAME', nested: false, depth: 1 },
        { id: 'b', name: 'SiblingB', type: 'FRAME', nested: false, depth: 0 },
        { id: 'l', name: 'label', type: 'TEXT', nested: false, depth: 1 },
      ],
      variantInstances: [{ nodeId: 'v0', name: 'Style=Filled', values: { Style: 'Filled' } }],
      tokens: [
        // SiblingA (an earlier, unrelated sibling of label's true parent) is
        // painted red. SiblingB, label's actual parent, is never assigned a
        // fill at all.
        { part: 'SiblingA', property: 'fill', conditions: {}, token: 'surface/red' },
        { part: 'label', property: 'fill', conditions: {}, token: 'text/faint' },
      ],
    });
    const f = foundation({ 'surface/red': '#ff0000', 'text/faint': '#bbbbbb' });
    // No ancestor of label resolves to a colour (SiblingB has no fill, and
    // there is no depth-0 'Container' part in this fixture), so no finding
    // should be emitted — least of all one blaming SiblingA's red. The pair is
    // unchecked, so it counts as skipped rather than passing.
    expect(checkContrast(hole, f)).toEqual({ evaluated: 0, skipped: 1, findings: [] });
  });

  it('uses the large-text threshold when the part carries bold 24px metrics', () => {
    const spec = baseSpec({
      anatomy: [
        { id: 'c', name: 'Container', type: 'FRAME', nested: false, depth: 0 },
        { id: 'l', name: 'label', type: 'TEXT', nested: false, depth: 1, text: { fontSize: 24, fontWeight: 700 } },
      ],
      variantInstances: [{ nodeId: 'v0', name: 'Style=Filled', values: { Style: 'Filled' } }],
      tokens: [
        { part: 'Container', property: 'fill', conditions: {}, token: 'surface/default' },
        { part: 'label', property: 'fill', conditions: {}, token: 'text/faint' },
      ],
    });
    // 3.5:1 fails AA for normal text but passes for large text.
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#949494' });
    expect(checkContrast(spec, f)).toEqual({ evaluated: 1, skipped: 0, findings: [] });
  });
});
