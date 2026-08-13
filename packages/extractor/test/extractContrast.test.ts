import { describe, it, expect } from 'vitest';
import { extract } from '../src/extract';
import type { FoundationSpec } from '../src/foundation';
import type { SerializedNode } from '../src/tree';

/**
 * Integration coverage for the ONE production path into the contrast feature:
 * extract() called with meta.foundation.
 *
 * checkContrast's own unit tests drive it with hand-built IntermediateSpecs, which
 * verifies the maths and the skip rules but not the composition around them. Every
 * defect the branch review found in this feature lived in that composition: the
 * AA threshold coming from the default variant's metrics while every variant was
 * measured, an empty finding list being rendered as a WCAG AA pass, and part names
 * colliding across subtrees. All three were invisible because no test anywhere
 * called extract() with a foundation, so these tests go through extract() and
 * assert on spec.contrast, exactly as the plugin does.
 */

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

const CORE = foundation({
  'surface/default': '#ffffff',
  'text/faint': '#cccccc',   // 1.61:1 on white — fails at any size
  'text/mid': '#8a8a8a',     // 3.45:1 on white — passes large text, fails small
  'text/strong': '#595959',  // 7.0:1 on white — passes
  'text/aaa': '#000000',
  'text/zzz': '#dddddd',     // 1.36:1 on white
});

/** A single-variant COMPONENT_SET: painted root, one TEXT child. */
function oneVariant(label: SerializedNode): SerializedNode {
  return {
    id: 'set', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: { Style: { type: 'VARIANT', defaultValue: 'Filled', variantOptions: ['Filled'] } },
    children: [{
      id: 'v0', name: 'Style=Filled', type: 'COMPONENT', visible: true,
      bindings: [{ property: 'fills', token: 'surface/default' }],
      children: [label],
    }],
  };
}

const boundLabel = (token: string): SerializedNode => ({
  id: 'l', name: 'label', type: 'TEXT', visible: true,
  bindings: [{ property: 'fills', token }, { property: 'typography', token: 'type/body' }],
  text: { fontSize: 14, fontWeight: 400 },
});

describe('extract() with a foundation — contrast composition', () => {
  it('reports a genuinely failing text and background pair as a finding', () => {
    const spec = extract(oneVariant(boundLabel('text/faint')), { figmaFile: 'F', foundation: CORE });
    expect(spec.contrast.findings).toHaveLength(1);
    expect(spec.contrast.findings[0]).toMatchObject({
      part: 'label', backgroundPart: 'Container',
      foreground: '#cccccc', background: '#ffffff', required: 4.5,
    });
    expect(spec.contrast.findings[0].ratio).toBeLessThan(2);
    expect(spec.contrast).toMatchObject({ evaluated: 1, skipped: 0 });
  });

  it('counts a passing pair as evaluated, so the doc can state a checkable count', () => {
    const spec = extract(oneVariant(boundLabel('text/strong')), { figmaFile: 'F', foundation: CORE });
    expect(spec.contrast).toEqual({ evaluated: 1, skipped: 0, findings: [] });
  });

  it('counts a hardcoded text fill as skipped, not as a pass', () => {
    // The label's colour is hardcoded (#cccccc on white is 1.61:1, a blatant
    // failure). There is no variable to resolve, so nothing can be measured.
    const hardcoded: SerializedNode = {
      id: 'l', name: 'label', type: 'TEXT', visible: true,
      hasUnboundPaint: true, unboundFill: '#cccccc',
      bindings: [{ property: 'typography', token: 'type/body' }],
      text: { fontSize: 14, fontWeight: 400 },
    };
    const spec = extract(oneVariant(hardcoded), { figmaFile: 'F', foundation: CORE });
    expect(spec.contrast).toEqual({ evaluated: 0, skipped: 1, findings: [] });
    // The same run already knows the colour is unchecked: it says so in gaps.
    // A "meets WCAG AA" line next to this gap would contradict our own output.
    expect(spec.gaps).toContainEqual({ part: 'label', issue: 'hardcoded color (no variable or style)' });
  });

  it('counts a part name duplicated across subtrees as skipped', () => {
    const card: SerializedNode = {
      id: 'set', name: 'Card', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Style: { type: 'VARIANT', defaultValue: 'Plain', variantOptions: ['Plain'] } },
      children: [{
        id: 'v0', name: 'Style=Plain', type: 'COMPONENT', visible: true,
        bindings: [{ property: 'fills', token: 'surface/default' }],
        children: [
          {
            id: 'h', name: 'header', type: 'FRAME', visible: true,
            children: [{
              id: 'h1', name: 'label', type: 'TEXT', visible: true,
              bindings: [{ property: 'fills', token: 'text/aaa' }], text: { fontSize: 14 },
            }],
          },
          {
            id: 'f', name: 'footer', type: 'FRAME', visible: true,
            children: [{
              id: 'f1', name: 'label', type: 'TEXT', visible: true,
              bindings: [{ property: 'fills', token: 'text/zzz' }], text: { fontSize: 14 },
            }],
          },
        ],
      }],
    };
    const spec = extract(card, { figmaFile: 'F', foundation: CORE });
    // Part names are sibling-scoped, so both labels are called "label" and the
    // two fill rules are indistinguishable by name. text/zzz fails at 1.36:1 and
    // text/aaa passes; whichever sorts first would decide the verdict.
    expect(spec.tokens.filter((t) => t.part === 'label' && t.property === 'fill')).toHaveLength(2);
    // Two anatomy parts go unchecked, and the section says two, not one.
    expect(spec.contrast).toEqual({ evaluated: 0, skipped: 2, findings: [] });
  });

  /** A size axis where only the label's font size differs between variants. */
  function sizeAxis(defaultValue: 'S' | 'L'): SerializedNode {
    const variant = (name: string, fontSize: number, id: string): SerializedNode => ({
      id, name, type: 'COMPONENT', visible: true,
      bindings: [{ property: 'fills', token: 'surface/default' }],
      children: [{
        id: `${id}-l`, name: 'label', type: 'TEXT', visible: true,
        bindings: [{ property: 'fills', token: 'text/mid' }, { property: 'typography', token: 'type/body' }],
        text: { fontSize, fontWeight: 400 },
      }],
    });
    return {
      id: 'set', name: 'Chip', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Size: { type: 'VARIANT', defaultValue, variantOptions: ['L', 'S'] } },
      children: [variant('Size=L', 24, 'vL'), variant('Size=S', 12, 'vS')],
    };
  }

  it('applies each variant its own AA threshold: large passes at 3:1 while small fails', () => {
    // #8a8a8a on #ffffff is 3.45:1: compliant for the 24px variant (3:1) and a
    // real failure for the 12px one (4.5:1). The threshold has to come from the
    // variant being measured, not from whichever variant Figma calls default.
    const withLargeDefault = extract(sizeAxis('L'), { figmaFile: 'F', foundation: CORE });
    expect(withLargeDefault.contrast.findings).toHaveLength(1);
    expect(withLargeDefault.contrast.findings[0]).toMatchObject({
      part: 'label', variant: 'Size=S', required: 4.5,
    });
    expect(withLargeDefault.contrast.findings[0].ratio).toBeCloseTo(3.45, 1);

    // Flipping which variant is the default must not change the verdict, and in
    // particular must never produce a finding that names the compliant 24px
    // variant while demanding 4.5:1 of it.
    const withSmallDefault = extract(sizeAxis('S'), { figmaFile: 'F', foundation: CORE });
    expect(withSmallDefault.contrast.findings).toHaveLength(1);
    expect(withSmallDefault.contrast.findings[0]).toMatchObject({
      part: 'label', variant: 'Size=S', required: 4.5,
    });
  });

  it('measures nothing when no foundation is passed, and says so rather than passing', () => {
    // This is the drift path (extract() with no foundation). It must not look
    // like a clean audit result.
    const spec = extract(oneVariant(boundLabel('text/faint')), { figmaFile: 'F' });
    expect(spec.contrast).toEqual({ evaluated: 0, skipped: 0, findings: [] });
  });
});
