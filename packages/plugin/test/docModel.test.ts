import { describe, it, expect } from 'vitest';
import {
  buildDocModel, calloutLabels, measureKey, groupSections, GROUPS, ALL_SECTIONS,
  KNOWN_SECTION_IDS,
  LEGACY_SECTION_IDS, AI_ONLY_SECTIONS, firstSentence, proseKeysForSections, headingLine,
  type SectionId, type SectionBlock,
} from '../src/ui/docModel';
import { PROSE_V2_KEYS } from '@spec-layer/extractor';
import type { IntermediateSpec, RefIdentity, ProseV2 } from '@spec-layer/extractor';

/** A TokenRule carries the full identity Figma stated for the reference. These
 *  tests are about the doc model, not resolution, so one identity is minted per
 *  token NAME -- what a name meant before the identity fields existed. */
const ident = (name: string): RefIdentity => ({ id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const spec = {
  name: 'checkbox', figmaKey: '', figmaFile: 'f', figmaFileName: 'Design System', figmaNode: '1:1',
  description: 'Selects one or more options. Pairs a box with a label.',
  documentationLinks: ['https://example.com/checkbox'],
  anatomy: [
    { id: '1:2', name: 'checkboxItem', type: 'FRAME', nested: false, depth: 0, path: 'Container/checkboxItem' },
    { id: '1:3', name: 'Label', type: 'TEXT', nested: false, depth: 0, path: 'Container/Label' },
  ],
  anatomyComponentId: '1:10',
  props: [
    { name: 'Style', kind: 'variant', default: 'Filled', options: ['Filled', 'Outlined'] },
    { name: 'showLabel', kind: 'boolean', default: true },
    { name: 'label', kind: 'text', default: 'Label' },
  ],
  variants: [{ prop: 'Style', values: ['Filled', 'Outlined'] }, { prop: 'State', values: ['Default', 'Hover'] }],
  variantInstances: [
    { nodeId: '1:10', name: 'Style=Filled, State=Default', values: { Style: 'Filled', State: 'Default' } },
    { nodeId: '1:11', name: 'Style=Filled, State=Hover', values: { Style: 'Filled', State: 'Hover' } },
    { nodeId: '1:12', name: 'Style=Outlined, State=Default', values: { Style: 'Outlined', State: 'Default' } },
    { nodeId: '1:13', name: 'Style=Outlined, State=Hover', values: { Style: 'Outlined', State: 'Hover' } },
  ],
  states: ['Default', 'Hover'],
  tokens: [
    { part: 'checkboxItem', path: 'Container/checkboxItem', property: 'fill', ...ident('color/bg'), conditions: {} },
    { part: 'checkboxItem', path: 'Container/checkboxItem', property: 'border', ...ident('color/border'), conditions: { State: ['Default'] } },
    { part: 'checkboxItem', path: 'Container/checkboxItem', property: 'border', ...ident('color/border-hover'), conditions: { State: ['Hover'] } },
  ],
  rawValues: [], related: ['Radio'], gaps: [], layout: [], nodeEffects: [],
} as unknown as IntermediateSpec;

const prose: ProseV2 = {
  v: 2,
  overview: { lede: 'A checkbox selects one or more options.', body: ['Use it in forms.'] },
  whenToUse: ['Several options can be chosen.'],
  whenNotToUse: ['Only one option is allowed. Use a Radio instead.'],
  variantsIntro: 'Style sets the weight.',
  variantsGuide: [{ name: 'Filled', guidance: 'the default.' }],
  anatomySummary: 'A box and a label.',
  anatomyParts: [{ name: 'Label', role: 'Names the option.' }],
  properties: [{ name: 'showLabel', description: 'Hides the label for icon-only use.' }],
  states: [{ name: 'Hover', whenItApplies: 'The pointer is over the box.' }],
  keyboard: [{ keys: ['Space'], action: 'Toggles the box.' }],
  pointer: ['Clicking the label toggles the box.'],
  semantics: ['Render a native `<input type="checkbox">`.'],
  content: ['Write labels as statements.'],
  guidelines: [{ do: { rule: 'Pair the box with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not use it for one choice.', reason: 'Use a Radio.' } }],
};

const ALL = new Set<SectionId>(ALL_SECTIONS.map((s) => s.id));
const find = (model: { sections: SectionBlock[] }, id: SectionId): SectionBlock | undefined =>
  model.sections.find((s) => s.id === id);

describe('section map', () => {
  it('lists the fourteen sections in frame order', () => {
    expect(ALL_SECTIONS.map((s) => s.id)).toEqual([
      'definition', 'whenToUse', 'variants', 'dosDonts', 'related',
      'anatomy', 'properties', 'states', 'measurements', 'tokens',
      'keyboard', 'pointer', 'accessibility', 'contentConsiderations',
    ]);
    expect(GROUPS.map((g) => g.label)).toEqual(['Usage', 'Specifications', 'Accessibility']);
    expect(KNOWN_SECTION_IDS.has('configuration')).toBe(false);
    expect(LEGACY_SECTION_IDS.configuration).toEqual(['properties']);
  });

  it('groups the a11y sections Keyboard -> Pointer -> Semantics -> Content', () => {
    const a11y = ALL_SECTIONS.filter((s) => s.group === 'a11y').map((s) => s.id);
    expect(a11y).toEqual(['keyboard', 'pointer', 'accessibility', 'contentConsiderations']);
  });
});

describe('proseKeysForSections asks the v9 prompt for v2 keys', () => {
  it('maps every prose-bearing section to its v2 keys', () => {
    expect([...proseKeysForSections(['definition', 'whenToUse', 'dosDonts'])].sort())
      .toEqual(['guidelines', 'overview', 'whenNotToUse', 'whenToUse']);
    expect([...proseKeysForSections(['keyboard', 'pointer', 'accessibility', 'contentConsiderations'])].sort())
      .toEqual(['content', 'keyboard', 'pointer', 'semantics']);
    expect([...proseKeysForSections(['variants', 'anatomy', 'properties', 'states'])].sort())
      .toEqual(['anatomyParts', 'anatomySummary', 'properties', 'variantsGuide', 'variantsIntro']);
  });
  it('asks nothing for the deterministic sections', () => {
    expect(proseKeysForSections(['measurements', 'tokens', 'related'])).toEqual(new Set());
  });

  it('covers every v2 key but `states`, so a new one cannot be added with no section asking for it', () => {
    // A key nothing requests is never generated and never rendered, but the
    // prompt, the validator and the stored blob all carry it. This is the
    // check that says so at the moment the key is added rather than at the
    // moment someone wonders why a section is always empty. `states` is the
    // one deliberate exception: the table that drew it was removed on
    // 2026-09-19, and the key waits in the contract for 6.0.0 to retire it,
    // because dropping it from the exemplar moves the prompt bytes.
    const requested = [...proseKeysForSections(ALL_SECTIONS.map((s) => s.id))].sort();
    expect(requested).toEqual([...PROSE_V2_KEYS].filter((k) => k !== 'states').sort());
  });
});

describe('buildDocModel with prose', () => {
  const model = buildDocModel(spec, prose, ALL, new Set(['1:10']), { aiEnabled: true });

  it('names the component for people and keeps the raw name', () => {
    expect(model.componentName).toBe('checkbox');
    expect(model.displayName).toBe('Checkbox');
  });

  it('renders the AI overview as tagged prose, led by the designer description', () => {
    expect(find(model, 'definition')).toEqual({
      id: 'definition', heading: 'Overview', kind: 'prose', source: 'ai',
      subtitle: { text: 'Selects one or more options.', source: 'description' },
      lede: 'A checkbox selects one or more options.',
      text: 'Use it in forms.',
    });
  });

  it('builds when to use as two columns', () => {
    const block = find(model, 'whenToUse');
    expect(block?.kind).toBe('twoColumns');
    if (block?.kind !== 'twoColumns') return;
    expect(block.left.heading).toBe('When to use');
    expect(block.left.items.map((b) => b.text)).toEqual(['Several options can be chosen.']);
    expect(block.right.slot).toBe('whenNotToUse');
  });

  it('builds the variants matrix with intro and guide, option axes only', () => {
    const block = find(model, 'variants');
    if (block?.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.intro).toBe('Style sets the weight.');
    expect(block.guide).toEqual([{ name: 'Filled', guidance: 'the default.' }]);
    expect(block.columns).toEqual(['Filled', 'Outlined']);
  });

  it('builds do and don\'t as pairs', () => {
    expect(find(model, 'dosDonts')).toMatchObject({ kind: 'guidelinePairs', pairs: prose.guidelines });
  });

  it('builds the properties table with every property and plain-word types', () => {
    const block = find(model, 'properties');
    if (block?.kind !== 'propertiesTable') throw new Error('expected propertiesTable');
    expect(block.hasDescriptions).toBe(true);
    expect(block.rows).toEqual([
      { name: 'Style', type: 'Variant', values: 'Filled · Outlined', defaultValue: 'Filled', description: null },
      // One separator for the whole Values column, boolean or enum.
      { name: 'showLabel', type: 'Boolean', values: 'true · false', defaultValue: 'true', description: 'Hides the label for icon-only use.' },
      { name: 'label', type: 'Text', values: '', defaultValue: 'Label', description: null },
    ]);
  });

  it('draws the states matrix with no table under it, and never asks for the states prose key', () => {
    const block = find(model, 'states');
    if (block?.kind !== 'statesMatrix') throw new Error('expected statesMatrix');
    expect('table' in block).toBe(false);
    expect(proseKeysForSections(['states'])).toEqual(new Set());
  });

  it('builds the keyboard table and the three bullet sections with their slots', () => {
    expect(find(model, 'keyboard')).toMatchObject({ kind: 'keyboardTable', rows: [{ keys: ['Space'], action: 'Toggles the box.' }] });
    expect(find(model, 'pointer')).toMatchObject({ kind: 'bullets', slot: 'pointer' });
    expect(find(model, 'accessibility')).toMatchObject({ kind: 'bullets', slot: 'semantics', heading: 'Semantics and focus' });
    expect(find(model, 'contentConsiderations')).toMatchObject({ kind: 'bullets', slot: 'content', heading: 'Content' });
  });

  it('carries anatomy roles under the new field and the measurements table rows', () => {
    const anatomy = find(model, 'anatomy');
    if (anatomy?.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(anatomy.parts.find((p) => p.name === 'Label')?.role).toBe('Names the option.');
    const measure = find(model, 'measurements');
    if (measure?.kind !== 'measure') throw new Error('expected measure');
    // Both bindings are colours, so the Measurements table lists neither.
    expect(measure.tableRows).toEqual([]);
  });

  it('lists related components as a bullet list with no slot', () => {
    expect(find(model, 'related')).toMatchObject({ kind: 'bullets', slot: null });
  });

  it('omits nothing when every section has content', () => {
    expect(model.omitted).toEqual([]);
  });
});

describe('buildDocModel without prose', () => {
  it('renders the description verbatim as the overview and omits the AI-only sections with reasons', () => {
    const model = buildDocModel(spec, null, ALL, new Set(), { aiEnabled: false });
    expect(find(model, 'definition')).toEqual({
      id: 'definition', heading: 'Overview', kind: 'prose', source: 'description',
      subtitle: { text: 'Selects one or more options.', source: 'description' },
      lede: null,
      text: 'Pairs a box with a label.',
    });
    // No variant is ticked, so Tokens falls back to the conditioned table.
    expect(model.sections.map((s) => s.id)).toEqual([
      'definition', 'variants', 'related', 'anatomy', 'properties', 'states', 'measurements', 'tokens',
    ]);
    expect(find(model, 'tokens')).toMatchObject({ kind: 'table', columns: ['Part', 'Property', 'Token', 'Condition'] });
    expect(model.omitted).toEqual([
      { id: 'whenToUse', label: 'When to use', reason: 'aiOff' },
      { id: 'dosDonts', label: 'Do and don’t', reason: 'aiOff' },
      { id: 'keyboard', label: 'Keyboard', reason: 'aiOff' },
      { id: 'pointer', label: 'Pointer and touch', reason: 'aiOff' },
      { id: 'accessibility', label: 'Semantics and focus', reason: 'aiOff' },
      { id: 'contentConsiderations', label: 'Content', reason: 'aiOff' },
    ]);
  });

  it('omits the overview when there is no description either, and reports nothingToShow when AI was on but silent', () => {
    const bare = { ...spec, description: '', related: [] } as IntermediateSpec;
    const model = buildDocModel(bare, { v: 2 }, new Set<SectionId>(['definition', 'related', 'keyboard']), new Set(), { aiEnabled: true });
    expect(model.sections).toEqual([]);
    expect(model.omitted).toEqual([
      { id: 'definition', label: 'Overview', reason: 'nothingToShow' },
      { id: 'related', label: 'Related components', reason: 'nothingToShow' },
      { id: 'keyboard', label: 'Keyboard', reason: 'nothingToShow' },
    ]);
  });

  it('reports aiOff only for the sections AI writing would have filled', () => {
    // A plain component: no variant axes, so Variants is empty whatever AI
    // does. Saying 'aiOff' there would promise a section that turning AI on
    // could not produce.
    const plain = {
      ...spec, variants: [], variantInstances: [], states: [],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(
      plain, null, new Set<SectionId>(['variants', 'whenToUse']), new Set(), { aiEnabled: false },
    );
    expect(model.omitted).toEqual([
      { id: 'whenToUse', label: 'When to use', reason: 'aiOff' },
      { id: 'variants', label: 'Variants', reason: 'nothingToShow' },
    ]);
  });

  it('names exactly the prose-fed sections as AI-only', () => {
    expect([...AI_ONLY_SECTIONS].sort()).toEqual(
      ['accessibility', 'contentConsiderations', 'dosDonts', 'keyboard', 'pointer', 'whenToUse'],
    );
    // Overview falls back to the Figma description, and these four are built
    // from the spec, so none of them is AI-only.
    for (const id of ['definition', 'variants', 'anatomy', 'properties', 'states'] as SectionId[]) {
      expect(AI_ONLY_SECTIONS.has(id)).toBe(false);
    }
  });

  it('drops a properties description column when no row has one', () => {
    const model = buildDocModel(spec, { v: 2 }, new Set<SectionId>(['properties']), new Set(), { aiEnabled: true });
    expect(find(model, 'properties')).toMatchObject({ kind: 'propertiesTable', hasDescriptions: false });
  });

  it('emits only selected sections, in canonical order', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['variants', 'definition']));
    expect(model.sections.map((s) => s.id)).toEqual(['definition', 'variants']);
    expect(model.componentName).toBe('checkbox');
  });

  it('labels the definition section "Overview"', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['definition']));
    expect(model.sections[0].heading).toBe('Overview');
  });
});

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

describe('tokens section', () => {
  it('shapes tokens as a table block', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['tokens']));
    const tok = model.sections[0];
    expect(tok.kind).toBe('table');
    if (tok.kind === 'table') expect(tok.rows.length).toBeGreaterThan(0);
  });

  it('omits the section when there are no token rules at all', () => {
    const bare = { ...spec, tokens: [] } as IntermediateSpec;
    const model = buildDocModel(bare, prose, new Set<SectionId>(['tokens']));
    expect(model.sections).toEqual([]);
    expect(model.omitted).toEqual([{ id: 'tokens', label: 'Tokens', reason: 'nothingToShow' }]);
  });

  it('builds per-variant token blocks when variants are selected', () => {
    const specV = {
      ...spec,
      variants: [{ prop: 'Style', values: ['Filled', 'Text'] }],
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
});

describe('anatomy section', () => {
  it('shapes anatomy as a numbered diagram block carrying part + component ids', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [
        { id: 'p:1', name: 'Container', type: 'FRAME', nested: false, depth: 0 },
        { id: 'p:2', name: 'Icon', type: 'INSTANCE', nested: true, depth: 1, component: 'Icon' },
      ],
      tokens: [{ part: 'Container', property: 'fill', ...ident('color/bg'), conditions: {} }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    const block = model.sections[0];
    expect(block.kind).toBe('anatomy');
    if (block.kind === 'anatomy') {
      expect(block.componentId).toBe('c:1');
      expect(block.view).toBe('diagram');
      expect(block.parts).toEqual([
        { label: '1', name: 'Container', nested: false, id: 'p:1', depth: 0, component: undefined, tokens: ['color/bg'], type: 'FRAME', role: undefined, shownBy: undefined },
        { label: '1.1', name: 'Icon', nested: true, id: 'p:2', depth: 1, component: 'Icon', tokens: [], type: 'INSTANCE', role: undefined, shownBy: undefined },
      ]);
    }
  });

  it('writes Always, not a dash, for a token bound under every condition', () => {
    const specT = {
      ...spec,
      tokens: [
        { part: 'label', property: 'fill', ...ident('color/label'), conditions: {} },
        { part: 'label', property: 'fill', ...ident('color/label-hover'), conditions: { State: ['Hover'] } },
      ],
    } as unknown as IntermediateSpec;
    const block = buildDocModel(specT, null, new Set<SectionId>(['tokens'])).sections[0];
    if (block.kind !== 'table') throw new Error('expected the conditioned tokens table');
    expect(block.rows.map((row) => row[3])).toEqual(['Always', 'State=Hover']);
  });

  it('draws anatomy as a diagram, the only view there is', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [{ id: '2', name: 'label', type: 'TEXT', nested: false, depth: 0 }],
      tokens: [{ part: 'label', property: 'fill', ...ident('color/label'), conditions: {} }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']), undefined, { anatomyView: 'diagram' });
    const block = model.sections[0];
    if (block.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(block.view).toBe('diagram');
    expect(block.parts[0].depth).toBe(0);
    expect(block.parts[0].tokens).toContain('color/label');
  });

  it('omits the section when there is no component to screenshot', () => {
    const specA = { ...spec, anatomyComponentId: '', anatomy: [] } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    expect(model.sections).toEqual([]);
    expect(model.omitted).toEqual([{ id: 'anatomy', label: 'Anatomy', reason: 'nothingToShow' }]);
  });

  it('drops parts hidden by default from the anatomy block unless includeHidden is on', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [
        { id: 'p:1', name: 'Icon left', type: 'FRAME', nested: false, depth: 0, hiddenByDefault: true, shownBy: 'Icon left' },
        { id: 'p:2', name: 'Label', type: 'TEXT', nested: false, depth: 0 },
      ],
    } as unknown as IntermediateSpec;

    const off = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    expect(off.includeHidden).toBeUndefined();
    const offBlock = off.sections[0];
    if (offBlock.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(offBlock.parts.map((p) => [p.label, p.name])).toEqual([['1', 'Label']]);

    const on = buildDocModel(specA, null, new Set<SectionId>(['anatomy']), undefined, { includeHidden: true });
    expect(on.includeHidden).toBe(true);
    const onBlock = on.sections[0];
    if (onBlock.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(onBlock.parts.map((p) => [p.label, p.name, p.shownBy])).toEqual([
      ['1', 'Icon left', 'Icon left'], ['2', 'Label', undefined],
    ]);
  });

  it('numbers anatomy callouts hierarchically, so the pinned depth-0 set has no holes', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [
        { id: 'p:1', name: 'Icon left', type: 'FRAME', nested: false, depth: 0 },
        { id: 'p:2', name: 'Glyph', type: 'VECTOR', nested: false, depth: 1 },
        { id: 'p:3', name: 'Label', type: 'TEXT', nested: false, depth: 0 },
        { id: 'p:4', name: 'Icon right', type: 'FRAME', nested: false, depth: 0 },
        { id: 'p:5', name: 'Glyph', type: 'VECTOR', nested: false, depth: 1 },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    const block = model.sections[0];
    if (block.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(block.parts.map((p) => [p.label, p.name])).toEqual([
      ['1', 'Icon left'], ['1.1', 'Glyph'],
      ['2', 'Label'],
      ['3', 'Icon right'], ['3.1', 'Glyph'],
    ]);
    // Only depth-0 parts get a pin, and those labels count 1, 2, 3 with
    // nothing skipped. A flat index would have drawn 1, 3 and 4.
    expect(block.parts.filter((p) => p.depth === 0).map((p) => p.label))
      .toEqual(['1', '2', '3']);
  });

  it('shows a hidden part\'s token rules only when includeHidden is on', () => {
    const ref = {
      id: 'VariableID:1', kind: 'variable' as const, remote: false,
      collectionId: 'VariableCollectionId:1',
    };
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [
        { id: 'p:1', name: 'Icon left', type: 'FRAME', nested: false, depth: 0, hiddenByDefault: true, shownBy: 'Icon left' },
        { id: 'p:2', name: 'Label', type: 'TEXT', nested: false, depth: 0 },
      ],
      variantInstances: [],
      tokens: [
        { part: 'Label', path: 'Chip/Label', property: 'fill', conditions: {}, name: 'Role/Text/Default', ...ref },
        { part: 'Icon left', path: 'Chip/Icon left', property: 'fill', conditions: {}, name: 'Role/Text/Accent', ...ref, shownBy: 'Icon left' },
      ],
    } as unknown as IntermediateSpec;

    const sections = new Set<SectionId>(['tokens', 'anatomy']);
    const off = buildDocModel(specA, null, sections);
    const offTokens = off.sections.find((b) => b.id === 'tokens');
    if (offTokens?.kind !== 'table') throw new Error('expected table');
    expect(offTokens.rows.map((r) => r[2])).toEqual(['Role/Text/Default']);
    const offAnatomy = off.sections.find((b) => b.id === 'anatomy');
    if (offAnatomy?.kind !== 'anatomy') throw new Error('expected anatomy');
    // The legend must not lend a hidden part's token names to a row either.
    expect(offAnatomy.parts.flatMap((p) => p.tokens)).toEqual(['Role/Text/Default']);

    const on = buildDocModel(specA, null, sections, undefined, { includeHidden: true });
    const onTokens = on.sections.find((b) => b.id === 'tokens');
    if (onTokens?.kind !== 'table') throw new Error('expected table');
    expect(onTokens.rows.map((r) => r[2]))
      .toEqual(['Role/Text/Default', 'Role/Text/Accent']);
    const onAnatomy = on.sections.find((b) => b.id === 'anatomy');
    if (onAnatomy?.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(onAnatomy.parts.find((p) => p.name === 'Icon left')!.tokens)
      .toEqual(['Role/Text/Accent']);
  });

  it('drops an empty anatomy summary rather than rendering a blank line', () => {
    const anatomySpec = {
      ...spec,
      anatomyComponentId: '1:2',
      anatomy: [{ name: 'Label', nested: false, id: '1:3', depth: 0, type: 'TEXT' }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(
      anatomySpec, { v: 2, anatomySummary: '' }, new Set<SectionId>(['anatomy']), new Set(),
    );
    const block = model.sections[0];
    expect(block.kind).toBe('anatomy');
    if (block.kind === 'anatomy') expect(block.summary).toBeNull();
  });

  it('preserves a non-empty anatomy summary', () => {
    const anatomySpec = {
      ...spec,
      anatomyComponentId: '1:2',
      anatomy: [{ name: 'Label', nested: false, id: '1:3', depth: 0, type: 'TEXT' }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(
      anatomySpec, { v: 2, anatomySummary: 'Two parts.' }, new Set<SectionId>(['anatomy']), new Set(),
    );
    const block = model.sections[0];
    expect(block.kind).toBe('anatomy');
    if (block.kind === 'anatomy') expect(block.summary).toBe('Two parts.');
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
    documentationLinks: [], related: [], gaps: [], layout: [],
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
    expect(block.tableRows).toEqual([
      ['Container', 'padding', 'spacing/md'], ['Container', 'gap', 'spacing/sm'],
    ]);
  });

  it('lists only dimensional bindings in the table: colour and typography stay in the Tokens section', () => {
    const mixed = {
      ...spec,
      tokens: [
        ...spec.tokens,
        { part: 'Label', property: 'fill', conditions: {}, ...ident('color/text') },
        { part: 'Label', property: 'typography', conditions: {}, ...ident('Body/M') },
        { part: 'Container', property: 'border', conditions: {}, ...ident('color/border') },
        { part: 'Container', property: 'border-radius', conditions: {}, ...ident('radius/sm') },
        { part: 'Container', property: 'border-top-width', conditions: {}, ...ident('stroke/bold') },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(mixed, null, new Set(['measurements']), new Set(['1:2']));
    const block = model.sections[0];
    if (block.kind !== 'measure') throw new Error('expected measure block');
    expect(block.tableRows).toEqual([
      ['Container', 'padding', 'spacing/md'], ['Container', 'gap', 'spacing/sm'],
      ['Container', 'border-radius', 'radius/sm'], ['Container', 'border-top-width', 'stroke/bold'],
    ]);
    // The diagram's own lookup is untouched: it never asks for a colour.
    expect(block.tokens[measureKey('Container', 'border-radius')]).toBe('radius/sm');
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
    rawValues: [], documentationLinks: [], related: [], gaps: [], layout: [],
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
    expect(model.omitted).toEqual([{ id: 'states', label: 'States', reason: 'nothingToShow' }]);
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
    // value) -- naive slice(0, 4) would silently drop it. Default-first ordering
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
    rawValues: [], documentationLinks: [], related: [], gaps: [], layout: [],
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
  // axes type[Primary,Outline] x size[Large,Small]; instances for all 4 combos.
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
    rawValues: [], documentationLinks: [], related: [], gaps: [], layout: [],
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
    // 1 axis (size) survives; Hover is excluded, so a single row labeled with
    // the component name.
    expect(block.columns).toEqual(['Large', 'Small']);
    expect(block.rows).toEqual([{ label: 'Button', cells: ['1:2', '1:4'] }]);
  });

  it('sets intro and guide from the v2 prose when present', () => {
    const model = buildDocModel(
      spec,
      {
        v: 2,
        variantsIntro: 'Type and size vary independently.',
        variantsGuide: [{ name: 'Primary', guidance: 'the default.' }],
      },
      new Set<SectionId>(['variants']),
    );
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.intro).toBe('Type and size vary independently.');
    expect(block.guide).toEqual([{ name: 'Primary', guidance: 'the default.' }]);
  });

  it('drops a guide entry naming an option the spec no longer has, and keeps a matching one whatever its case', () => {
    const model = buildDocModel(
      spec,
      {
        v: 2,
        variantsGuide: [
          { name: 'Ghost', guidance: 'renamed away since this was written.' },
          { name: 'outLINE', guidance: 'for secondary actions.' },
        ],
      },
      new Set<SectionId>(['variants']),
    );
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.guide).toEqual([{ name: 'outLINE', guidance: 'for secondary actions.' }]);
  });

  it('drops a guide entry that names a state-axis value, because the matrix never draws that column', () => {
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
        { nodeId: '1:4', name: 'Small/Default', values: { Hover: 'False', size: 'Small' } },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(
      withFlag,
      { v: 2, variantsGuide: [{ name: 'True', guidance: 'on hover.' }, { name: 'Large', guidance: 'the default.' }] },
      new Set<SectionId>(['variants']),
    );
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.guide).toEqual([{ name: 'Large', guidance: 'the default.' }]);
  });

  it('sets intro to null and guide to empty when prose is null', () => {
    const model = buildDocModel(spec, null, new Set<SectionId>(['variants']));
    const block = model.sections[0];
    if (block.kind !== 'variantsMatrix') throw new Error('expected variantsMatrix');
    expect(block.intro).toBeNull();
    expect(block.guide).toEqual([]);
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
    expect(block.note).toBe('Other properties held at default: shape=Rounded');
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

  it('omits the section when there are 0 non-state axes', () => {
    const noVariants = {
      ...spec,
      props: [],
      variants: [],
      variantInstances: [{ nodeId: '1:2', name: 'Button', values: {} }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(noVariants, null, new Set<SectionId>(['variants']));
    expect(model.sections).toEqual([]);
    expect(model.omitted).toEqual([{ id: 'variants', label: 'Variants', reason: 'nothingToShow' }]);
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
    documentationLinks: [], related: [], gaps: [], layout: [],
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
    // appended after a part boundary, so all Container rows stay contiguous.
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

describe('the Overview header subtitle', () => {
  const only = new Set<SectionId>(['definition']);
  const undescribed = { ...spec, description: '' } as unknown as IntermediateSpec;
  const overview = (s: IntermediateSpec, p: ProseV2 | null): SectionBlock | undefined =>
    find(buildDocModel(s, p, only, new Set(), { aiEnabled: p !== null }), 'definition');

  it('leads with the designer description whenever there is one, even beside AI prose', () => {
    expect(overview(spec, prose)).toEqual({
      id: 'definition', heading: 'Overview', kind: 'prose', source: 'ai',
      subtitle: { text: 'Selects one or more options.', source: 'description' },
      lede: 'A checkbox selects one or more options.',
      text: 'Use it in forms.',
    });
  });

  it('falls back to the AI lede when the component carries no description', () => {
    expect(overview(undescribed, prose)).toEqual({
      id: 'definition', heading: 'Overview', kind: 'prose', source: 'ai',
      subtitle: { text: 'A checkbox selects one or more options.', source: 'ai' },
      lede: null,
      text: 'Use it in forms.',
    });
  });

  it('has no subtitle, and no Overview at all, when there is neither', () => {
    expect(overview(undescribed, null)).toBeUndefined();
  });

  it('keeps the rest of the description as the body when the AI wrote nothing', () => {
    expect(overview(spec, null)).toEqual({
      id: 'definition', heading: 'Overview', kind: 'prose', source: 'description',
      subtitle: { text: 'Selects one or more options.', source: 'description' },
      lede: null,
      text: 'Pairs a box with a label.',
    });
  });
});

describe('groupSections', () => {
  const mk = (id: SectionBlock['id']): SectionBlock =>
    ({ id, heading: id, kind: 'prose', text: 'x', source: 'ai', subtitle: null, lede: null });

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

  it('GROUPS is Usage -> Specifications -> Accessibility', () => {
    expect(GROUPS.map((g) => g.label)).toEqual(['Usage', 'Specifications', 'Accessibility']);
  });

  it('labels the accessibility section "Semantics and focus" so it does not duplicate the group heading', () => {
    const section = ALL_SECTIONS.find((s) => s.id === 'accessibility');
    expect(section?.label).toBe('Semantics and focus');
  });
});


describe('contrast is not a component section', () => {
  it('is absent from ALL_SECTIONS', () => {
    expect(ALL_SECTIONS.map((s) => s.id)).not.toContain('contrast');
  });
  it('is absent from the known id set', () => {
    expect(KNOWN_SECTION_IDS.has('contrast')).toBe(false);
  });
  it('still offers the four a11y sections', () => {
    const a11y = ALL_SECTIONS.filter((s) => s.group === 'a11y').map((s) => s.id);
    expect(a11y).toEqual(['keyboard', 'pointer', 'accessibility', 'contentConsiderations']);
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

describe('calloutLabels', () => {
  it('counts per depth and resets a deeper counter on the way back down', () => {
    expect(calloutLabels([0, 1, 1, 0, 1, 2, 0])).toEqual([
      '1', '1.1', '1.2', '2', '2.1', '2.1.1', '3',
    ]);
  });

  it('numbers a flat list exactly as a 1-based index does', () => {
    expect(calloutLabels([0, 0, 0])).toEqual(['1', '2', '3']);
  });

  it('has nothing to say about an empty list', () => {
    expect(calloutLabels([])).toEqual([]);
  });
});
