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
        { id: 'p:1', name: 'Container', type: 'FRAME', nested: false },
        { id: 'p:2', name: 'Icon', type: 'INSTANCE', nested: true },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    const block = model.sections[0];
    expect(block.kind).toBe('anatomy');
    if (block.kind === 'anatomy') {
      expect(block.componentId).toBe('c:1');
      expect(block.parts).toEqual([
        { n: 1, name: 'Container', nested: false, id: 'p:1' },
        { n: 2, name: 'Icon', nested: true, id: 'p:2' },
      ]);
    }
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
