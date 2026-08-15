import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { foundationBrief, componentBrief } from '../src/brief';
import type { ComponentBriefOptions } from '../src/brief';
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

  it('omits guidelines entirely when a stored ProseDrafts is truthy but every field is empty', () => {
    const y = brief({ prose: { definition: '', accessibility: '', dos: [], donts: [] } });
    expect('guidelines' in y).toBe(false);
  });

  it('treats an empty-string optional prose field as absent, not as a blank value', () => {
    const y = brief({
      prose: {
        definition: 'A button.',
        accessibility: 'Name it.',
        dos: ['Do'],
        donts: ['Do not'],
        interactions: '',
      },
    });
    expect(y.guidelines).toEqual({
      definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'],
    });
    expect(y.guidelines && 'interactions' in y.guidelines).toBe(false);
  });

  it('still emits every guideline field when all of them carry real content', () => {
    const y = brief({
      prose: {
        definition: 'A button.',
        accessibility: 'Name it.',
        dos: ['Do'],
        donts: ['Do not'],
        interactions: 'Press it.',
        variantsSummary: 'Style varies.',
        anatomySummary: 'One container.',
        designConsiderations: 'Keep contrast high.',
        contentConsiderations: 'Keep labels short.',
      },
    });
    expect(y.guidelines).toEqual({
      definition: 'A button.',
      accessibility: 'Name it.',
      dos: ['Do'],
      donts: ['Do not'],
      interactions: 'Press it.',
      variants_summary: 'Style varies.',
      anatomy_summary: 'One container.',
      design_considerations: 'Keep contrast high.',
      content_considerations: 'Keep labels short.',
    });
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

// ---------------------------------------------------------------------------
// componentBrief tokens
// ---------------------------------------------------------------------------

/** A resolved binding as it appears in the brief. Typed rather than `any` so
 *  a shape drift fails at compile time, matching the convention above. */
interface Binding {
  part: string;
  property: string;
  token: string;
  value?: string | number | boolean | Record<string, unknown>;
  code?: Record<string, string>;
}

interface VariantBindings {
  when: Record<string, string>;
  bindings: Binding[];
}

interface ParsedTokenBrief extends ParsedComponentBrief {
  tokens: { base: Binding[]; by_variant: VariantBindings[] };
}

const TOKEN_SPEC: IntermediateSpec = {
  ...SPEC,
  tokens: [
    // Unconditioned: applies to every variant, so it belongs in base.
    { part: 'container', property: 'border-radius', conditions: {}, token: 'radius/md' },
    // Conditioned per state: belongs in by_variant.
    { part: 'container', property: 'fill', conditions: { State: ['Enabled'] }, token: 'color/bg/brand' },
    { part: 'container', property: 'fill', conditions: { State: ['Hovered'] }, token: 'color/bg/brand-hover' },
  ],
};

const tokenBrief = (over: Partial<ComponentBriefOptions> = {}): ParsedTokenBrief =>
  load(toYaml(componentBrief(TOKEN_SPEC, { generatedAt: AT, ...over }))) as ParsedTokenBrief;

describe('componentBrief tokens', () => {
  it('factors bindings common to every variant into base', () => {
    expect(tokenBrief().tokens.base).toEqual([
      { part: 'container', property: 'border-radius', token: 'radius/md' },
    ]);
  });

  it('emits only the differing bindings per variant', () => {
    expect(tokenBrief().tokens.by_variant).toEqual([
      { when: { Style: 'Filled', State: 'Enabled' },
        bindings: [{ part: 'container', property: 'fill', token: 'color/bg/brand' }] },
      { when: { Style: 'Filled', State: 'Hovered' },
        bindings: [{ part: 'container', property: 'fill', token: 'color/bg/brand-hover' }] },
    ]);
  });

  it('never repeats a base binding inside by_variant', () => {
    const y = tokenBrief();
    for (const v of y.tokens.by_variant) {
      expect(v.bindings.some((b) => b.property === 'border-radius')).toBe(false);
    }
  });

  it('every `when` names a declared axis and a declared value', () => {
    const y = tokenBrief();
    const declared = new Map((y.axes ?? []).map((a) => [a.prop, a.values]));
    for (const v of y.tokens.by_variant) {
      for (const [axis, value] of Object.entries(v.when)) {
        expect(declared.has(axis)).toBe(true);
        expect(declared.get(axis)).toContain(value);
      }
    }
  });

  it('resolves token values through the foundation when one is supplied', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    const enabled = y.tokens.by_variant.find((v) => v.when.State === 'Enabled');
    // color/bg/brand resolves at the collection's default mode (Light).
    expect(enabled?.bindings[0].value).toBe('#2563EB');
  });

  it('omits value entirely when no foundation is supplied', () => {
    const y = tokenBrief();
    expect('value' in y.tokens.by_variant[0].bindings[0]).toBe(false);
  });

  it('emits code when the resolved variable has codeSyntax', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    const enabled = y.tokens.by_variant.find((v) => v.when.State === 'Enabled');
    expect(enabled?.bindings[0].code).toEqual({ WEB: '--color-bg-brand' });
  });

  it('emits an empty by_variant rather than omitting tokens when there are no variants', () => {
    const single: IntermediateSpec = { ...TOKEN_SPEC, variantInstances: [], variants: [] };
    const y = load(toYaml(componentBrief(single, { generatedAt: AT }))) as ParsedTokenBrief;
    expect(y.tokens.by_variant).toEqual([]);
    expect(y.tokens.base.length).toBe(3);
  });

  it('keeps a wide variant set small by factoring, not by truncating', () => {
    const axes = [
      { prop: 'Style', values: ['A', 'B', 'C', 'D'] },
      { prop: 'Size', values: ['S', 'M', 'L'] },
      { prop: 'State', values: ['Default', 'Hover', 'Disabled', 'Focus', 'Pressed'] },
    ];
    const instances: IntermediateSpec['variantInstances'] = [];
    for (const s of axes[0].values) {
      for (const z of axes[1].values) {
        for (const t of axes[2].values) {
          instances.push({ nodeId: `${s}${z}${t}`, name: `${s}/${z}/${t}`, values: { Style: s, Size: z, State: t } });
        }
      }
    }
    const wide: IntermediateSpec = {
      ...SPEC, variants: axes, variantInstances: instances,
      tokens: [
        { part: 'container', property: 'border-radius', conditions: {}, token: 'radius/md' },
        { part: 'label', property: 'typography', conditions: {}, token: 'type/label' },
        { part: 'container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/bg/hover' },
      ],
    };
    const y = load(toYaml(componentBrief(wide, { generatedAt: AT }))) as ParsedTokenBrief;
    expect(instances.length).toBe(60);
    // Every variant is still present: factoring must not drop any.
    expect(y.tokens.by_variant.length).toBe(60);
    expect(y.tokens.base.length).toBe(2);
    // The 12 Hover variants carry a binding; the other 48 carry none.
    expect(y.tokens.by_variant.filter((v) => v.bindings.length > 0).length).toBe(12);
  });

  it('collapses two distinct rules that resolve to the same binding on every variant, in base', () => {
    // Two TokenRule entries with different conditions can still resolve to the
    // identical (part, property, token) for a given variant -- tokens.ts notes
    // this happens for real when sibling subtrees share a cleaned part name.
    // Both rules below match every SPEC variant instance (both have Style=Filled;
    // one rule is unconditioned, the other only restates that same axis), so the
    // binding is common to every variant and must appear in base exactly once,
    // not twice.
    const spec: IntermediateSpec = {
      ...SPEC,
      tokens: [
        { part: 'container', property: 'fill', conditions: {}, token: 'color/bg/brand' },
        { part: 'container', property: 'fill', conditions: { Style: ['Filled'] }, token: 'color/bg/brand' },
      ],
    };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedTokenBrief;
    expect(y.tokens.base).toEqual([
      { part: 'container', property: 'fill', token: 'color/bg/brand' },
    ]);
    expect(y.tokens.by_variant).toEqual([
      { when: { Style: 'Filled', State: 'Enabled' }, bindings: [] },
      { when: { Style: 'Filled', State: 'Hovered' }, bindings: [] },
    ]);
  });

  it('collapses two distinct rules that resolve to the same binding on one variant, in by_variant', () => {
    // Same duplication shape as above, but both rules are conditioned on
    // State=Enabled, so the binding is NOT common to every variant (the
    // Hovered variant carries neither rule) and lands in by_variant instead.
    // The Enabled entry must still list the binding once, not twice.
    const spec: IntermediateSpec = {
      ...SPEC,
      tokens: [
        { part: 'container', property: 'fill', conditions: { State: ['Enabled'] }, token: 'color/bg/brand' },
        { part: 'container', property: 'fill', conditions: { Style: ['Filled'], State: ['Enabled'] }, token: 'color/bg/brand' },
      ],
    };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedTokenBrief;
    expect(y.tokens.base).toEqual([]);
    expect(y.tokens.by_variant).toEqual([
      { when: { Style: 'Filled', State: 'Enabled' },
        bindings: [{ part: 'container', property: 'fill', token: 'color/bg/brand' }] },
      { when: { Style: 'Filled', State: 'Hovered' }, bindings: [] },
    ]);
  });
});
