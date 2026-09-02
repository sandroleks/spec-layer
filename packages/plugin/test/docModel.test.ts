import { describe, it, expect } from 'vitest';
import { buildDocModel, measureKey, type SectionId, groupSections, GROUPS, ALL_SECTIONS, KNOWN_SECTION_IDS, type SectionBlock, firstSentence, proseKeysForSections, headingLine } from '../src/ui/docModel';
import type { IntermediateSpec, RefIdentity } from '@spec-layer/extractor';

/** A TokenRule now carries the full identity Figma stated for the reference.
 *  These tests are about the doc model, not resolution, so one identity is
 *  minted per token NAME -- what a name meant before the identity fields
 *  existed. The view model's own `token` field is untouched. */
const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [{ name: 'Label', nested: false }],
  props: [{ name: 'Size', kind: 'variant', default: 'M', options: ['S','M'] }],
  variants: [{ prop: 'Style', values: ['Filled','Text'] }],
  states: ['Enabled','Hovered'],
  tokens: [{ part: 'Container', property: 'fill', ...ident('color/bg'), conditions: {} }],
  rawValues: [],
  related: ['Icon'], gaps: [],
  layout: [], variantInstances: [],
} as unknown as IntermediateSpec;

const prose = { definition: 'A button.', accessibility: '- **Keyboard:** focusable', dos: ['Do A'], donts: ["Don't B"] };

describe('firstSentence', () => {
  it('splits off the first sentence and keeps the remainder', () => {
    const { sentence, remainder } = firstSentence(
      'A Button triggers an action. Use it for actions, not navigation.',
    );
    expect(sentence).toBe('A Button triggers an action.');
    expect(remainder).toBe('Use it for actions, not navigation.');
  });

  it('does not cut on abbreviations or decimals', () => {
    expect(firstSentence('Pick 3.5 items on average. Then stop.').sentence)
      .toBe('Pick 3.5 items on average.');
    expect(firstSentence('Use e.g. a Toggle instead. Next.').sentence)
      .toBe('Use e.g. a Toggle instead.');
  });

  it('returns the whole text with empty remainder when there is one sentence', () => {
    const { sentence, remainder } = firstSentence('Just one sentence here.');
    expect(sentence).toBe('Just one sentence here.');
    expect(remainder).toBe('');
  });
});

describe('buildDocModel', () => {
  it('emits only selected sections, in canonical order', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['definition','variants']));
    expect(model.sections.map(s => s.id)).toEqual(['definition','variants']);
    expect(model.componentName).toBe('Button');
  });

  it('labels the definition section "Overview"', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['definition']));
    expect(model.sections[0].heading).toBe('Overview');
  });

  it('renders the guidelines prose sections with placeholder fallback', () => {
    const ids = new Set<SectionId>(['interactions', 'contentConsiderations']);
    const noProse = buildDocModel(spec, null, ids);
    for (const id of ids) {
      const block = noProse.sections.find((s) => s.id === id);
      expect(block?.kind).toBe('prose');
      if (block?.kind === 'prose') expect(block.text).toBe('_To be written._');
    }
    const withProse = buildDocModel(spec, {
      ...prose, interactions: '### Mouse\n- x', contentConsiderations: '- z',
    }, ids);
    const inter = withProse.sections.find((s) => s.id === 'interactions');
    if (inter?.kind === 'prose') expect(inter.text).toContain('### Mouse');
  });

  it('orders the a11y group Interactions -> Content -> Accessibility (no Design Considerations)', () => {
    const a11y = ALL_SECTIONS.filter((s) => s.group === 'a11y').map((s) => s.id);
    expect(a11y).toEqual(['interactions', 'contentConsiderations', 'accessibility']);
  });

  it('maps checked sections to prose keys', () => {
    expect([...proseKeysForSections(['anatomy'])].sort()).toEqual(['anatomyParts', 'anatomySummary']);
    expect([...proseKeysForSections(['interactions', 'related'])]).toEqual(['interactions']);
    expect([...proseKeysForSections(['dosDonts'])].sort()).toEqual(['donts', 'dos']);
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
        { part: 'Container', property: 'fill', ...ident('color/bg/brand'), conditions: { Style: ['Filled'] } },
        { part: 'Label', property: 'color', ...ident('color/text'), conditions: {} },
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

  it('anatomy block carries depth and tokens and always uses the diagram view', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [{ id: '2', name: 'label', type: 'TEXT', nested: false, depth: 0 }],
      tokens: [{ part: 'label', property: 'fill', ...ident('color/label'), conditions: {} }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']), undefined, { anatomyView: 'both' });
    const block = model.sections[0];
    if (block.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(block.view).toBe('diagram');
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
      { part: 'Container', property: 'padding', conditions: {}, ...ident('spacing/md') },
      { part: 'Container', property: 'gap', conditions: {}, ...ident('spacing/sm') },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, ...ident('color/hover') },
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

  it('defaults measure views to all three when none are passed', () => {
    const model = buildDocModel(spec, null, new Set(['measurements']), new Set(['1:2']));
    const block = model.sections[0];
    if (block.kind !== 'measure') throw new Error('expected measure block');
    expect(block.views).toEqual(['size', 'padding', 'spacing']);
  });

  it('threads a passed measure-views subset through in canonical order', () => {
    const model = buildDocModel(
      spec, null, new Set(['measurements']), new Set(['1:2']),
      { measureViews: ['spacing', 'size'] },
    );
    const block = model.sections[0];
    if (block.kind !== 'measure') throw new Error('expected measure block');
    expect(block.views).toEqual(['size', 'spacing']);
  });

  it('falls back to all three views when an empty selection is passed', () => {
    const model = buildDocModel(
      spec, null, new Set(['measurements']), new Set(['1:2']),
      { measureViews: [] },
    );
    const block = model.sections[0];
    if (block.kind !== 'measure') throw new Error('expected measure block');
    expect(block.views).toEqual(['size', 'padding', 'spacing']);
  });

  it('uses the cleaned component name as rootPart for a plain component', () => {
    const plain: IntermediateSpec = {
      ...spec, variants: [], props: [],
      variantInstances: [{ nodeId: '1:2', name: 'Button', values: {} }],
      tokens: [{ part: 'Button', property: 'padding', conditions: {}, ...ident('spacing/md') }],
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
      { part: 'Container', property: 'fill', conditions: { State: ['Default'] }, ...ident('color/rest') },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, ...ident('color/hover') },
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
      tokens: [{ part: 'Container', property: 'fill', conditions: {}, ...ident('color/bg') }],
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
});

describe('states matrix section: flags encoding', () => {
  // axes Hover[True,False] + Disabled[True,False] + Size[S,L]; no enum State
  // axis, so the matrix is synthesized from Default + each-flag-on. Fill token
  // differs on Hover=True; opacity token differs on Disabled=True.
  const spec: IntermediateSpec = {
    name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: '1:1',
    anatomy: [], anatomyComponentId: '1:2',
    props: [
      { name: 'Hover', kind: 'variant', options: ['True', 'False'], default: 'False' },
      { name: 'Disabled', kind: 'variant', options: ['True', 'False'], default: 'False' },
      { name: 'Size', kind: 'variant', options: ['S', 'L'], default: 'S' },
    ],
    variants: [
      { prop: 'Hover', values: ['True', 'False'] },
      { prop: 'Disabled', values: ['True', 'False'] },
      { prop: 'Size', values: ['S', 'L'] },
    ],
    variantInstances: [
      { nodeId: '1:2', name: 'S/Default', values: { Hover: 'False', Disabled: 'False', Size: 'S' } },
      { nodeId: '1:3', name: 'S/Hover', values: { Hover: 'True', Disabled: 'False', Size: 'S' } },
      { nodeId: '1:4', name: 'S/Disabled', values: { Hover: 'False', Disabled: 'True', Size: 'S' } },
      { nodeId: '1:5', name: 'L/Default', values: { Hover: 'False', Disabled: 'False', Size: 'L' } },
      { nodeId: '1:6', name: 'L/Hover', values: { Hover: 'True', Disabled: 'False', Size: 'L' } },
      { nodeId: '1:7', name: 'L/Disabled', values: { Hover: 'False', Disabled: 'True', Size: 'L' } },
    ],
    states: [],
    tokens: [
      { part: 'Container', property: 'fill', conditions: { Hover: ['True'] }, ...ident('color/hover') },
      { part: 'Container', property: 'opacity', conditions: { Disabled: ['True'] }, ...ident('opacity/disabled') },
    ],
    rawValues: [], related: [], gaps: [], layout: [],
  } as unknown as IntermediateSpec;

  it('builds a flags matrix with Default + each-flag-on columns', () => {
    const model = buildDocModel(spec, null, new Set(['states']), new Set(['1:2']));
    const block = model.sections[0];
    if (block.kind !== 'statesMatrix') throw new Error('expected statesMatrix');
    expect(block.axisName).toBe('');
    expect(block.states).toEqual(['Default', 'Hover', 'Disabled']);
    expect(block.rows.map((r) => r.label)).toEqual(['S', 'L']);
  });

  it('resolves a nodeId per cell for a flag-on column', () => {
    const model = buildDocModel(spec, null, new Set(['states']), new Set(['1:2']));
    const block = model.sections[0];
    if (block.kind !== 'statesMatrix') throw new Error('expected statesMatrix');
    const sRow = block.rows.find((r) => r.label === 'S')!;
    expect(sRow.cells).toEqual(['1:2', '1:3', '1:4']); // Default, Hover, Disabled
    const lRow = block.rows.find((r) => r.label === 'L')!;
    expect(lRow.cells).toEqual(['1:5', '1:6', '1:7']);
  });
});

describe('variants matrix section', () => {
  // axes type[Primary,Outline] × size[Large,Small]; instances for all 4 combos.
  const spec: IntermediateSpec = {
    name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: '1:1',
    anatomy: [], anatomyComponentId: '1:2',
    props: [
      { name: 'type', kind: 'variant', options: ['Primary', 'Outline'], default: 'Primary' },
      { name: 'size', kind: 'variant', options: ['Large', 'Small'], default: 'Large' },
    ],
    variants: [
      { prop: 'type', values: ['Primary', 'Outline'] },
      { prop: 'size', values: ['Large', 'Small'] },
    ],
    variantInstances: [
      { nodeId: '1:2', name: 'Primary/Large', values: { type: 'Primary', size: 'Large' } },
      { nodeId: '1:3', name: 'Primary/Small', values: { type: 'Primary', size: 'Small' } },
      { nodeId: '1:4', name: 'Outline/Large', values: { type: 'Outline', size: 'Large' } },
      { nodeId: '1:5', name: 'Outline/Small', values: { type: 'Outline', size: 'Small' } },
    ],
    states: [],
    tokens: [],
    rawValues: [], related: [], gaps: [], layout: [],
  } as unknown as IntermediateSpec;

  it('builds a 2-axis matrix with columns=size, one row per type, a nodeId per cell', () => {
    const model = buildDocModel(spec, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.columns).toEqual(['Large', 'Small']);
    expect(block.rows.map((r) => r.label)).toEqual(['Primary', 'Outline']);
    expect(block.rows[0].cells).toEqual(['1:2', '1:3']);
    expect(block.rows[1].cells).toEqual(['1:4', '1:5']);
    expect(block.capped).toBe(false);
    expect(block.note).toBeNull();
  });

  it('builds a 1-axis matrix as a single row labeled with the component name', () => {
    const oneAxis = {
      ...spec,
      props: [{ name: 'type', kind: 'variant', options: ['Primary', 'Outline'], default: 'Primary' }],
      variants: [{ prop: 'type', values: ['Primary', 'Outline'] }],
      variantInstances: [
        { nodeId: '1:2', name: 'Primary', values: { type: 'Primary' } },
        { nodeId: '1:4', name: 'Outline', values: { type: 'Outline' } },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(oneAxis, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.columns).toEqual(['Primary', 'Outline']);
    expect(block.rows).toEqual([{ label: 'Button', cells: ['1:2', '1:4'] }]);
  });

  it('excludes a state-flag axis (Hover) from the variants matrix, keeping only size', () => {
    const withFlag = {
      ...spec,
      props: [
        { name: 'Hover', kind: 'variant', options: ['True', 'False'], default: 'False' },
        { name: 'size', kind: 'variant', options: ['Large', 'Small'], default: 'Large' },
      ],
      variants: [
        { prop: 'Hover', values: ['True', 'False'] },
        { prop: 'size', values: ['Large', 'Small'] },
      ],
      variantInstances: [
        { nodeId: '1:2', name: 'Large/Default', values: { Hover: 'False', size: 'Large' } },
        { nodeId: '1:3', name: 'Large/Hover', values: { Hover: 'True', size: 'Large' } },
        { nodeId: '1:4', name: 'Small/Default', values: { Hover: 'False', size: 'Small' } },
        { nodeId: '1:5', name: 'Small/Hover', values: { Hover: 'True', size: 'Small' } },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(withFlag, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    // 1 axis (size) survives; Hover is excluded → single row labeled with the component name.
    expect(block.columns).toEqual(['Large', 'Small']);
    expect(block.rows).toEqual([{ label: 'Button', cells: ['1:2', '1:4'] }]);
  });

  it('sets summary from prose.variantsSummary when present', () => {
    const model = buildDocModel(
      spec,
      { definition: 'd', accessibility: 'a', dos: [], donts: [], variantsSummary: 'Type and size vary independently.' },
      new Set<SectionId>(['variants']),
    );
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.summary).toBe('Type and size vary independently.');
  });

  it('sets summary to null when prose is null', () => {
    const model = buildDocModel(spec, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.summary).toBeNull();
  });

  it('adds a held-axis note for 3+ axes, grid on the first two', () => {
    const threeAxes = {
      ...spec,
      props: [
        { name: 'type', kind: 'variant', options: ['Primary', 'Outline'], default: 'Primary' },
        { name: 'size', kind: 'variant', options: ['Large', 'Small'], default: 'Large' },
        { name: 'shape', kind: 'variant', options: ['Rounded', 'Square'], default: 'Rounded' },
      ],
      variants: [
        { prop: 'type', values: ['Primary', 'Outline'] },
        { prop: 'size', values: ['Large', 'Small'] },
        { prop: 'shape', values: ['Rounded', 'Square'] },
      ],
      variantInstances: [
        { nodeId: '1:2', name: '', values: { type: 'Primary', size: 'Large', shape: 'Rounded' } },
        { nodeId: '1:3', name: '', values: { type: 'Primary', size: 'Small', shape: 'Rounded' } },
        { nodeId: '1:4', name: '', values: { type: 'Outline', size: 'Large', shape: 'Rounded' } },
        { nodeId: '1:5', name: '', values: { type: 'Outline', size: 'Small', shape: 'Rounded' } },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(threeAxes, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.columns).toEqual(['Large', 'Small']);
    expect(block.rows.map((r) => r.label)).toEqual(['Primary', 'Outline']);
    expect(block.note).toBe('Others held at default: shape=Rounded');
  });

  it('qualifies boolean axis values with the axis name so cells are not bare True/False', () => {
    const boolAxes = {
      ...spec,
      props: [
        { name: 'withIcon', kind: 'variant', options: ['False', 'True'], default: 'False' },
        { name: 'fullWidth', kind: 'variant', options: ['False', 'True'], default: 'False' },
      ],
      variants: [
        { prop: 'withIcon', values: ['False', 'True'] },
        { prop: 'fullWidth', values: ['False', 'True'] },
      ],
      variantInstances: [
        { nodeId: '1:2', name: '', values: { withIcon: 'False', fullWidth: 'False' } },
        { nodeId: '1:3', name: '', values: { withIcon: 'False', fullWidth: 'True' } },
        { nodeId: '1:4', name: '', values: { withIcon: 'True', fullWidth: 'False' } },
        { nodeId: '1:5', name: '', values: { withIcon: 'True', fullWidth: 'True' } },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(boolAxes, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.columns).toEqual(['fullWidth: False', 'fullWidth: True']);
    expect(block.rows.map((r) => r.label)).toEqual(['withIcon: False', 'withIcon: True']);
    // Cells still resolve by the raw axis values, not the display labels.
    expect(block.rows[0].cells).toEqual(['1:2', '1:3']);
  });

  it('emits a bullets block "No variants." when there are 0 non-state axes', () => {
    const noVariants = {
      ...spec,
      props: [],
      variants: [],
      variantInstances: [{ nodeId: '1:2', name: 'Button', values: {} }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(noVariants, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    expect(block.kind).toBe('bullets');
    if (block.kind === 'bullets') {
      expect(block.items).toHaveLength(1);
      expect(block.items[0].text).toBe('No variants.');
    }
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
      { part: 'Container', property: 'padding', conditions: {}, ...ident('spacing/md') },
      { part: 'Container', property: 'fill', conditions: { State: ['Default'] }, ...ident('color/rest') },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, ...ident('color/hover') },
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

describe('groupSections', () => {
  const mk = (id: SectionBlock['id']): SectionBlock =>
    ({ id, heading: id, kind: 'prose', text: 'x' });

  it('every section id has a group', () => {
    for (const s of ALL_SECTIONS) {
      expect(['usage', 'specs', 'a11y']).toContain(s.group);
    }
  });

  it('partitions into the three groups in canonical order', () => {
    const groups = groupSections([
      mk('accessibility'), mk('states'), mk('definition'), mk('variants'),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['usage', 'specs', 'a11y']);
    expect(groups[0].sections.map((s) => s.id)).toEqual(['definition', 'variants']);
    expect(groups[1].sections.map((s) => s.id)).toEqual(['states']);
    expect(groups[2].sections.map((s) => s.id)).toEqual(['accessibility']);
  });

  it('omits groups with no sections', () => {
    const groups = groupSections([mk('definition')]);
    expect(groups.map((g) => g.id)).toEqual(['usage']);
  });

  it('GROUPS is Usage → Specifications → Accessibility', () => {
    expect(GROUPS.map((g) => g.label)).toEqual(['Usage', 'Specifications', 'Accessibility']);
  });

  it('labels the accessibility section "Semantics & Focus" so it does not duplicate the group heading', () => {
    const section = ALL_SECTIONS.find((s) => s.id === 'accessibility');
    expect(section?.label).toBe('Semantics & Focus');
  });
});

describe('contrast is not a component section', () => {
  it('is absent from ALL_SECTIONS', () => {
    expect(ALL_SECTIONS.map((s) => s.id)).not.toContain('contrast');
  });
  it('is absent from the known id set', () => {
    expect(KNOWN_SECTION_IDS.has('contrast')).toBe(false);
  });
  it('still offers the other three a11y sections', () => {
    const a11y = ALL_SECTIONS.filter((s) => s.group === 'a11y').map((s) => s.id);
    expect(a11y).toEqual(['interactions', 'contentConsiderations', 'accessibility']);
  });
});

describe('headingLine', () => {
  it('extracts the text of a level-3 subheading', () => {
    expect(headingLine('### Mouse')).toBe('Mouse');
  });

  it('accepts stray shallower/deeper heading depths without leaking markers', () => {
    expect(headingLine('## Keyboard')).toBe('Keyboard');
    expect(headingLine('#### Other')).toBe('Other');
  });

  it('tolerates surrounding whitespace', () => {
    expect(headingLine('  ### Mouse  ')).toBe('Mouse');
  });

  it('returns null for non-heading lines', () => {
    expect(headingLine('Plain paragraph text.')).toBeNull();
    expect(headingLine('- bullet line')).toBeNull();
    expect(headingLine('#hashtag-not-a-heading')).toBeNull();
    expect(headingLine('')).toBeNull();
  });
});

describe('buildDocModel placeholders for merged prose', () => {
  const empty = { definition: '', accessibility: '', dos: [], donts: [] };

  it('renders the placeholder when a required prose field is an empty string', () => {
    const model = buildDocModel(spec, empty, new Set<SectionId>(['definition', 'accessibility']), new Set());
    const texts = model.sections.map((s) => (s.kind === 'prose' ? s.text : ''));
    expect(texts).toEqual(['_To be written._', '_To be written._']);
  });

  it('renders the placeholder when both dos and donts are empty', () => {
    const model = buildDocModel(spec, empty, new Set<SectionId>(['dosDonts']), new Set());
    const block = model.sections[0];
    expect(block.kind).toBe('bullets');
    if (block.kind === 'bullets') expect(block.items.map((b) => b.text)).toEqual(['_To be written._']);
  });

  it('renders the placeholder for an empty optional prose field', () => {
    const model = buildDocModel(
      spec, { ...empty, interactions: '' }, new Set<SectionId>(['interactions']), new Set(),
    );
    const block = model.sections[0];
    if (block.kind === 'prose') expect(block.text).toBe('_To be written._');
  });

  it('drops an empty anatomy summary rather than rendering a blank line', () => {
    const model = buildDocModel(
      spec, { ...empty, anatomySummary: '' }, new Set<SectionId>(['anatomy']), new Set(),
    );
    const block = model.sections[0];
    expect(block.kind).toBe('bullets');
  });
});
