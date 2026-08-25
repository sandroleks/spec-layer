import { describe, it, expect } from 'vitest';
import { validate } from '../src/validate';
import { extract } from '../src/extract';
import type { SerializedNode, TokenRef, RefIdentity } from '../src/tree';

/** A rule and a binding both carry a full identity now. These tests are about
 *  validation findings, not resolution, so one identity is minted per token
 *  NAME — which is exactly what a name meant before the identity fields
 *  existed. */
const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });
const bind = (property: string, token: string): TokenRef => ({ property, ...ident(token) });

const base = () => ({
  name: 'Button', figmaKey: '', figmaFile: 'F', figmaNode: '1:1',
  anatomy: [], anatomyComponentId: '1:1', props: [], variants: [],
  variantInstances: [], states: [], tokens: [], related: [], gaps: [],
  layout: [], rawValues: [],
});

describe('validate', () => {
  it('flags a default variant bound to a token naming another state', () => {
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { type: ['Primary'], size: ['Large'] },
      ...ident('color/surface/primary/disabled') }] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toContain('default-state-uses-state-token');
    expect(f[0].message).toContain('disabled');
  });

  it('does not flag a binding whose own condition names that state', () => {
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { disabled: ['True'] },
      ...ident('color/surface/primary/disabled') }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('flags a rendered geometry value disagreeing with its bound token', () => {
    const spec = { ...base(),
      tokens: [{ part: 'Container', path: 'Container', property: 'border-radius',
                 conditions: {}, ...ident('rd-sm') }],
      layout: [{ part: 'Container', path: 'Container',
                 summary: 'horizontal, radius 4', values: { radius: 4 } }] };
    const f = validate(spec as never, new Map([['rd-sm', 8]]));
    const hit = f.find((x) => x.id === 'geometry-token-mismatch')!;
    expect(hit.message).toContain('4');
    expect(hit.message).toContain('8');
  });

  it('flags one path and property bound to two tokens under the same condition', () => {
    const spec = { ...base(), tokens: [
      { part: 'vector', path: 'Container/vector', property: 'border-color',
        conditions: { loading: ['True'] }, ...ident('color/icon/primary/primary') },
      { part: 'vector', path: 'Container/vector', property: 'border-color',
        conditions: { loading: ['True'] }, ...ident('color/stroke/primary/default') },
    ] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toContain('duplicate-conflicting-binding');
  });

  it('flags more than one state-like axis instead of silently taking the first', () => {
    const spec = { ...base(), variants: [
      { prop: 'state', values: ['Default', 'Hover'] },
      { prop: 'tone', values: ['Success', 'Warning', 'Error'] },
    ] };
    const f = validate(spec as never, new Map());
    const hit = f.find((x) => x.id === 'ambiguous-state-axis')!;
    expect(hit.message).toContain('state');
    expect(hit.message).toContain('tone');
  });

  it('mirrors each unbound gap', () => {
    const spec = { ...base(), gaps: [{ part: 'Label', path: 'Container/Label',
      property: 'itemSpacing', issue: 'hardcoded-value' as const, value: 8 }] };
    const f = validate(spec as never, new Map());
    const hit = f.find((x) => x.id === 'unbound-value')!;
    expect(hit.path).toBe('Container/Label');
    expect(hit.property).toBe('itemSpacing');
  });

  it('returns an empty array for a clean component', () => {
    expect(validate(base() as never, new Map())).toEqual([]);
  });

  // --- False-positive regressions found in self-review -------------------

  it('does not flag a token whose state word is only a fragment of an unrelated word', () => {
    // "compressed" contains the substring "press", but names no state.
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: {}, ...ident('color/surface/compressed/default') }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('does not flag a hover token whose own condition spells the state as "Hovered"', () => {
    // Same interaction state, the adjectival participle instead of the bare
    // noun -- the two most common real-world spellings of "hover" must
    // recognize each other, or a completely correct binding (this exact
    // shape appears in fixtures/button.json) reads as a false positive.
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { State: ['Hovered'] },
      ...ident('color/surface/primary/hover') }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('does not mirror a gap that a real token binding on the same path and property contradicts', () => {
    // The gap comes from the default variant's own walk; the binding shows
    // the property IS a real token elsewhere. componentBrief's own `unbound`
    // block already drops this gap for the same reason (the binding is the
    // stronger evidence) -- unbound-value must agree, or `validation` would
    // flatly contradict `tokens` for the identical fact.
    const spec = { ...base(),
      tokens: [{ part: 'container', path: 'Container/container', property: 'gap',
                 conditions: {}, ...ident('space/md') }],
      gaps: [{ part: 'container', path: 'Container/container', property: 'gap',
               issue: 'hardcoded-value' as const, value: 8 }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('reports the correct path for a duplicate binding when the part name contains a space', () => {
    const spec = { ...base(), tokens: [
      { part: 'Icon Left', path: 'Container/Icon Left', property: 'fill',
        conditions: { loading: ['True'] }, ...ident('color/a') },
      { part: 'Icon Left', path: 'Container/Icon Left', property: 'fill',
        conditions: { loading: ['True'] }, ...ident('color/b') },
    ] };
    const f = validate(spec as never, new Map());
    const hit = f.find((x) => x.id === 'duplicate-conflicting-binding')!;
    expect(hit.path).toBe('Container/Icon Left');
    expect(hit.property).toBe('fill');
  });

  it('does not compare a layout entry against a token bound in another subtree', () => {
    // Two subtrees each holding a node named `Icon` is an ordinary button
    // shape. Joining on the leaf `part` made Footer/Icon's radius compare
    // against Header/Icon's token and report the disagreement under
    // Header/Icon's path: a fabricated contradiction between two unrelated
    // nodes, attributed to whichever of them `find` happened to reach first.
    const spec = { ...base(),
      tokens: [{ part: 'Icon', path: 'Header/Icon', property: 'border-radius',
                 conditions: {}, ...ident('rd-sm') }],
      layout: [
        { part: 'Icon', path: 'Header/Icon', summary: 'radius 4', values: { radius: 4 } },
        { part: 'Icon', path: 'Footer/Icon', summary: 'radius 8', values: { radius: 8 } },
      ] };
    expect(validate(spec as never, new Map([['rd-sm', 4]]))).toEqual([]);
  });

  it('still flags the mismatched subtree when two subtrees share a leaf part name', () => {
    // The other half of the narrowing: joining on `path` must not silence the
    // rule, and the finding must name the node that actually disagrees.
    const spec = { ...base(),
      tokens: [
        { part: 'Icon', path: 'Header/Icon', property: 'border-radius',
          conditions: {}, ...ident('rd-sm') },
        { part: 'Icon', path: 'Footer/Icon', property: 'border-radius',
          conditions: {}, ...ident('rd-lg') },
      ],
      layout: [
        { part: 'Icon', path: 'Header/Icon', summary: 'radius 4', values: { radius: 4 } },
        { part: 'Icon', path: 'Footer/Icon', summary: 'radius 8', values: { radius: 8 } },
      ] };
    const f = validate(spec as never, new Map([['rd-sm', 4], ['rd-lg', 12]]));
    expect(f.map((x) => x.id)).toEqual(['geometry-token-mismatch']);
    expect(f[0].path).toBe('Footer/Icon');
    expect(f[0].message).toContain('rd-lg');
  });

  // --- A state expressed through a differently named boolean axis ---------

  it('does not flag a disabled token scoped by a boolean Enabled axis', () => {
    // Many design systems model "disabled" as `Enabled = false` instead of
    // adding a Disabled axis. `Enabled` names a state concept and its values
    // are a boolean flag's own two settings, so this binding IS scoped to the
    // state its token names -- the textbook-correct shape the rule exists to
    // protect, previously reported as the exact defect it looks for.
    const spec = { ...base(),
      variants: [{ prop: 'Enabled', values: ['True', 'False'] }],
      tokens: [{ part: 'Container', path: 'Container', property: 'fill',
                 conditions: { Enabled: ['False'] },
                 ...ident('color/surface/primary/disabled') }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('does not flag a disabled token scoped by a boolean axis absent from the declared variants', () => {
    // Same binding, with nothing declared in `variants`. The condition slice
    // carries the boolean signal on its own, so the verdict must not depend on
    // whether the axis happened to be declared.
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { Enabled: ['False'] },
      ...ident('color/surface/primary/disabled') }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('still flags a disabled token scoped to the Default value of an enum State axis', () => {
    // The case the rule is named after, and the one a careless fallback kills:
    // `State` is state vocabulary, but an enum axis pinned to `Default` does
    // not scope this binding to the disabled state at all.
    const spec = { ...base(),
      variants: [{ prop: 'State', values: ['Default', 'Hover', 'Disabled'] }],
      tokens: [{ part: 'Container', path: 'Container', property: 'fill',
                 conditions: { State: ['Default'] },
                 ...ident('color/surface/primary/disabled') }] };
    const f = validate(spec as never, new Map());
    const hit = f.find((x) => x.id === 'default-state-uses-state-token')!;
    expect(hit.message).toContain('disabled');
    expect(hit.when).toEqual({ State: ['Default'] });
  });

  it('still flags a disabled token scoped to an enum state value when no variants are declared', () => {
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { State: ['Default'] },
      ...ident('color/surface/primary/disabled') }] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toEqual(['default-state-uses-state-token']);
  });

  it('still flags a disabled token scoped only by non-state axes', () => {
    // The motivating shape: no state-named axis anywhere in the condition.
    const spec = { ...base(),
      variants: [
        { prop: 'Style', values: ['Primary', 'Secondary'] },
        { prop: 'Size', values: ['Large', 'Small'] },
      ],
      tokens: [{ part: 'Container', path: 'Container', property: 'fill',
                 conditions: { Style: ['Primary'], Size: ['Large'] },
                 ...ident('color/surface/primary/disabled') }] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toEqual(['default-state-uses-state-token']);
  });
});

// --- The geometry join must respect the condition, not just the path -------
//
// `spec.layout` describes the DEFAULT variant only, so a rule scoped to some
// OTHER variant must never be the one it is compared against. These cases are
// built as serialized trees and run through `extract()` rather than as
// hand-written specs, because the defect is exactly a disagreement between two
// real producers (extractLayout's default-variant walk and extractTokens'
// per-variant minimization) and a hand-built spec can only assert what the
// author already believed about both.

const tree = (o: Record<string, unknown>): SerializedNode => o as unknown as SerializedNode;

/** A two-variant set on one axis, each variant holding one node that carries
 *  `layout` and (optionally) a binding for the same geometry property. */
const twoVariantSet = (
  axis: string,
  defaultValue: string,
  leaf: string,
  figmaProperty: string,
  variants: { value: string; rendered: number; token?: string }[],
): SerializedNode =>
  tree({
    id: '1:0', name: 'Btn', type: 'COMPONENT_SET', visible: true,
    propertyDefinitions: {
      [axis]: { type: 'VARIANT', defaultValue, variantOptions: variants.map((v) => v.value) },
    },
    children: variants.map((v, i) => ({
      id: `1:${i * 2 + 1}`, name: `${axis}=${v.value}`, type: 'COMPONENT', visible: true,
      children: [{
        id: `1:${i * 2 + 2}`, name: leaf, type: 'FRAME', visible: true,
        layout: { mode: 'HORIZONTAL', [figmaProperty]: v.rendered },
        ...(v.token ? { bindings: [bind(figmaProperty, v.token)] } : {}),
      }],
    })),
  });

const geometry = (root: SerializedNode, resolved: Map<string, number>) =>
  validate(extract(root, { figmaFile: 'F' }), resolved)
    .filter((f) => f.id === 'geometry-token-mismatch');

describe('validate geometry-token-mismatch, per variant bindings', () => {
  it('does not flag a gap bound to a different token in each variant, all of them correct', () => {
    // The reviewer's F4. `Size=Small` is the DECLARED default, and the designer
    // has dragged `Size=Large` to sit first on the canvas, which is not the
    // default and never was. Small renders gap 4 and binds `space-1`, which
    // resolves to 4. Large renders 12 and binds `space-3`, which resolves to
    // 12. Every variant is individually correct, so there is nothing to report;
    // joining on path and property alone compared Small's rendered 4 against
    // Large's `space-3` and claimed the frame disagreed with its own token.
    const root = twoVariantSet('Size', 'Small', 'row#', 'itemSpacing', [
      { value: 'Large', rendered: 12, token: 'space-3' },
      { value: 'Small', rendered: 4, token: 'space-1' },
    ]);
    expect(geometry(root, new Map([['space-1', 4], ['space-3', 12]]))).toEqual([]);
  });

  it('does not flag a border-radius bound to a different token in each variant', () => {
    // The reviewer's C9: the same mechanism on `cornerRadius`, with the
    // declared default as the SECOND child, so child order and default order
    // disagree in the other direction. Large renders 12 and binds `rd-lg`,
    // which resolves to 12.
    const root = twoVariantSet('Size', 'Large', 'box#', 'cornerRadius', [
      { value: 'Small', rendered: 4, token: 'rd-sm' },
      { value: 'Large', rendered: 12, token: 'rd-lg' },
    ]);
    expect(geometry(root, new Map([['rd-sm', 4], ['rd-lg', 12]]))).toEqual([]);
  });

  it('does not flag a default-variant node against a token bound only in a non-default variant', () => {
    // The reviewer's C6. `State=Hover` binds `icon#` to `rd-sm`; the default
    // variant's `icon#` carries a hardcoded 8 and no binding at all. The rule
    // used to claim the frame disagreed with a token it is not bound to.
    const root = twoVariantSet('State', 'Default', 'icon#', 'cornerRadius', [
      { value: 'Default', rendered: 8 },
      { value: 'Hover', rendered: 4, token: 'rd-sm' },
    ]);
    expect(geometry(root, new Map([['rd-sm', 4]]))).toEqual([]);
  });

  it('still flags the default variant against the token that really applies to it', () => {
    // The other half: a genuine defect on the same shape. Small IS the default,
    // it binds `space-1` which resolves to 4, and it renders 6. The finding
    // must fire, and it must name `space-1` rather than `space-3` from the
    // variant that happens to sit first.
    const root = twoVariantSet('Size', 'Small', 'row#', 'itemSpacing', [
      { value: 'Large', rendered: 12, token: 'space-3' },
      { value: 'Small', rendered: 6, token: 'space-1' },
    ]);
    const f = geometry(root, new Map([['space-1', 4], ['space-3', 12]]));
    expect(f.map((x) => x.path)).toEqual(['Container/row']);
    expect(f[0].message).toBe('The frame renders gap 6, while the bound token space-1 resolves to 4.');
  });

  it('says nothing when two rules both apply to the default variant', () => {
    // One node bound twice for one property. Both rules are unconditioned, so
    // both apply to the default variant and neither is the frame's obvious
    // source. That is a genuine conflict, and `duplicate-conflicting-binding`
    // is the finding that describes it correctly; picking one of the two here
    // and calling the frame wrong is the guess that produced the bug above.
    const root = tree({
      id: '1:0', name: 'Btn', type: 'COMPONENT_SET', visible: true,
      propertyDefinitions: { Size: { type: 'VARIANT', defaultValue: 'Small', variantOptions: ['Small'] } },
      children: [{
        id: '1:1', name: 'Size=Small', type: 'COMPONENT', visible: true,
        children: [{
          id: '1:2', name: 'box#', type: 'FRAME', visible: true,
          layout: { mode: 'HORIZONTAL', cornerRadius: 8 },
          bindings: [
            bind('cornerRadius', 'rd-sm'),
            bind('cornerRadius', 'rd-lg'),
          ],
        }],
      }],
    });
    const resolved = new Map([['rd-sm', 4], ['rd-lg', 12]]);
    expect(geometry(root, resolved)).toEqual([]);
    // The conflict itself is still reported, so nothing is swallowed.
    expect(validate(extract(root, { figmaFile: 'F' }), resolved).map((x) => x.id))
      .toContain('duplicate-conflicting-binding');
  });

  it('compares the only rule when the default variant combo cannot be derived', () => {
    // No variantInstance carries `anatomyComponentId`, so the combo falls back
    // to empty and every rule matches. With exactly one rule that is still an
    // honest comparison, so the fallback must not silence the rule outright.
    const spec = { ...base(),
      anatomyComponentId: 'not-a-variant',
      variantInstances: [{ nodeId: '9:9', name: 'Size=Small', values: { Size: 'Small' } }],
      tokens: [{ part: 'box', path: 'Container/box', property: 'border-radius',
                 conditions: { Size: ['Large'] }, ...ident('rd-lg') }],
      layout: [{ part: 'box#', path: 'Container/box',
                 summary: 'radius 4', values: { radius: 4 } }] };
    const f = validate(spec as never, new Map([['rd-lg', 12]]));
    expect(f.map((x) => x.id)).toEqual(['geometry-token-mismatch']);
    expect(f[0].message).toContain('rd-lg');
  });

  it('says nothing when the combo cannot be derived and several rules exist', () => {
    // Same undrivable combo, two per-variant rules. Every rule matches an empty
    // combo, so the more-than-one guard is the whole protection here: without
    // it this is precisely the F4 shape, guessing between two rules for a frame
    // whose variant it cannot identify.
    const spec = { ...base(),
      anatomyComponentId: 'not-a-variant',
      variantInstances: [{ nodeId: '9:9', name: 'Size=Small', values: { Size: 'Small' } }],
      tokens: [
        { part: 'row', path: 'Container/row', property: 'gap',
          conditions: { Size: ['Large'] }, ...ident('space-3') },
        { part: 'row', path: 'Container/row', property: 'gap',
          conditions: { Size: ['Small'] }, ...ident('space-1') },
      ],
      layout: [{ part: 'row#', path: 'Container/row',
                 summary: 'horizontal, gap 4', values: { gap: 4 } }] };
    expect(validate(spec as never, new Map([['space-1', 4], ['space-3', 12]]))).toEqual([]);
  });
});
