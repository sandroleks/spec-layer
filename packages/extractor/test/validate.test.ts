import { describe, it, expect } from 'vitest';
import { validate } from '../src/validate';

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
      token: 'color/surface/primary/disabled' }] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toContain('default-state-uses-state-token');
    expect(f[0].message).toContain('disabled');
  });

  it('does not flag a binding whose own condition names that state', () => {
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { disabled: ['True'] },
      token: 'color/surface/primary/disabled' }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('flags a rendered geometry value disagreeing with its bound token', () => {
    const spec = { ...base(),
      tokens: [{ part: 'Container', path: 'Container', property: 'border-radius',
                 conditions: {}, token: 'rd-sm' }],
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
        conditions: { loading: ['True'] }, token: 'color/icon/primary/primary' },
      { part: 'vector', path: 'Container/vector', property: 'border-color',
        conditions: { loading: ['True'] }, token: 'color/stroke/primary/default' },
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
      conditions: {}, token: 'color/surface/compressed/default' }] };
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
      token: 'color/surface/primary/hover' }] };
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
                 conditions: {}, token: 'space/md' }],
      gaps: [{ part: 'container', path: 'Container/container', property: 'gap',
               issue: 'hardcoded-value' as const, value: 8 }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('reports the correct path for a duplicate binding when the part name contains a space', () => {
    const spec = { ...base(), tokens: [
      { part: 'Icon Left', path: 'Container/Icon Left', property: 'fill',
        conditions: { loading: ['True'] }, token: 'color/a' },
      { part: 'Icon Left', path: 'Container/Icon Left', property: 'fill',
        conditions: { loading: ['True'] }, token: 'color/b' },
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
                 conditions: {}, token: 'rd-sm' }],
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
          conditions: {}, token: 'rd-sm' },
        { part: 'Icon', path: 'Footer/Icon', property: 'border-radius',
          conditions: {}, token: 'rd-lg' },
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
                 token: 'color/surface/primary/disabled' }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('does not flag a disabled token scoped by a boolean axis absent from the declared variants', () => {
    // Same binding, with nothing declared in `variants`. The condition slice
    // carries the boolean signal on its own, so the verdict must not depend on
    // whether the axis happened to be declared.
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { Enabled: ['False'] },
      token: 'color/surface/primary/disabled' }] };
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
                 token: 'color/surface/primary/disabled' }] };
    const f = validate(spec as never, new Map());
    const hit = f.find((x) => x.id === 'default-state-uses-state-token')!;
    expect(hit.message).toContain('disabled');
    expect(hit.when).toEqual({ State: ['Default'] });
  });

  it('still flags a disabled token scoped to an enum state value when no variants are declared', () => {
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { State: ['Default'] },
      token: 'color/surface/primary/disabled' }] };
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
                 token: 'color/surface/primary/disabled' }] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toEqual(['default-state-uses-state-token']);
  });
});
