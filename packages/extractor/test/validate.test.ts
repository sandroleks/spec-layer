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
      layout: [{ part: 'Container', summary: 'horizontal, radius 4',
                 values: { radius: 4 } }] };
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
});
