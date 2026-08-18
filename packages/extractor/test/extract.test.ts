import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { extract } from '../src/extract';
import { contentHash } from '../src/hash';
import { resolveTokensForVariant } from '../src/resolve';
import { extractTokens, variantAxisModel } from '../src/tokens';
import button from './fixtures/button.json';
import type { SerializedNode } from '../src/tree';

const root = button as SerializedNode;
const meta = { figmaFile: 'FILE1' };

/** A COMPONENT_SET whose variants each carry one `bg` fill binding. */
function makeVariantSet(children: { name: string; token: string }[]): SerializedNode {
  let id = 0;
  return {
    id: 'set', name: 'Set', type: 'COMPONENT_SET', visible: true,
    children: children.map((c) => ({
      id: `v${id++}`, name: c.name, type: 'COMPONENT', visible: true,
      children: [{
        id: `n${id++}`, name: 'bg', type: 'FRAME', visible: true,
        bindings: [{ property: 'fills', token: c.token }],
      }],
    })),
  };
}

describe('extract', () => {
  it('assembles the full intermediate spec', () => {
    const spec = extract(root, meta);
    expect(spec.name).toBe(root.name);
    expect(spec.anatomy.length).toBeGreaterThan(0);
    expect(spec.props.length).toBe(4);
    // Order comes from detectStateMatrix's lifecycle ranking. "Hovered" is
    // recognized as the participle of "hover" (STATE_ORDER in
    // statesMatrix.ts lists both), ranking right after it, so lifecycle
    // order agrees with the fixture's declaration order here.
    expect(spec.states).toEqual(['Enabled', 'Hovered', 'Disabled']);
    expect(spec.tokens.length).toBeGreaterThan(0);
    expect(spec.gaps.length).toBe(4);
    expect(spec.layout).toEqual([
      { part: 'container', summary: 'horizontal, padding 10/24/10/24, gap 8' },
    ]);
  });

  it('hash is stable across key order and changes when content changes', () => {
    const a = extract(root, meta);
    expect(contentHash(a)).toBe(contentHash(JSON.parse(JSON.stringify(a))));
    const b = extract({ ...root, name: 'Button2' }, meta);
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

// B1: extractTokens and toVariantInstances must share one axis model, so
// every variantInstance's `values` can resolve the rules extractTokens emits.
describe('axis model consistency between tokens and variantInstances (B1)', () => {
  const ownFill = (spec: ReturnType<typeof extract>, name: string, token: string) => {
    const inst = spec.variantInstances.find((i) => i.name === name)!;
    expect(inst).toBeDefined();
    const resolved = resolveTokensForVariant(spec.tokens, inst.values);
    expect(resolved).toContainEqual({ part: 'bg', property: 'fill', token });
  };

  it('mixed parseable and unparseable names: every instance resolves its own tokens', () => {
    const spec = extract(makeVariantSet([
      { name: 'Style=Filled', token: 'color/filled' },
      { name: 'Ghost Mode', token: 'color/ghost' },
    ]), meta);
    // One unparseable sibling forces the Variant pseudo-axis for ALL instances.
    for (const inst of spec.variantInstances) {
      expect(inst.values).toEqual({ Variant: inst.name });
    }
    ownFill(spec, 'Style=Filled', 'color/filled');
    ownFill(spec, 'Ghost Mode', 'color/ghost');
  });

  it('inconsistent axis key-sets fall back to the Variant pseudo-axis everywhere', () => {
    const spec = extract(makeVariantSet([
      { name: 'A=1', token: 'color/one' },
      { name: 'A=1, B=2', token: 'color/two' },
    ]), meta);
    for (const inst of spec.variantInstances) {
      expect(inst.values).toEqual({ Variant: inst.name });
    }
    ownFill(spec, 'A=1', 'color/one');
    ownFill(spec, 'A=1, B=2', 'color/two');
  });

  it('consistent names keep parsed axis values and still resolve', () => {
    const spec = extract(root, meta);
    for (const inst of spec.variantInstances) {
      expect(Object.keys(inst.values).sort()).toEqual(['State', 'Style']);
      expect(resolveTokensForVariant(spec.tokens, inst.values).length).toBeGreaterThan(0);
    }
  });

  it('extractTokens conditions follow the axis model it is PASSED, not one it recomputes', () => {
    const set: SerializedNode = {
      id: 'root', name: 'C', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Size: { type: 'VARIANT', variantOptions: ['S', 'M'] } },
      children: [
        { id: 'v0', name: 'Size=S', type: 'COMPONENT', visible: true, bindings: [{ property: 'fills', token: 'tok/a' }] },
        { id: 'v1', name: 'Size=M', type: 'COMPONENT', visible: true, bindings: [{ property: 'fills', token: 'tok/b' }] },
      ],
    };

    // Left to itself, extractTokens parses these names into a real `Size` axis.
    expect(extractTokens(set).map((r) => r.conditions)).toEqual([{ Size: ['S'] }, { Size: ['M'] }]);

    // Now hand it the OTHER model variantAxisModel can produce: the `Variant`
    // pseudo-axis fallback, which fires for real whenever any sibling name is
    // not axis=value shaped. Asserting the passed model wins is the only way
    // this test can fail when the parameter is ignored. Comparing against
    // `extractTokens(set)` (the expression the default branch computes
    // internally) is a tautology: it passes even if the parameter is dropped
    // entirely, which breaks the agreement with toVariantInstances that the
    // shared model exists to guarantee.
    const collapsed = {
      variants: set.children!,
      combos: [{ Variant: 'Size=S' }, { Variant: 'Size=M' }],
    };
    expect(extractTokens(set, collapsed)).toEqual([
      { part: 'Container', path: 'Container', property: 'fill', conditions: { Variant: ['Size=S'] }, token: 'tok/a' },
      { part: 'Container', path: 'Container', property: 'fill', conditions: { Variant: ['Size=M'] }, token: 'tok/b' },
    ]);

    // And the shared-model path still agrees with the default when the model
    // handed in IS the one variantAxisModel computes.
    expect(extractTokens(set, variantAxisModel(set))).toEqual(extractTokens(set));
  });
});

it('carries no contrast field', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  // `tsc` catches this at the type level, but a stored spec deserialized from
  // pluginData is plain JSON with no type, so the runtime shape matters too.
  expect('contrast' in spec).toBe(false);
});
