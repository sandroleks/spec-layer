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
  states: [], tokens: [], related: [], gaps: [], layout: [], rawValues: [], contrast: [],
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
    const findings: ContrastFinding[] = checkContrast(spec, f);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      part: 'label', backgroundPart: 'Container',
      foreground: '#bbbbbb', background: '#ffffff', required: 4.5,
    });
    expect(findings[0].ratio).toBeLessThan(4.5);
  });

  it('reports nothing when the pair passes AA', () => {
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#595959' });
    expect(checkContrast(spec, f)).toEqual([]);
  });

  it('skips disabled variants, which WCAG exempts', () => {
    const disabled = baseSpec({
      ...spec,
      variantInstances: [{ nodeId: 'v0', name: 'State=Disabled', values: { State: 'Disabled' } }],
    });
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#bbbbbb' });
    expect(checkContrast(disabled, f)).toEqual([]);
  });

  it('reports nothing when the foundation cannot resolve a colour', () => {
    expect(checkContrast(spec, foundation({}))).toEqual([]);
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
    // should be emitted — least of all one blaming SiblingA's red.
    expect(checkContrast(hole, f)).toEqual([]);
  });
});
