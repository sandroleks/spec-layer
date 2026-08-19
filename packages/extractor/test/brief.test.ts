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

/** Minimal FoundationSpec for the group-descriptions tests below: one
 *  single-mode collection holding one COLOR variable, just enough to exercise
 *  the guidelines block without dragging in FOUNDATION's second mode/alias
 *  machinery, which those tests have no use for. */
function oneCollection(): FoundationSpec {
  return {
    fileKey: 'FILE1', extractedAt: 'T', textStyles: [],
    collections: [{
      id: 'c1', name: 'Primitives', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Value' }],
      variables: [{
        name: 'color/surface/default', group: 'color', resolvedType: 'COLOR',
        description: '', codeSyntax: {},
        valuesByMode: { m1: { kind: 'color', hex: '#ffffff', alpha: 1 } },
      }],
    }],
  };
}

describe('foundationBrief', () => {
  it('stamps the envelope with the extractor version and brief version', () => {
    const b = foundationBrief(FOUNDATION, { generatedAt: AT }) as Record<string, Record<string, unknown>>;
    expect(b.spec_layer.kind).toBe('foundation');
    expect(b.spec_layer.version).toBe(1);
    expect(b.spec_layer.extractor).toBe('1');
  });

  it('keys mode values by mode name, not modeId', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, { generatedAt: AT }));
    expect(y.collections[0].tokens[0].values).toEqual({ Light: '#2563EB', Dark: '#3B82F6' });
  });

  it('emits code only when codeSyntax is populated', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, { generatedAt: AT }));
    expect(y.collections[0].tokens[0].code).toEqual({ WEB: '--color-bg-brand' });
    expect('code' in y.collections[0].tokens[1]).toBe(false);
  });

  it('gives an alias both its target and its resolved value', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, { generatedAt: AT }));
    expect((y.collections[0].tokens[1].values as Record<string, unknown>).Light)
      .toEqual({ alias: 'color/neutral/100', resolved: '#F5F5F5' });
  });

  it('states why an unresolved value is unresolved instead of dropping it', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, { generatedAt: AT }));
    expect((y.collections[0].tokens[1].values as Record<string, unknown>).Dark).toEqual({ unresolved: 'external' });
  });

  it('emits text styles', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, { generatedAt: AT }));
    expect(y.text_styles[0]).toEqual({
      name: 'Body/Regular',
      font: { family: 'Inter', style: 'Regular', size: 16 },
      line_height: { unit: 'PIXELS', value: 24 },
      letter_spacing: { unit: 'PERCENT', value: 0 },
    });
  });

  it('is deterministic', () => {
    expect(toYaml(foundationBrief(FOUNDATION, { generatedAt: AT }))).toBe(toYaml(foundationBrief(FOUNDATION, { generatedAt: AT })));
  });

  it('drops a value keyed by a mode no longer in collection.modes instead of leaking the raw modeId', () => {
    const stale: FoundationSpec = {
      ...FOUNDATION,
      collections: [{
        ...FOUNDATION.collections[0],
        variables: [{
          name: 'color/bg/brand', group: 'color', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: {
            m1: { kind: 'color', hex: '#2563EB', alpha: 1 },
            // 'm9' has no entry in collection.modes: its mode was deleted
            // after this value was recorded.
            m9: { kind: 'color', hex: '#000000', alpha: 1 },
          },
        }],
      }],
    };
    const y = parseBrief(foundationBrief(stale, { generatedAt: AT }));
    const values = y.collections[0].tokens[0].values as Record<string, unknown>;
    expect(values).toEqual({ Light: '#2563EB' });
    expect(Object.values(values)).not.toContain('m9');
    expect(JSON.stringify(y)).not.toContain('m9');
  });

  it('omits default_mode rather than emitting a raw modeId when the default mode was deleted', () => {
    const stale: FoundationSpec = {
      ...FOUNDATION,
      collections: [{ ...FOUNDATION.collections[0], defaultModeId: 'm9' }],
    };
    const y = parseBrief(foundationBrief(stale, { generatedAt: AT })) as unknown as
      { collections: Record<string, unknown>[] };
    expect('default_mode' in y.collections[0]).toBe(false);
    expect(JSON.stringify(y)).not.toContain('m9');
  });

  it('carries group descriptions nested under their collection', () => {
    const brief = foundationBrief(oneCollection(), {
      generatedAt: 'T',
      groupDescriptions: { Primitives: { 'color/surface': 'Surfaces you paint panels with.' } },
    }) as Record<string, any>;
    expect(brief.guidelines.origin).toBe('generated');
    expect(brief.guidelines.group_descriptions).toEqual({
      Primitives: { 'color/surface': 'Surfaces you paint panels with.' },
    });
  });

  it('nests by collection so two collections can share a folder name', () => {
    const brief = foundationBrief(oneCollection(), {
      generatedAt: 'T',
      groupDescriptions: { A: { color: 'From A.' }, B: { color: 'From B.' } },
    }) as Record<string, any>;
    expect(brief.guidelines.group_descriptions.A.color).toBe('From A.');
    expect(brief.guidelines.group_descriptions.B.color).toBe('From B.');
  });

  it('omits the guidelines block entirely when there are no descriptions', () => {
    const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as Record<string, any>;
    expect('guidelines' in brief).toBe(false);
  });

  it('omits the block when a description map is present but empty', () => {
    const brief = foundationBrief(oneCollection(), {
      generatedAt: 'T', groupDescriptions: { Primitives: {} },
    }) as Record<string, any>;
    expect('guidelines' in brief).toBe(false);
  });

  it('still emits collections and text styles unchanged', () => {
    const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.collections[0].name).toBe('Primitives');
    expect(brief.collections[0].tokens[0].name).toBe('color/surface/default');
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
  api?: {
    variants?: Record<string, { options: string[]; default?: string | boolean }>;
    states?: string[];
    booleans?: Record<string, { default?: string | boolean }>;
    slots?: Record<string, { type: string; default?: string | boolean; options?: string[] }>;
  };
  anatomy: AnatomyNode[];
  layout?: Array<{ part: string; summary: string }>;
  unbound?: Array<{ path: string; property: string; issue: string; value?: number | string }>;
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
    { id: 'p0', name: 'container', path: 'Container/container', type: 'FRAME', nested: false, depth: 0 },
    { id: 'p1', name: 'icon', path: 'Container/icon', type: 'INSTANCE', nested: true, depth: 1, component: 'Icon' },
    { id: 'p2', name: 'label', path: 'Container/label', type: 'TEXT', nested: false, depth: 1 },
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
  gaps: [{ part: 'container', path: 'Container/container', property: 'gap',
           issue: 'hardcoded-value', value: 8 }],
  layout: [{ part: 'container', summary: 'horizontal, gap 8' }],
  rawValues: [],
};

const brief = (over: Partial<Parameters<typeof componentBrief>[1]> = {}): ParsedComponentBrief =>
  load(toYaml(componentBrief(SPEC, { generatedAt: AT, ...over }))) as ParsedComponentBrief;

describe('componentBrief', () => {
  it('stamps a component envelope and the source identity', () => {
    const y = brief();
    expect(y.spec_layer.kind).toBe('component');
    expect(y.source).toEqual({ file: 'abc123', node: '1:100', component_key: 'm3-button' });
  });

  // Rewritten from the v1 flat-array `api` shape: SPEC's declared props are
  // 'label' (text), 'Style' (variant) and 'disabled' (boolean). 'disabled'
  // isn't a variant axis here (it's not in spec.variants), so it isn't a
  // state flag and lands in `booleans`; 'label' is a text prop, so it lands
  // in `slots` -- this is the concrete regression the coordinator flagged:
  // an earlier version of apiOf named 'text'/'instanceSwap' explicitly
  // rather than by exclusion, and silently dropped 'label' here.
  it('splits the API into variants, states, booleans and slots', () => {
    expect(brief().api).toEqual({
      variants: { Style: { options: ['Filled', 'Outlined'], default: 'Filled' } },
      states: ['Enabled', 'Hovered'],
      booleans: { disabled: { default: false } },
      slots: { label: { type: 'text', default: 'Button' } },
    });
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

  // Rewritten from the v1 test that also asserted on the now-removed
  // top-level `axes` and `states` blocks; that coverage moved to the API
  // split tests below.
  it('emits layout and related', () => {
    const y = brief();
    expect(y.layout).toEqual([{ part: 'container', summary: 'horizontal, gap 8' }]);
    expect(y.component).toEqual({ name: 'Button', related: ['Icon'] });
  });

  // ---------------------------------------------------------------------
  // api: variants / states / booleans
  // ---------------------------------------------------------------------

  it('separates configurable variants from interaction states', () => {
    const spec = {
      ...baseSpec(),
      variants: [
        { prop: 'type', values: ['Primary', 'Outline', 'Ghost'] },
        { prop: 'size', values: ['Large', 'Small'] },
        { prop: 'hover', values: ['False', 'True'] },
        { prop: 'disabled', values: ['False', 'True'] },
      ],
      props: [
        { name: 'type', kind: 'variant' as const,
          options: ['Primary', 'Outline', 'Ghost'], default: 'Primary' },
        { name: 'size', kind: 'variant' as const, options: ['Large', 'Small'], default: 'Large' },
        { name: 'hover', kind: 'variant' as const, options: ['False', 'True'], default: 'False' },
        { name: 'disabled', kind: 'variant' as const, options: ['False', 'True'], default: 'False' },
        { name: 'iconLeft', kind: 'boolean' as const, default: true },
      ],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(Object.keys(brief.api.variants)).toEqual(['type', 'size']);
    expect(brief.api.variants.type).toEqual(
      { options: ['Primary', 'Outline', 'Ghost'], default: 'Primary' });
    expect(brief.api.states).toContain('hover');
    expect(brief.api.states).toContain('disabled');
    expect(brief.api.states).not.toContain('Default');
    expect(brief.api.booleans).toEqual({ iconLeft: { default: true } });
  });

  it('no longer emits a top-level axes or states block', () => {
    const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as Record<string, any>;
    expect('axes' in brief).toBe(false);
    expect('states' in brief).toBe(false);
  });

  it('omits states when the component has none', () => {
    const spec = { ...baseSpec(), variants: [{ prop: 'size', values: ['Large', 'Small'] }],
      props: [{ name: 'size', kind: 'variant' as const,
                options: ['Large', 'Small'], default: 'Large' }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect('states' in brief.api).toBe(false);
    expect(Object.keys(brief.api.variants)).toEqual(['size']);
  });

  it('omits the whole api block for a component with no props', () => {
    const spec = { ...baseSpec(), variants: [], props: [] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect('api' in brief).toBe(false);
  });

  // The correctness question this task is really about: a boolean prop whose
  // name is itself a state word (STATE_ORDER in statesMatrix.ts includes
  // 'disabled') is picked up by detectStateMatrix's flags path when it is a
  // variant axis. It must land in `states` exactly once, never in `booleans`
  // and never in `variants` -- no drop, no double count.
  it('never double-counts or drops a boolean prop whose name is a state word', () => {
    const spec = {
      ...baseSpec(),
      variants: [
        { prop: 'size', values: ['Large', 'Small'] },
        { prop: 'disabled', values: ['False', 'True'] },
      ],
      props: [
        { name: 'size', kind: 'variant' as const, options: ['Large', 'Small'], default: 'Large' },
        { name: 'disabled', kind: 'boolean' as const, default: false },
      ],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(Object.keys(brief.api.variants)).toEqual(['size']);
    expect(brief.api.states).toEqual(['disabled']);
    expect('booleans' in brief.api).toBe(false);
  });

  // Review caught that the 'Default' filter below was written for the
  // flags encoding (where detectStateMatrix SYNTHESIZES a 'Default' baseline
  // column that isn't a real state) but applied unconditionally, so it also
  // stripped a real, Figma-declared 'Default' value under the enum encoding
  // -- chip.json's States axis genuinely declares 'Default' alongside
  // 'Hover'/'Focus'/'Press'. This pins both behaviours so neither regresses:
  // the synthetic flags-path 'Default' stays dropped (already asserted by
  // 'separates configurable variants from interaction states' above, via
  // `expect(brief.api.states).not.toContain('Default')`), while a real
  // enum-declared 'Default' survives.
  it('keeps a real Default value under the enum encoding', () => {
    const spec = { ...baseSpec(),
      variants: [{ prop: 'States', values: ['Default', 'Hovered', 'Pressed'] }],
      props: [{ name: 'States', kind: 'variant' as const,
                options: ['Default', 'Hovered', 'Pressed'], default: 'Default' }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.api.states).toEqual(['Default', 'Hovered', 'Pressed']);
  });

  // A fourth group, added after review caught that `apiOf` originally
  // covered only variant and boolean kinds: a `text` prop (a component's
  // label slot) and an `instanceSwap` prop (its icon slot) fell through
  // entirely, dropping both fixtures' `Label` prop from the brief.

  it('puts a text prop in slots, carrying its kind and default', () => {
    const spec = { ...baseSpec(), variants: [],
      props: [{ name: 'Label', kind: 'text' as const, default: 'Button' }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.api.slots).toEqual({ Label: { type: 'text', default: 'Button' } });
  });

  it('puts an instanceSwap prop in slots', () => {
    const spec = { ...baseSpec(), variants: [],
      props: [{ name: 'icon', kind: 'instanceSwap' as const }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(Object.keys(brief.api.slots)).toEqual(['icon']);
    expect(brief.api.slots.icon.type).toBe('instanceSwap');
  });

  it('omits slots when the component has no such props', () => {
    const spec = { ...baseSpec(), variants: [{ prop: 'size', values: ['Large', 'Small'] }],
      props: [{ name: 'size', kind: 'variant' as const,
                options: ['Large', 'Small'], default: 'Large' }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect('slots' in brief.api).toBe(false);
  });

  // The assertion that would have caught the dropped `Label` prop in the
  // first place: every declared prop and every variant axis must be claimed
  // by exactly one of the four groups -- not zero (dropped), not two or more
  // (double-counted).
  it('accounts for every prop and variant axis in exactly one group', () => {
    const spec = {
      ...baseSpec(),
      variants: [
        { prop: 'type', values: ['Primary', 'Outline', 'Ghost'] },
        { prop: 'size', values: ['Large', 'Small'] },
        { prop: 'hover', values: ['False', 'True'] },
        { prop: 'disabled', values: ['False', 'True'] },
      ],
      props: [
        { name: 'type', kind: 'variant' as const,
          options: ['Primary', 'Outline', 'Ghost'], default: 'Primary' },
        { name: 'size', kind: 'variant' as const, options: ['Large', 'Small'], default: 'Large' },
        { name: 'hover', kind: 'variant' as const, options: ['False', 'True'], default: 'False' },
        { name: 'disabled', kind: 'variant' as const, options: ['False', 'True'], default: 'False' },
        { name: 'iconLeft', kind: 'boolean' as const, default: true },
        { name: 'Label', kind: 'text' as const, default: 'Button' },
        { name: 'icon', kind: 'instanceSwap' as const },
      ],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;

    const expectedNames = new Set<string>([
      ...spec.variants.map((v) => v.prop),
      ...spec.props.map((p) => p.name),
    ]);

    const groups: Record<string, Set<string>> = {
      variants: new Set(Object.keys(brief.api.variants ?? {})),
      states: new Set(brief.api.states ?? []),
      booleans: new Set(Object.keys(brief.api.booleans ?? {})),
      slots: new Set(Object.keys(brief.api.slots ?? {})),
    };

    // Nothing dropped: every declared prop and every variant axis is
    // claimed by at least one group.
    const claimed = new Set<string>();
    for (const set of Object.values(groups)) for (const name of set) claimed.add(name);
    expect([...claimed].sort()).toEqual([...expectedNames].sort());

    // Nothing double-counted: exactly one group claims each name.
    for (const name of expectedNames) {
      const memberships = Object.entries(groups)
        .filter(([, set]) => set.has(name)).map(([g]) => g);
      expect(memberships).toHaveLength(1);
    }

    // Spot-check which group each landed in, so a future change to the
    // grouping rules fails here with a clear diff, not only in the generic
    // claimed/double-count assertions above.
    expect(groups.variants).toEqual(new Set(['type', 'size']));
    expect(groups.states).toEqual(new Set(['hover', 'disabled']));
    expect(groups.booleans).toEqual(new Set(['iconLeft']));
    expect(groups.slots).toEqual(new Set(['Label', 'icon']));
  });

  it('emits gaps as unbound', () => {
    expect(brief().unbound).toEqual([
      { path: 'Container/container', property: 'gap', issue: 'hardcoded-value', value: 8 },
    ]);
  });

  it('drops an unbound entry whose path and property are already bound', () => {
    const spec = {
      ...baseSpec(),
      tokens: [{ part: 'Label', path: 'Container/Label', property: 'fill',
                 conditions: {}, token: 'color/text/default' }],
      gaps: [
        { part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' as const },
        { part: 'Label', path: 'Container/Label', property: 'gap',
          issue: 'hardcoded-value' as const, value: 8 },
      ],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    // The fill gap contradicted a real binding, so it goes. The spacing gap stays.
    expect(brief.unbound).toEqual([
      { path: 'Container/Label', property: 'gap', issue: 'hardcoded-value', value: 8 },
    ]);
  });

  it('omits unbound entirely when every gap was contradicted', () => {
    const spec = {
      ...baseSpec(),
      tokens: [{ part: 'Label', path: 'Container/Label', property: 'fill',
                 conditions: {}, token: 'color/text/default' }],
      gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill',
               issue: 'hardcoded-color' as const }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect('unbound' in brief).toBe(false);
  });

  // The reconciliation is a deletion, so a match that is too loose silently
  // destroys a real finding. Both halves of the join key must agree: matching
  // on property alone (ignoring the path) or on path alone (ignoring the
  // property) would both wrongly drop a gap here.
  it('keeps a gap whose property is bound, but only on a different path', () => {
    const spec = {
      ...baseSpec(),
      tokens: [{ part: 'Icon', path: 'Container/icon', property: 'fill',
                 conditions: {}, token: 'color/icon/default' }],
      gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' as const }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.unbound).toEqual([
      { path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' },
    ]);
  });

  // Same path, but the token covers a different property (padding, not fill):
  // must not be mistaken for coverage of the fill gap.
  it('keeps a gap on one property when the same path is bound only on another property', () => {
    const spec = {
      ...baseSpec(),
      tokens: [{ part: 'Label', path: 'Container/Label', property: 'padding',
                 conditions: {}, token: 'space/md' }],
      gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' as const }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.unbound).toEqual([
      { path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' },
    ]);
  });

  // extractGaps emits property 'gap' for a hardcoded itemSpacing (not
  // 'itemSpacing'): that is the exact name a real itemSpacing binding
  // normalizes to via SIMPLE_PROPERTY_MAP in tokens.ts. This is the
  // regression this task's Fix 1 closes: a hardcoded spacing value on a part
  // that also carries a real `gap` token binding (bound in a different
  // variant than the one gap-detection walked) must now reconcile away,
  // exactly like the ButtonLabel colour case that motivated this task.
  it('drops a hardcoded itemSpacing gap when the same path has a real gap token binding', () => {
    const spec = {
      ...baseSpec(),
      tokens: [{ part: 'container', path: 'Container/container', property: 'gap',
                 conditions: {}, token: 'space/md' }],
      gaps: [{ part: 'container', path: 'Container/container', property: 'gap',
               issue: 'hardcoded-value' as const, value: 8 }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect('unbound' in brief).toBe(false);
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
        { id: 'a', name: 'a', path: 'Container/a', type: 'FRAME', nested: false, depth: 0 },
        { id: 'b', name: 'b', path: 'Container/b', type: 'FRAME', nested: false, depth: 1 },
        { id: 'c', name: 'c', path: 'Container/c', type: 'FRAME', nested: false, depth: 2 },
        { id: 'd', name: 'd', path: 'Container/d', type: 'FRAME', nested: false, depth: 0 },
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
        { id: 'a', name: 'a', path: 'Container/a', type: 'FRAME', nested: false, depth: 2 },
        { id: 'b', name: 'b', path: 'Container/b', type: 'FRAME', nested: false, depth: 3 },
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
        { id: 'a', name: 'a', path: 'Container/a', type: 'FRAME', nested: false, depth: 0 },
        { id: 'b', name: 'b', path: 'Container/b', type: 'FRAME', nested: false, depth: 1 },
        { id: 'c', name: 'c', path: 'Container/c', type: 'FRAME', nested: false, depth: 1 },
      ],
    };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.anatomy).toEqual([
      { part: 'a', type: 'FRAME', children: [{ part: 'b', type: 'FRAME' }, { part: 'c', type: 'FRAME' }] },
    ]);
  });

  it('gives a single childless part no children key', () => {
    const spec: IntermediateSpec = { ...SPEC, anatomy: [{ id: 'a', name: 'a', path: 'Container/a', type: 'FRAME', nested: false, depth: 0 }] };
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

/** A token's resolved definition as emitted under `tokens.used`. Mirrors
 *  `lookupToken`'s return shape; Task 8 adds `mode` to that same shape.
 *  Typed rather than `any` so a shape drift fails at compile time, matching
 *  the convention above. */
interface TokenDefinition {
  value?: string | number | boolean | Record<string, unknown>;
  code?: Record<string, string>;
}

/** A binding as it appears in the brief: identity plus the minimal condition
 *  it holds under, if any. `when` is a lookup from axis name to the values
 *  the binding holds for, not a boolean expression -- an absent `when` means
 *  every variant. Typed rather than `any` so a shape drift fails at compile
 *  time, matching the convention above. */
interface Binding {
  path: string;
  property: string;
  token: string;
  when?: Record<string, string[]>;
}

interface ParsedTokenBrief extends ParsedComponentBrief {
  tokens: { used: Record<string, TokenDefinition>; bindings: Binding[] };
}

/** An IntermediateSpec with no tokens of its own, for tests that only care
 *  about the tokens block: callers spread this and override `tokens`. */
function baseSpec(): IntermediateSpec {
  return { ...SPEC, tokens: [] };
}

const TOKEN_SPEC: IntermediateSpec = {
  ...SPEC,
  tokens: [
    // Unconditioned: holds in every variant, so its binding has no `when`.
    { part: 'container', path: 'Container/container', property: 'border-radius', conditions: {}, token: 'radius/md' },
    // Conditioned per state: its binding carries a `when`.
    { part: 'container', path: 'Container/container', property: 'fill', conditions: { State: ['Enabled'] }, token: 'color/bg/brand' },
    { part: 'container', path: 'Container/container', property: 'fill', conditions: { State: ['Hovered'] }, token: 'color/bg/brand-hover' },
  ],
};

const tokenBrief = (over: Partial<ComponentBriefOptions> = {}): ParsedTokenBrief =>
  load(toYaml(componentBrief(TOKEN_SPEC, { generatedAt: AT, ...over }))) as ParsedTokenBrief;

describe('componentBrief tokens', () => {
  // -- from the task brief, Step 1 --------------------------------------

  it('lists each token once under used, in first-use order', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { type: ['Primary'] }, token: 'color/surface/primary/default' },
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { type: ['Outline'] }, token: 'color/surface/primary/default' },
      { part: 'Container', path: 'Container', property: 'height',
        conditions: { size: ['Large'] }, token: 'button/lg-height' },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(Object.keys(brief.tokens.used)).toEqual([
      'color/surface/primary/default', 'button/lg-height',
    ]);
  });

  it('emits one binding per rule, carrying only the axes it depends on', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'height',
        conditions: { size: ['Large'] }, token: 'button/lg-height' },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.tokens.bindings).toEqual([
      { path: 'Container', property: 'height', token: 'button/lg-height',
        when: { size: ['Large'] } },
    ]);
  });

  it('omits when entirely for a binding that holds in every variant', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'border-radius',
        conditions: {}, token: 'rd-sm' },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.tokens.bindings[0]).toEqual(
      { path: 'Container', property: 'border-radius', token: 'rd-sm' });
    expect('when' in brief.tokens.bindings[0]).toBe(false);
  });

  it('no longer emits base or by_variant', () => {
    const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as Record<string, any>;
    expect('base' in brief.tokens).toBe(false);
    expect('by_variant' in brief.tokens).toBe(false);
  });

  it('dedupes rules identical in path, property, token and conditions', () => {
    // tokens.ts documents that a part name is unique only among siblings, so
    // two nodes in different subtrees can minimize into identical rules.
    // Paths make most of those distinct, but a genuine duplicate must still
    // collapse to one.
    const rule = { part: 'Label', path: 'Container/Label', property: 'fill',
                   conditions: { type: ['Primary'] }, token: 'color/text/default' };
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [rule, { ...rule }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.tokens.bindings).toHaveLength(1);
  });

  it('keeps two rules that differ only in conditions', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { size: ['Large'] }, token: 'a' },
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { size: ['Small'] }, token: 'a' },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
    expect(brief.tokens.bindings).toHaveLength(2);
  });

  // -- rewritten from the v1 base/by_variant shape ----------------------
  //
  // Each test below covered a real case under v1 and is rewritten, not
  // deleted, so that coverage isn't silently dropped:
  //   - 'factors bindings common to every variant into base' and 'never
  //     repeats a base binding inside by_variant' -> a universal binding now
  //     surfaces as one entry in `bindings` with no `when` at all (there is
  //     no separate list for it to also appear in).
  //   - 'emits only the differing bindings per variant' -> a
  //     variant-conditioned binding now surfaces as one entry in `bindings`
  //     carrying a `when` naming the axis it depends on.
  //   - the two 'collapses two distinct rules that resolve to the same
  //     binding' cases relied on v1 intersecting RESOLVED bindings across
  //     variants, which let two rules with different (but overlapping)
  //     conditions collapse into one. `ruleKey` deliberately does not do
  //     this -- two rules differing only in conditions are two real rules --
  //     so that exact collapse no longer happens; the underlying case (a
  //     genuine duplicate rule must still collapse to one binding, and two
  //     merely similar rules must not) is what the Step 1 tests
  //     'dedupes rules identical in path, property, token and conditions'
  //     and 'keeps two rules that differ only in conditions' cover instead.
  //   - 'emits an empty by_variant rather than omitting tokens when there are
  //     no variants' and 'keeps a wide variant set small by factoring, not by
  //     truncating' -> the new projection reads `conditions` directly and
  //     never looks at `variantInstances`, so both become one case: bindings
  //     are emitted per RULE regardless of how many variant instances exist.

  it('emits a binding with no `when` for a rule that holds in every variant', () => {
    const y = tokenBrief();
    const universal = y.tokens.bindings.find((b) => b.property === 'border-radius');
    expect(universal).toEqual({ path: 'Container/container', property: 'border-radius', token: 'radius/md' });
    expect(universal && 'when' in universal).toBe(false);
  });

  it('emits a binding with `when` naming the axis a variant-conditioned rule depends on', () => {
    const y = tokenBrief();
    expect(y.tokens.bindings).toContainEqual({
      path: 'Container/container', property: 'fill', token: 'color/bg/brand',
      when: { State: ['Enabled'] },
    });
    expect(y.tokens.bindings).toContainEqual({
      path: 'Container/container', property: 'fill', token: 'color/bg/brand-hover',
      when: { State: ['Hovered'] },
    });
  });

  // Rewritten from the v1 test that read the now-removed top-level `axes`
  // block: the ground truth for "what axes exist" is the source spec, not
  // the brief projection (which now splits variant axes across
  // `api.variants` and `api.states` rather than listing them verbatim).
  it('every `when` names an axis declared on the component and only declared values', () => {
    const y = tokenBrief();
    const declared = new Map(TOKEN_SPEC.variants.map((a) => [a.prop, a.values]));
    for (const b of y.tokens.bindings) {
      if (!b.when) continue;
      for (const [axis, values] of Object.entries(b.when)) {
        expect(declared.has(axis)).toBe(true);
        for (const v of values) expect(declared.get(axis)).toContain(v);
      }
    }
  });

  it('resolves token values through the foundation when one is supplied', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    // color/bg/brand resolves at the collection's default mode (Light).
    expect(y.tokens.used['color/bg/brand'].value).toBe('#2563EB');
  });

  it('omits value entirely when no foundation is supplied', () => {
    const y = tokenBrief();
    expect('value' in y.tokens.used['color/bg/brand']).toBe(false);
  });

  it('emits code when the resolved variable has codeSyntax', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    expect(y.tokens.used['color/bg/brand'].code).toEqual({ WEB: '--color-bg-brand' });
  });

  it('emits the same bindings whether or not there are variant instances', () => {
    const single: IntermediateSpec = { ...TOKEN_SPEC, variantInstances: [], variants: [] };
    const y = load(toYaml(componentBrief(single, { generatedAt: AT }))) as ParsedTokenBrief;
    expect(y.tokens.bindings).toHaveLength(3);
  });

  it('keeps a wide variant set small by emitting rules, never the variant matrix', () => {
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
        { part: 'container', path: 'Container/container', property: 'border-radius', conditions: {}, token: 'radius/md' },
        { part: 'label', path: 'Container/label', property: 'typography', conditions: {}, token: 'type/label' },
        { part: 'container', path: 'Container/container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/bg/hover' },
      ],
    };
    const y = load(toYaml(componentBrief(wide, { generatedAt: AT }))) as ParsedTokenBrief;
    expect(instances.length).toBe(60);
    // Three rules produce three bindings, no matter how many variant
    // instances they'd have resolved against under v1.
    expect(y.tokens.bindings).toHaveLength(3);
  });
});
