import { describe, it, expect } from 'vitest';
import { buildDocModel, measureKey, type SectionId } from '../src/ui/docModel';
import type { IntermediateSpec } from '@spec-layer/extractor';

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [{ name: 'Label', nested: false }],
  props: [{ name: 'Size', kind: 'variant', default: 'M', options: ['S','M'] }],
  variants: [{ prop: 'Style', values: ['Filled','Text'] }],
  states: ['Enabled','Hovered'],
  tokens: [{ part: 'Container', property: 'fill', token: 'color/bg', conditions: {} }],
  rawValues: [],
  related: ['Icon'], gaps: [],
  layout: [], variantInstances: [],
} as unknown as IntermediateSpec;

const prose = { definition: 'A button.', accessibility: '- **Keyboard:** focusable', dos: ['Do A'], donts: ["Don't B"] };

describe('buildDocModel', () => {
  it('emits only selected sections, in canonical order', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['definition','variants']));
    expect(model.sections.map(s => s.id)).toEqual(['definition','variants']);
    expect(model.title).toBe('Button: Guidelines');
  });

  it('uses placeholder text for AI sections when prose is null', () => {
    const model = buildDocModel(spec, null, new Set<SectionId>(['definition']));
    const def = model.sections[0];
    expect(def.kind).toBe('prose');
    if (def.kind === 'prose') expect(def.text).toMatch(/To be written/);
  });

  it('shapes tokens as a table block', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['tokens']));
    const tok = model.sections[0];
    expect(tok.kind).toBe('table');
    if (tok.kind === 'table') expect(tok.rows.length).toBeGreaterThan(0);
  });

  it('builds per-variant token blocks when variants are selected', () => {
    const specV = {
      ...spec,
      variantInstances: [
        { nodeId: 'n1', name: 'Filled', values: { Style: 'Filled' } },
        { nodeId: 'n2', name: 'Text', values: { Style: 'Text' } },
      ],
      tokens: [
        { part: 'Container', property: 'fill', token: 'color/bg/brand', conditions: { Style: ['Filled'] } },
        { part: 'Label', property: 'color', token: 'color/text', conditions: {} },
      ],
    } as unknown as IntermediateSpec;

    const model = buildDocModel(specV, null, new Set<SectionId>(['tokens']), new Set(['n1']));
    const tok = model.sections[0];
    expect(tok.kind).toBe('variantTokens');
    if (tok.kind === 'variantTokens') {
      expect(tok.variants).toHaveLength(1);
      expect(tok.variants[0].name).toBe('Style=Filled');
      const tokenNames = tok.variants[0].rows.map((r) => r.token);
      expect(tokenNames).toContain('color/bg/brand'); // conditioned, matches Filled
      expect(tokenNames).toContain('color/text'); // unconditioned, applies to all
    }
  });

  it('shapes anatomy as a numbered diagram block carrying part + component ids', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [
        { id: 'p:1', name: 'Container', type: 'FRAME', nested: false, depth: 0 },
        { id: 'p:2', name: 'Icon', type: 'INSTANCE', nested: true, depth: 1, component: 'Icon' },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    const block = model.sections[0];
    expect(block.kind).toBe('anatomy');
    if (block.kind === 'anatomy') {
      expect(block.componentId).toBe('c:1');
      expect(block.view).toBe('diagram');
      expect(block.parts).toEqual([
        { n: 1, name: 'Container', nested: false, id: 'p:1', depth: 0, component: undefined, tokens: ['color/bg'], type: 'FRAME' },
        { n: 2, name: 'Icon', nested: true, id: 'p:2', depth: 1, component: 'Icon', tokens: [], type: 'INSTANCE' },
      ]);
    }
  });

  it('anatomy block carries depth, per-part tokens, and the view option', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [{ id: '2', name: 'label', type: 'TEXT', nested: false, depth: 0 }],
      tokens: [{ part: 'label', property: 'fill', token: 'color/label', conditions: {} }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']), undefined, { anatomyView: 'both' });
    const block = model.sections[0];
    if (block.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(block.view).toBe('both');
    expect(block.parts[0].depth).toBe(0);
    expect(block.parts[0].tokens).toContain('color/label');
  });

  it('falls back to a bullet list when anatomy has no component to screenshot', () => {
    const specA = { ...spec, anatomyComponentId: '', anatomy: [] } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    expect(model.sections[0].kind).toBe('bullets');
  });

  it("renders dos and donts with check/cross markers", () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['dosDonts']));
    const block = model.sections[0];
    expect(block.kind).toBe('bullets');
    if (block.kind === 'bullets') {
      expect(block.items.some((i) => i.text.startsWith('✅'))).toBe(true);
      expect(block.items.some((i) => i.text.startsWith('❌'))).toBe(true);
    }
  });
});

describe('measurements section', () => {
  const spec: IntermediateSpec = {
    name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: '1:1',
    anatomy: [], anatomyComponentId: '1:2',
    props: [{ name: 'State', kind: 'variant', options: ['Default', 'Hover'], default: 'Default' }],
    variants: [{ prop: 'State', values: ['Default', 'Hover'] }],
    variantInstances: [
      { nodeId: '1:2', name: 'State=Default', values: { State: 'Default' } },
      { nodeId: '1:3', name: 'State=Hover', values: { State: 'Hover' } },
    ],
    states: ['Default', 'Hover'],
    tokens: [
      { part: 'Container', property: 'padding', conditions: {}, token: 'spacing/md' },
      { part: 'Container', property: 'gap', conditions: {}, token: 'spacing/sm' },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/hover' },
    ],
    related: [], gaps: [], layout: [],
  } as unknown as IntermediateSpec;

  it('builds a measure block keyed by part+property for the default variant', () => {
    const model = buildDocModel(spec, null, new Set(['measurements']), new Set(['1:2']));
    const block = model.sections[0];
    expect(block.kind).toBe('measure');
    if (block.kind !== 'measure') return;
    expect(block.componentId).toBe('1:2');
    expect(block.rootPart).toBe('Container');
    expect(block.tokens[measureKey('Container', 'padding')]).toBe('spacing/md');
    expect(block.tokens[measureKey('Container', 'gap')]).toBe('spacing/sm');
    // Hover-only rule must NOT leak into the default-variant lookup.
    expect(block.tokens[measureKey('Container', 'fill')]).toBeUndefined();
  });

  it('uses the cleaned component name as rootPart for a plain component', () => {
    const plain: IntermediateSpec = {
      ...spec, variants: [], props: [],
      variantInstances: [{ nodeId: '1:2', name: 'Button', values: {} }],
      tokens: [{ part: 'Button', property: 'padding', conditions: {}, token: 'spacing/md' }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(plain, null, new Set(['measurements']), new Set(['1:2']));
    const block = model.sections[0];
    if (block.kind !== 'measure') throw new Error('expected measure block');
    expect(block.rootPart).toBe('Button');
  });
});

describe('states matrix section', () => {
  // axes Type[Primary,Secondary] + State[Default,Hover]; instances for all 4
  // combos (1:2..1:5); fill token differs on State=Hover.
  const spec: IntermediateSpec = {
    name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: '1:1',
    anatomy: [], anatomyComponentId: '1:2',
    props: [
      { name: 'Type', kind: 'variant', options: ['Primary', 'Secondary'], default: 'Primary' },
      { name: 'State', kind: 'variant', options: ['Default', 'Hover'], default: 'Default' },
    ],
    variants: [
      { prop: 'Type', values: ['Primary', 'Secondary'] },
      { prop: 'State', values: ['Default', 'Hover'] },
    ],
    variantInstances: [
      { nodeId: '1:2', name: 'Primary/Default', values: { Type: 'Primary', State: 'Default' } },
      { nodeId: '1:3', name: 'Primary/Hover', values: { Type: 'Primary', State: 'Hover' } },
      { nodeId: '1:4', name: 'Secondary/Default', values: { Type: 'Secondary', State: 'Default' } },
      { nodeId: '1:5', name: 'Secondary/Hover', values: { Type: 'Secondary', State: 'Hover' } },
    ],
    states: ['Default', 'Hover'],
    tokens: [
      { part: 'Container', property: 'fill', conditions: { State: ['Default'] }, token: 'color/rest' },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/hover' },
    ],
    rawValues: [], related: [], gaps: [], layout: [],
  } as unknown as IntermediateSpec;

  it('builds a grid of nodeIds keyed by rowAxis x state', () => {
    const model = buildDocModel(spec, null, new Set(['states']), new Set(['1:2']));
    const block = model.sections[0];
    if (block.kind !== 'statesMatrix') throw new Error('expected statesMatrix');
    expect(block.states).toEqual(['Default', 'Hover']);
    expect(block.rows.map((r) => r.label)).toEqual(['Primary', 'Secondary']);
    expect(block.rows[0].cells).toEqual(['1:2', '1:3']); // Primary Default/Hover ids
    expect(block.deltas[0].state).toBe('Hover');
    expect(block.deltas[0].lines).toContain('color/hover');
  });

  it('drops the section entirely when no state axis exists', () => {
    const noStates = {
      ...spec,
      props: [{ name: 'Size', kind: 'variant', options: ['S', 'M'], default: 'M' }],
      variants: [{ prop: 'Size', values: ['S', 'M'] }],
      variantInstances: [
        { nodeId: '1:2', name: 'S', values: { Size: 'S' } },
        { nodeId: '1:3', name: 'M', values: { Size: 'M' } },
      ],
      tokens: [{ part: 'Container', property: 'fill', conditions: {}, token: 'color/bg' }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(noStates, null, new Set(['states']), undefined);
    expect(model.sections.find((s) => s.id === 'states')).toBeUndefined();
  });

  it('caps rows at 4 and flags it', () => {
    const many = {
      ...spec,
      props: [
        { name: 'Type', kind: 'variant', options: ['A', 'B', 'C', 'D', 'E'], default: 'A' },
        { name: 'State', kind: 'variant', options: ['Default', 'Hover'], default: 'Default' },
      ],
      variants: [
        { prop: 'Type', values: ['A', 'B', 'C', 'D', 'E'] },
        { prop: 'State', values: ['Default', 'Hover'] },
      ],
      variantInstances: [],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(many, null, new Set(['states']), undefined);
    const block = model.sections[0];
    if (block.kind !== 'statesMatrix') throw new Error('expected statesMatrix');
    expect(block.rows.length).toBe(4);
    expect(block.capped).toBe(true);
  });

  it('puts the default row-axis value first even when the cap would otherwise drop it', () => {
    // 5 row-axis values with the default ('E') sitting at raw index 4 (the 5th
    // value) — naive slice(0, 4) would silently drop it. Default-first ordering
    // must promote it to row 0 before the cap is applied.
    const many = {
      ...spec,
      props: [
        { name: 'Type', kind: 'variant', options: ['A', 'B', 'C', 'D', 'E'], default: 'E' },
        { name: 'State', kind: 'variant', options: ['Default', 'Hover'], default: 'Default' },
      ],
      variants: [
        { prop: 'Type', values: ['A', 'B', 'C', 'D', 'E'] },
        { prop: 'State', values: ['Default', 'Hover'] },
      ],
      variantInstances: [
        { nodeId: '1:2', name: 'Type=E, State=Default', values: { Type: 'E', State: 'Default' } },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(many, null, new Set(['states']), undefined);
    const block = model.sections[0];
    if (block.kind !== 'statesMatrix') throw new Error('expected statesMatrix');
    expect(block.rows.length).toBe(4);
    expect(block.capped).toBe(true);
    expect(block.rows[0].label).toBe('E');
  });

  it('resolves deltas at the row axis default when a non-state axis exists', () => {
    // Multi-axis: token differs by BOTH Type and State. Deltas are computed with
    // the row axis (Type) pinned to its default (Primary), so the Hover delta
    // must resolve Primary's hover token, not Secondary's.
    const multi = {
      ...spec,
      tokens: [
        { part: 'Container', property: 'fill', conditions: { Type: ['Primary'], State: ['Default'] }, token: 'primary/rest' },
        { part: 'Container', property: 'fill', conditions: { Type: ['Primary'], State: ['Hover'] }, token: 'primary/hover' },
        { part: 'Container', property: 'fill', conditions: { Type: ['Secondary'], State: ['Hover'] }, token: 'secondary/hover' },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(multi, null, new Set(['states']), undefined);
    const block = model.sections[0];
    if (block.kind !== 'statesMatrix') throw new Error('expected statesMatrix');
    const hover = block.deltas.find((d) => d.state === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.lines).toContain('primary/hover');
    expect(hover!.lines).not.toContain('secondary/hover');
  });
});

describe('variant token cards: diff vs default', () => {
  const spec: IntermediateSpec = {
    name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: '1:1',
    anatomy: [], anatomyComponentId: '1:2',
    props: [{ name: 'State', kind: 'variant', options: ['Default', 'Hover'], default: 'Default' }],
    variants: [{ prop: 'State', values: ['Default', 'Hover'] }],
    variantInstances: [
      { nodeId: '1:2', name: 'State=Default', values: { State: 'Default' } },
      { nodeId: '1:3', name: 'State=Hover', values: { State: 'Hover' } },
    ],
    states: ['Default', 'Hover'],
    tokens: [
      { part: 'Container', property: 'padding', conditions: {}, token: 'spacing/md' },
      { part: 'Container', property: 'fill', conditions: { State: ['Default'] }, token: 'color/rest' },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/hover' },
    ],
    rawValues: [{ part: 'label', property: 'gap', value: '4' }],
    related: [], gaps: [], layout: [],
  } as unknown as IntermediateSpec;

  it('default card carries all rows plus raw rows, nothing collapsed', () => {
    const model = buildDocModel(spec, null, new Set(['tokens']), new Set(['1:2', '1:3']));
    const block = model.sections[0];
    if (block.kind !== 'variantTokens') throw new Error('expected variantTokens');
    const def = block.variants.find((v) => v.isDefault)!;
    expect(def.rows).toEqual([
      { part: 'Container', property: 'padding', token: 'spacing/md', unbound: false, diff: false },
      { part: 'Container', property: 'fill', token: 'color/rest', unbound: false, diff: false },
      { part: 'label', property: 'gap', token: '4', unbound: true, diff: false },
    ]);
    expect(def.sameAsDefault).toBe(0);
  });

  it('merges a raw row into its matching part group instead of appending flat', () => {
    const specM = {
      ...spec,
      rawValues: [{ part: 'Container', property: 'gap', value: '4' }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specM, null, new Set(['tokens']), new Set(['1:2', '1:3']));
    const block = model.sections[0];
    if (block.kind !== 'variantTokens') throw new Error('expected variantTokens');
    const def = block.variants.find((v) => v.isDefault)!;
    // The raw Container/gap row sits after the last existing Container row, not
    // appended after a part boundary — so all Container rows stay contiguous.
    expect(def.rows).toEqual([
      { part: 'Container', property: 'padding', token: 'spacing/md', unbound: false, diff: false },
      { part: 'Container', property: 'fill', token: 'color/rest', unbound: false, diff: false },
      { part: 'Container', property: 'gap', token: '4', unbound: true, diff: false },
    ]);
  });

  it('non-default card keeps only differing rows and counts the rest', () => {
    const model = buildDocModel(spec, null, new Set(['tokens']), new Set(['1:2', '1:3']));
    const block = model.sections[0];
    if (block.kind !== 'variantTokens') throw new Error('expected variantTokens');
    const hover = block.variants.find((v) => !v.isDefault)!;
    expect(hover.rows).toEqual([
      { part: 'Container', property: 'fill', token: 'color/hover', unbound: false, diff: true },
    ]);
    expect(hover.sameAsDefault).toBe(1); // padding row identical to default
  });
});
