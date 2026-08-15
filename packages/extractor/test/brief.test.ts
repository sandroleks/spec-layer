import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { foundationBrief, componentBrief } from '../src/brief';
import { toYaml } from '../src/yaml';
import type { FoundationSpec } from '../src/foundation';
import type { IntermediateSpec } from '../src/extract';
import type { YamlValue } from '../src/yaml';

const AT = '2026-08-14T10:22:00.000Z';

/** Shape of the parsed brief, just deep enough for these assertions. Typed
 *  rather than `any` so a shape drift fails at compile time, matching the
 *  convention in yaml.test.ts. */
interface ParsedBrief {
  collections: { tokens: Record<string, unknown>[] }[];
  text_styles: Record<string, unknown>[];
}

function parseBrief(v: YamlValue): ParsedBrief {
  return load(toYaml(v)) as ParsedBrief;
}

const FOUNDATION: FoundationSpec = {
  fileKey: 'abc123',
  extractedAt: AT,
  collections: [{
    id: 'C1',
    name: 'Color',
    modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
    defaultModeId: 'm1',
    variables: [
      {
        name: 'color/bg/brand', group: 'color', resolvedType: 'COLOR',
        description: 'Primary brand surface',
        codeSyntax: { WEB: '--color-bg-brand' },
        valuesByMode: {
          m1: { kind: 'color', hex: '#2563EB', alpha: 1 },
          m2: { kind: 'color', hex: '#3B82F6', alpha: 1 },
        },
      },
      {
        name: 'color/bg/muted', group: 'color', resolvedType: 'COLOR',
        description: '', codeSyntax: {},
        valuesByMode: {
          m1: { kind: 'alias', targetName: 'color/neutral/100', targetCollection: 'Color',
                external: false, resolved: { kind: 'color', hex: '#F5F5F5', alpha: 1 } },
          m2: { kind: 'unresolved', reason: 'external' },
        },
      },
    ],
  }],
  textStyles: [{
    name: 'Body/Regular', group: 'Body', description: '',
    fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
    lineHeight: { unit: 'PIXELS', value: 24 },
    letterSpacing: { unit: 'PERCENT', value: 0 },
    paragraphSpacing: 0, paragraphIndent: 0,
    textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {},
  }],
};

describe('foundationBrief', () => {
  it('stamps the envelope with the extractor version and brief version', () => {
    const b = foundationBrief(FOUNDATION, AT) as Record<string, Record<string, unknown>>;
    expect(b.spec_layer.kind).toBe('foundation');
    expect(b.spec_layer.version).toBe(1);
    expect(b.spec_layer.extractor).toBe('1');
  });

  it('keys mode values by mode name, not modeId', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect(y.collections[0].tokens[0].values).toEqual({ Light: '#2563EB', Dark: '#3B82F6' });
  });

  it('emits code only when codeSyntax is populated', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect(y.collections[0].tokens[0].code).toEqual({ WEB: '--color-bg-brand' });
    expect('code' in y.collections[0].tokens[1]).toBe(false);
  });

  it('gives an alias both its target and its resolved value', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect((y.collections[0].tokens[1].values as Record<string, unknown>).Light)
      .toEqual({ alias: 'color/neutral/100', resolved: '#F5F5F5' });
  });

  it('states why an unresolved value is unresolved instead of dropping it', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect((y.collections[0].tokens[1].values as Record<string, unknown>).Dark).toEqual({ unresolved: 'external' });
  });

  it('emits text styles', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect(y.text_styles[0]).toEqual({
      name: 'Body/Regular',
      font: { family: 'Inter', style: 'Regular', size: 16 },
      line_height: { unit: 'PIXELS', value: 24 },
      letter_spacing: { unit: 'PERCENT', value: 0 },
    });
  });

  it('is deterministic', () => {
    expect(toYaml(foundationBrief(FOUNDATION, AT))).toBe(toYaml(foundationBrief(FOUNDATION, AT)));
  });
});

// ---------------------------------------------------------------------------
// componentBrief
// ---------------------------------------------------------------------------

/** Shape of the parsed component brief, just deep enough for these
 *  assertions. Typed rather than `any` so a shape drift fails at compile
 *  time, matching the convention above. */
interface AnatomyNode {
  part: string;
  type: string;
  component?: string;
  children?: AnatomyNode[];
}
interface ParsedComponentBrief {
  spec_layer: { kind: string; version: number; extractor: string; generated: string };
  source: { file: string; node: string; component_key?: string };
  component: { name: string; related?: string[] };
  api: Array<{ name: string; kind: string; options?: string[]; default?: string | boolean }>;
  axes?: Array<{ prop: string; values: string[] }>;
  states?: string[];
  anatomy: AnatomyNode[];
  layout?: Array<{ part: string; summary: string }>;
  unbound?: Array<{ part: string; issue: string }>;
  contrast: { measured: number; skipped: number; findings: unknown[] };
  guidelines?: {
    definition?: string;
    accessibility?: string;
    dos?: string[];
    donts?: string[];
    interactions?: string;
    variants_summary?: string;
    anatomy_summary?: string;
    design_considerations?: string;
    content_considerations?: string;
  };
}

const SPEC: IntermediateSpec = {
  name: 'Button', figmaKey: 'm3-button', figmaFile: 'abc123', figmaNode: '1:100',
  anatomyComponentId: '1:101',
  anatomy: [
    { id: 'p0', name: 'container', type: 'FRAME', nested: false, depth: 0 },
    { id: 'p1', name: 'icon', type: 'INSTANCE', nested: true, depth: 1, component: 'Icon' },
    { id: 'p2', name: 'label', type: 'TEXT', nested: false, depth: 1 },
  ],
  props: [
    { name: 'label', kind: 'text', default: 'Button' },
    { name: 'Style', kind: 'variant', options: ['Filled', 'Outlined'], default: 'Filled' },
    { name: 'disabled', kind: 'boolean', default: false },
  ],
  variants: [
    { prop: 'Style', values: ['Filled', 'Outlined'] },
    { prop: 'State', values: ['Enabled', 'Hovered'] },
  ],
  variantInstances: [
    { nodeId: '1:101', name: 'Style=Filled, State=Enabled', values: { Style: 'Filled', State: 'Enabled' } },
    { nodeId: '1:102', name: 'Style=Filled, State=Hovered', values: { Style: 'Filled', State: 'Hovered' } },
  ],
  states: ['Enabled', 'Hovered'],
  tokens: [],
  related: ['Icon'],
  gaps: [{ part: 'container', issue: 'hardcoded itemSpacing (8px)' }],
  layout: [{ part: 'container', summary: 'horizontal, gap 8' }],
  rawValues: [],
  contrast: { evaluated: 4, skipped: 1, findings: [] },
};

const brief = (over: Partial<Parameters<typeof componentBrief>[1]> = {}): ParsedComponentBrief =>
  load(toYaml(componentBrief(SPEC, { generatedAt: AT, ...over }))) as ParsedComponentBrief;

describe('componentBrief', () => {
  it('stamps a component envelope and the source identity', () => {
    const y = brief();
    expect(y.spec_layer.kind).toBe('component');
    expect(y.source).toEqual({ file: 'abc123', node: '1:100', component_key: 'm3-button' });
  });

  it('emits props with their PropKind verbatim', () => {
    expect(brief().api).toEqual([
      { name: 'label', kind: 'text', default: 'Button' },
      { name: 'Style', kind: 'variant', options: ['Filled', 'Outlined'], default: 'Filled' },
      { name: 'disabled', kind: 'boolean', default: false },
    ]);
  });

  it('nests anatomy by depth rather than emitting a flat list', () => {
    expect(brief().anatomy).toEqual([{
      part: 'container', type: 'FRAME',
      children: [
        { part: 'icon', type: 'INSTANCE', component: 'Icon' },
        { part: 'label', type: 'TEXT' },
      ],
    }]);
  });

  it('emits axes, states, layout and related', () => {
    const y = brief();
    expect(y.axes).toEqual([
      { prop: 'Style', values: ['Filled', 'Outlined'] },
      { prop: 'State', values: ['Enabled', 'Hovered'] },
    ]);
    expect(y.states).toEqual(['Enabled', 'Hovered']);
    expect(y.layout).toEqual([{ part: 'container', summary: 'horizontal, gap 8' }]);
    expect(y.component).toEqual({ name: 'Button', related: ['Icon'] });
  });

  it('emits gaps as unbound', () => {
    expect(brief().unbound).toEqual([{ part: 'container', issue: 'hardcoded itemSpacing (8px)' }]);
  });

  it('reports measured and skipped counts so an empty findings list is readable', () => {
    expect(brief().contrast).toEqual({ measured: 4, skipped: 1, findings: [] });
  });

  it('includes stored guidelines verbatim', () => {
    const y = brief({ prose: { definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'] } });
    expect(y.guidelines).toEqual({
      definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'],
    });
  });

  it('omits guidelines entirely when none were stored', () => {
    expect('guidelines' in brief()).toBe(false);
    expect('guidelines' in brief({ prose: null })).toBe(false);
  });

  it('nests anatomy correctly when depth jumps back by more than one level', () => {
    const spec: IntermediateSpec = {
      ...SPEC,
      anatomy: [
        { id: 'a', name: 'a', type: 'FRAME', nested: false, depth: 0 },
        { id: 'b', name: 'b', type: 'FRAME', nested: false, depth: 1 },
        { id: 'c', name: 'c', type: 'FRAME', nested: false, depth: 2 },
        { id: 'd', name: 'd', type: 'FRAME', nested: false, depth: 0 },
      ],
    };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.anatomy).toEqual([
      { part: 'a', type: 'FRAME', children: [{ part: 'b', type: 'FRAME', children: [{ part: 'c', type: 'FRAME' }] }] },
      { part: 'd', type: 'FRAME' },
    ]);
  });

  it('treats a first part whose depth is not 0 as a root', () => {
    const spec: IntermediateSpec = {
      ...SPEC,
      anatomy: [
        { id: 'a', name: 'a', type: 'FRAME', nested: false, depth: 2 },
        { id: 'b', name: 'b', type: 'FRAME', nested: false, depth: 3 },
      ],
    };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.anatomy).toEqual([
      { part: 'a', type: 'FRAME', children: [{ part: 'b', type: 'FRAME' }] },
    ]);
  });

  it('keeps consecutive same-depth parts as siblings', () => {
    const spec: IntermediateSpec = {
      ...SPEC,
      anatomy: [
        { id: 'a', name: 'a', type: 'FRAME', nested: false, depth: 0 },
        { id: 'b', name: 'b', type: 'FRAME', nested: false, depth: 1 },
        { id: 'c', name: 'c', type: 'FRAME', nested: false, depth: 1 },
      ],
    };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.anatomy).toEqual([
      { part: 'a', type: 'FRAME', children: [{ part: 'b', type: 'FRAME' }, { part: 'c', type: 'FRAME' }] },
    ]);
  });

  it('gives a single childless part no children key', () => {
    const spec: IntermediateSpec = { ...SPEC, anatomy: [{ id: 'a', name: 'a', type: 'FRAME', nested: false, depth: 0 }] };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.anatomy).toEqual([{ part: 'a', type: 'FRAME' }]);
    expect('children' in y.anatomy[0]).toBe(false);
  });

  it('emits an empty list for an empty anatomy array', () => {
    const spec: IntermediateSpec = { ...SPEC, anatomy: [] };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.anatomy).toEqual([]);
  });
});
