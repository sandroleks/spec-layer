import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { componentBrief } from '../src/brief';
import type { ComponentBriefOptions } from '../src/brief';
import { toYaml } from '../src/yaml';
import type { IntermediateSpec } from '../src/extract';
import type { RefIdentity } from '../src/tree';
import type { TokenRule } from '../src/tokens';

/** A TokenRule now carries the full identity Figma stated for the reference.
 *  These tests are about what the brief EMITS, so one identity is minted per
 *  token NAME -- which is what a name meant before the identity fields existed.
 *  The brief's own emitted key stays `token`; only the rule's field is `name`. */
const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });

/** Same idea as `ident`, but for a text style / effect style binding. A
 *  typography or effects rule names a STYLE, not a variable, and the new
 *  resolution vocabulary selects on `kind` -- so a token modelled with
 *  `kind: 'variable'` here would silently miss `typographyOf`/`effectsOf`'s
 *  name filters. */
const identStyle = (name: string, kind: 'text-style' | 'effect-style'): RefIdentity => (
  { id: `S:${name}`, name, kind, remote: false });

const AT = '2026-08-14T10:22:00.000Z';

/**
 * Structural shape of the raw (pre-YAML) object componentBrief returns,
 * covering just the blocks the tests below read directly off that object --
 * before it round-trips through YAML, so a test can still tell a
 * genuinely-absent key from a present-but-undefined one via `'x' in obj`.
 * A field a test only passes whole into `expect(...)` or checks with `in`
 * stays optional; a field a test dereferences further is typed as present.
 */
/** One `tokens.used` entry now that `used` is a list, not a map keyed by
 *  name: every entry carries `token` and `kind` (the join identity), and a
 *  `resolution` when it is not a pointer to a definition the brief carries. */
interface UsedEntry {
  token: string;
  kind: string;
  resolution?: { status: string; reason: string };
}

/** Find one `used` entry by (token, kind) -- the join identity `usedKey` in
 *  brief.ts mints, since a plain name lookup can no longer be unambiguous
 *  once a variable and a style can share one. */
function usedEntry(used: UsedEntry[], token: string, kind = 'variable'): UsedEntry | undefined {
  return used.find((u) => u.token === token && u.kind === kind);
}

interface BriefShape {
  source: {
    file_key?: string; file_name?: string;
    node_id: string; node_name: string; component_key?: string;
  };
  component?: { name: string; description?: string; related?: string[] };
  api: {
    variants: Record<string, { options: string[]; default?: string | boolean }>;
    states?: string[];
    booleans?: Record<string, { default?: string | boolean }>;
    slots: Record<string, { type: string; default?: string | boolean; options?: string[] }>;
  };
  anatomy?: unknown[];
  layout?: Array<{ path: string; summary: string }>;
  tokens: {
    used: UsedEntry[];
    bindings: Array<{
      path: string; property: string; token: string; kind: string;
      when?: Record<string, string[]>;
    }>;
  };
  unbound?: Array<{ path: string; property: string; issue: string; value?: number | string }>;
  validation?: Array<{
    id: string; severity: string; path?: string; property?: string;
    message: string; when?: Record<string, string[]>;
  }>;
  typography?: Record<string, { resolution?: { status: string; reason: string } }>;
  effects?: Record<string, { resolution?: { status: string; reason: string } }>;
  effects_inline?: Array<{ path: string; layers: unknown[] }>;
}

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
  shown_by?: string;
  children?: AnatomyNode[];
}
interface ParsedComponentBrief {
  spec_layer: { kind: string; version: number; extractor: string; generated: string };
  source: { file_key?: string; file_name?: string;
            node_id: string; node_name: string; component_key?: string };
  component: { name: string; related?: string[] };
  api?: {
    variants?: Record<string, { options: string[]; default?: string | boolean }>;
    states?: string[];
    booleans?: Record<string, { default?: string | boolean }>;
    slots?: Record<string, { type: string; default?: string | boolean; options?: string[] }>;
  };
  anatomy: AnatomyNode[];
  layout?: Array<{ path: string; summary: string }>;
  unbound?: Array<{ path: string; property: string; issue: string; value?: number | string }>;
  guidelines?: {
    origin?: string;
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
  description: '', documentationLinks: [],
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
  layout: [{ part: 'container', path: 'Container/container',
             summary: 'horizontal, gap 8', values: { gap: 8 } }],
  rawValues: [],
  nodeEffects: [],
};

const brief = (over: Partial<Parameters<typeof componentBrief>[1]> = {}): ParsedComponentBrief =>
  load(toYaml(componentBrief(SPEC, { generatedAt: AT, ...over }))) as ParsedComponentBrief;

describe('componentBrief', () => {
  it('is the only brief: the foundation brief is gone (review 2026-09-23)', async () => {
    const extractor = await import('../src/index');
    expect('foundationBrief' in extractor).toBe(false);
  });

  it('takes no foundation: a brief never resolves against a snapshot', () => {
    // Type-level. Component Context v5 resolves references itself; the brief's
    // own lookup matched tokens by name across every collection and never
    // ran outside the tests.
    // @ts-expect-error `foundation` is not a ComponentBriefOptions key
    const opts: ComponentBriefOptions = { generatedAt: 'T', foundation: undefined };
    void opts;
  });

  it('stamps a component envelope and the source identity', () => {
    const y = brief();
    expect(y.spec_layer.kind).toBe('component');
    expect(y.source).toEqual(
      { file_key: 'abc123', node_id: '1:100', node_name: 'Button', component_key: 'm3-button' });
  });

  it('carries the component description under component when one exists', () => {
    const described: IntermediateSpec = { ...baseSpec(), description: 'Primary action.' };
    const withDescription = componentBrief(described, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(withDescription.component?.description).toBe('Primary action.');
    const plain = componentBrief(baseSpec(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('description' in (plain.component ?? {})).toBe(false);
  });

  // The pre-YAML object, not the parsed brief: only here can a test tell an
  // absent key apart from one present with an undefined value.
  it('splits source into file key, file name, node id, node name and component key', () => {
    const spec: IntermediateSpec = { ...baseSpec(), figmaFile: 'KEY1', figmaFileName: 'Design System' };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.source).toEqual({
      file_key: 'KEY1', file_name: 'Design System',
      node_id: '1:100', node_name: 'Button', component_key: 'm3-button',
    });
  });

  it('omits an unavailable file key rather than emitting the string unknown', () => {
    const spec: IntermediateSpec = { ...baseSpec(), figmaFile: 'unknown' };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect('file_key' in brief.source).toBe(false);
    expect('file_name' in brief.source).toBe(false);
    expect(brief.source.node_id).toBe('1:100');
  });

  it('omits an empty file key and an empty file name', () => {
    const spec: IntermediateSpec = { ...baseSpec(), figmaFile: '', figmaFileName: '' };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect('file_key' in brief.source).toBe(false);
    expect('file_name' in brief.source).toBe(false);
  });

  // Dropping file_key shortens the block enough for the emitter to render it
  // in flow style, where `node_id: 1:100` is an unquoted scalar carrying a
  // colon. Round-trip it to prove that still parses.
  it('emits a parseable source block when the file key is dropped', () => {
    const spec: IntermediateSpec = { ...baseSpec(), figmaFile: 'unknown' };
    const y = load(toYaml(componentBrief(spec, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.source).toEqual({ node_id: '1:100', node_name: 'Button', component_key: 'm3-button' });
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

  it('marks a part hidden by default with the property that shows it, and only that part', () => {
    const hidden: IntermediateSpec = {
      ...SPEC,
      anatomy: [
        { id: 'p0', name: 'container', path: 'Container/container', type: 'FRAME', nested: false, depth: 0 },
        {
          id: 'p3', name: 'icon left', path: 'Container/container/icon left', type: 'FRAME',
          nested: false, depth: 1, hiddenByDefault: true, shownBy: 'Icon left',
        },
        { id: 'p2', name: 'label', path: 'Container/container/label', type: 'TEXT', nested: false, depth: 1 },
      ],
    };
    const y = load(toYaml(componentBrief(hidden, { generatedAt: AT }))) as ParsedComponentBrief;
    expect(y.anatomy).toEqual([{
      part: 'container', type: 'FRAME',
      children: [
        { part: 'icon left', type: 'FRAME', shown_by: 'Icon left' },
        { part: 'label', type: 'TEXT' },
      ],
    }]);
  });

  it('leaves a token rule for a hidden part out, but stops calling its binding a gap', () => {
    const ref = {
      id: 'VariableID:9', kind: 'variable' as const, remote: false,
      collectionId: 'VariableCollectionId:1',
    };
    const hidden: IntermediateSpec = {
      ...SPEC,
      tokens: [
        { part: 'label', path: 'Container/label', property: 'fill', conditions: {},
          name: 'Role/Text/Default', ...ref },
        { part: 'icon left', path: 'Container/icon left', property: 'fill', conditions: {},
          name: 'Role/Text/Accent', ...ref, shownBy: 'Icon left' },
      ],
      gaps: [
        // The gap extraction reaches hidden subtrees, so it reports this path
        // even though the rule above proves the fill IS bound.
        { part: 'icon left', path: 'Container/icon left', property: 'fill',
          issue: 'missing-token-binding' },
      ],
    };
    const yaml = toYaml(componentBrief(hidden, { generatedAt: AT }));
    // Emitted rules are filtered: this contract has no field in which to say a
    // rule only applies once "Icon left" is true, and a rule that omitted the
    // condition would read as unconditional.
    expect(yaml).toContain('Role/Text/Default');
    expect(yaml).not.toContain('Role/Text/Accent');
    // The gap join still sees the unfiltered rules, so the brief no longer
    // claims a bound property has no token binding.
    const parsed = load(yaml) as ParsedComponentBrief;
    expect(parsed.unbound ?? []).toEqual([]);
  });

  // Rewritten from the v1 test that also asserted on the now-removed
  // top-level `axes` and `states` blocks; that coverage moved to the API
  // split tests below.
  it('emits layout and related', () => {
    const y = brief();
    // `path`, not `part`: this is the identity bindings, unbound and validation
    // all use, so a reader can join a layout row to the node it describes.
    expect(y.layout).toEqual([{ path: 'Container/container', summary: 'horizontal, gap 8' }]);
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
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(Object.keys(brief.api.variants)).toEqual(['type', 'size']);
    expect(brief.api.variants.type).toEqual(
      { options: ['Primary', 'Outline', 'Ghost'], default: 'Primary' });
    expect(brief.api.states).toContain('hover');
    expect(brief.api.states).toContain('disabled');
    expect(brief.api.states).not.toContain('Default');
    expect(brief.api.booleans).toEqual({ iconLeft: { default: true } });
  });

  it('no longer emits a top-level axes or states block', () => {
    const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('axes' in brief).toBe(false);
    expect('states' in brief).toBe(false);
  });

  it('omits states when the component has none', () => {
    const spec = { ...baseSpec(), variants: [{ prop: 'size', values: ['Large', 'Small'] }],
      props: [{ name: 'size', kind: 'variant' as const,
                options: ['Large', 'Small'], default: 'Large' }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect('states' in brief.api).toBe(false);
    expect(Object.keys(brief.api.variants)).toEqual(['size']);
  });

  it('omits the whole api block for a component with no props', () => {
    const spec = { ...baseSpec(), variants: [], props: [] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
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
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
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
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.api.states).toEqual(['Default', 'Hovered', 'Pressed']);
  });

  // A fourth group, added after review caught that `apiOf` originally
  // covered only variant and boolean kinds: a `text` prop (a component's
  // label slot) and an `instanceSwap` prop (its icon slot) fell through
  // entirely, dropping both fixtures' `Label` prop from the brief.

  it('puts a text prop in slots, carrying its kind and default', () => {
    const spec = { ...baseSpec(), variants: [],
      props: [{ name: 'Label', kind: 'text' as const, default: 'Button' }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.api.slots).toEqual({ Label: { type: 'text', default: 'Button' } });
  });

  it('puts an instanceSwap prop in slots', () => {
    const spec = { ...baseSpec(), variants: [],
      props: [{ name: 'icon', kind: 'instanceSwap' as const }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(Object.keys(brief.api.slots)).toEqual(['icon']);
    expect(brief.api.slots.icon.type).toBe('instanceSwap');
  });

  it('omits slots when the component has no such props', () => {
    const spec = { ...baseSpec(), variants: [{ prop: 'size', values: ['Large', 'Small'] }],
      props: [{ name: 'size', kind: 'variant' as const,
                options: ['Large', 'Small'], default: 'Large' }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
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
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;

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
                 conditions: {}, ...ident('color/text/default') }],
      gaps: [
        { part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' as const },
        { part: 'Label', path: 'Container/Label', property: 'gap',
          issue: 'hardcoded-value' as const, value: 8 },
      ],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    // The fill gap contradicted a real binding, so it goes. The spacing gap stays.
    expect(brief.unbound).toEqual([
      { path: 'Container/Label', property: 'gap', issue: 'hardcoded-value', value: 8 },
    ]);
  });

  it('omits unbound entirely when every gap was contradicted', () => {
    const spec = {
      ...baseSpec(),
      tokens: [{ part: 'Label', path: 'Container/Label', property: 'fill',
                 conditions: {}, ...ident('color/text/default') }],
      gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill',
               issue: 'hardcoded-color' as const }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
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
                 conditions: {}, ...ident('color/icon/default') }],
      gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' as const }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
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
                 conditions: {}, ...ident('space/md') }],
      gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' as const }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
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
                 conditions: {}, ...ident('space/md') }],
      gaps: [{ part: 'container', path: 'Container/container', property: 'gap',
               issue: 'hardcoded-value' as const, value: 8 }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect('unbound' in brief).toBe(false);
  });

  it('includes stored guidelines verbatim', () => {
    const y = brief({ prose: { definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'] } });
    expect(y.guidelines).toEqual({
      origin: 'generated',
      definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'],
    });
  });

  describe('authored guidelines', () => {
    const prose = {
      definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'],
      interactions: 'Press it.',
    };
    const rawGuidelines = (p: Parameters<typeof componentBrief>[1]['prose']) =>
      (componentBrief(SPEC, { generatedAt: AT, prose: p }) as Record<string, unknown>).guidelines as Record<string, unknown>;
    /** The keys the emitter writes: an undefined-valued key is dropped. */
    const keysOf = (g: Record<string, unknown>) => Object.keys(g).filter((k) => g[k] !== undefined);

    it('is byte-identical to a brief with no authored data when the list is empty', () => {
      const plain = toYaml(componentBrief(SPEC, { generatedAt: AT, prose }));
      expect(toYaml(componentBrief(SPEC, { generatedAt: AT, prose: { ...prose, authored: [] } }))).toBe(plain);
      expect(keysOf(rawGuidelines({ ...prose, authored: [] }))).toEqual(
        ['origin', 'definition', 'accessibility', 'interactions', 'dos', 'donts'],
      );
    });

    it('lists the fields a person wrote after origin: generated, in the block field order', () => {
      const g = rawGuidelines({ ...prose, authored: ['donts', 'interactions', 'content_considerations'] });
      expect(keysOf(g)).toEqual(['origin', 'authored', 'definition', 'accessibility', 'interactions', 'dos', 'donts']);
      expect(g.origin).toBe('generated');
      // content_considerations is not present, so it is not listed.
      expect(g.authored).toEqual(['interactions', 'donts']);
    });

    it('reads origin: authored with no list when a person wrote every present field', () => {
      const g = rawGuidelines({
        ...prose, authored: ['definition', 'accessibility', 'interactions', 'dos', 'donts', 'anatomy_summary'],
      });
      expect(g.origin).toBe('authored');
      expect('authored' in g).toBe(false);
    });

    it('still emits no block for empty prose that lists authored fields', () => {
      const raw = componentBrief(SPEC, {
        generatedAt: AT, prose: { definition: '', accessibility: '', dos: [], donts: [], authored: ['definition'] },
      }) as Record<string, unknown>;
      expect('guidelines' in raw).toBe(false);
    });
  });

  it('omits guidelines entirely when none were stored', () => {
    expect('guidelines' in brief()).toBe(false);
    expect('guidelines' in brief({ prose: null })).toBe(false);
  });

  // Key ABSENCE on the raw object, not `guidelines === undefined` after a YAML
  // round trip: the emitter drops undefined-valued keys either way, so only a
  // conditional spread in componentBrief makes `'guidelines' in brief` false
  // for a consumer that reads the object before it is serialized. The three
  // tests above all parse YAML and so cannot tell the two apart.
  it('leaves no guidelines key on the raw object when there is no prose', () => {
    const raw = componentBrief(SPEC, { generatedAt: AT }) as Record<string, unknown>;
    const rawNull = componentBrief(SPEC, { generatedAt: AT, prose: null }) as Record<string, unknown>;
    expect('guidelines' in raw).toBe(false);
    expect('guidelines' in rawNull).toBe(false);
  });

  it('omits guidelines entirely when a stored ProseDrafts is truthy but every field is empty', () => {
    const y = brief({ prose: { definition: '', accessibility: '', dos: [], donts: [] } });
    expect('guidelines' in y).toBe(false);
  });

  // The `origin` marker must not count towards the emptiness check. If it did,
  // a stored ProseDrafts with nothing in it would start emitting a guidelines
  // block whose only content is the marker saying it was generated.
  it('emits no guidelines block for empty prose even though origin is always set', () => {
    const raw = componentBrief(SPEC, {
      generatedAt: AT,
      prose: { definition: '', accessibility: '', dos: [], donts: [] },
    }) as Record<string, unknown>;
    expect('guidelines' in raw).toBe(false);
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
      origin: 'generated',
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
      origin: 'generated',
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
// componentBrief effects_inline
// ---------------------------------------------------------------------------

describe('componentBrief effects_inline', () => {
  // The identity a bound effect field carries is a full RefIdentity, id and
  // all -- the same shape a node-level fill/stroke binding carries. Built by
  // hand rather than through `ident` so the id and collectionId look exactly
  // like the ones the finding this test guards against showed leaking.
  const colorBinding: RefIdentity = {
    id: 'VariableID:5', name: 'color/shadow/default', kind: 'variable',
    remote: false, collectionId: 'VariableCollectionId:1',
  };

  const spec: IntermediateSpec = {
    ...SPEC,
    nodeEffects: [{
      part: 'Container',
      path: 'Container',
      effects: [{
        type: 'drop-shadow',
        visible: true,
        blendMode: 'NORMAL',
        color: { hex: '#000000', alpha: 0.08 },
        offset: { x: 0, y: 2 },
        radius: 4,
        spread: 1,
        bindings: { color: colorBinding },
      }],
    }],
  };

  it('projects a bound field to its token NAME, dropping every identity field', () => {
    const raw = componentBrief(spec, { generatedAt: AT }) as Record<string, unknown>;
    // Deep equality, not a spot check on `color`: a shape drift that let ANY
    // extra key (id, remote, collectionId, or a nested object in place of the
    // bare name) back into `bindings` fails this immediately, which a test
    // that only asserted `bindings.color === 'color/shadow/default'` would
    // not -- that assertion is satisfied even if a sibling `id` key rides
    // along unnoticed.
    expect(raw.effects_inline).toEqual([{
      path: 'Container',
      layers: [{
        type: 'drop-shadow',
        visible: true,
        blendMode: 'NORMAL',
        color: { hex: '#000000', alpha: 0.08 },
        offset: { x: 0, y: 2 },
        // Geometry survives untouched -- this is the whole point of the
        // block, and the fix must not collapse it while closing the leak.
        radius: 4,
        spread: 1,
        bindings: { color: 'color/shadow/default' },
      }],
    }]);
  });

  it('never puts the Figma id, remote flag or collection id on the wire', () => {
    const y = toYaml(componentBrief(spec, { generatedAt: AT }));
    expect(y).toContain('color/shadow/default');
    // Substring checks on the serialized YAML, not just the raw object: this
    // is the shape that actually reaches the clipboard, and the finding this
    // test guards against was specifically about what an agent reads there.
    expect(y).not.toContain('VariableID:5');
    expect(y).not.toContain('VariableCollectionId:1');
    expect(y).not.toMatch(/\bid:\s*VariableID/);
    expect(y).not.toMatch(/\bremote:/);
    expect(y).not.toMatch(/\bcollectionId:/);
  });
});

// ---------------------------------------------------------------------------
// componentBrief tokens
// ---------------------------------------------------------------------------

/** A binding as it appears in the brief: identity plus the minimal condition
 *  it holds under, if any. `when` is a lookup from axis name to the values
 *  the binding holds for, not a boolean expression -- an absent `when` means
 *  every variant. `kind` joins a binding to its `used` entry on (token, kind)
 *  rather than on a name that a variable and a style can share. Typed rather
 *  than `any` so a shape drift fails at compile time, matching the
 *  convention above. */
interface Binding {
  path: string;
  property: string;
  token: string;
  kind: string;
  when?: Record<string, string[]>;
}

interface ParsedTokenBrief extends ParsedComponentBrief {
  tokens: { used: UsedEntry[]; bindings: Binding[] };
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
    { part: 'container', path: 'Container/container', property: 'border-radius', conditions: {}, ...ident('radius/md') },
    // Conditioned per state: its binding carries a `when`.
    { part: 'container', path: 'Container/container', property: 'fill', conditions: { State: ['Enabled'] }, ...ident('color/bg/brand') },
    { part: 'container', path: 'Container/container', property: 'fill', conditions: { State: ['Hovered'] }, ...ident('color/bg/brand-hover') },
  ],
};

const tokenBrief = (over: Partial<ComponentBriefOptions> = {}): ParsedTokenBrief =>
  load(toYaml(componentBrief(TOKEN_SPEC, { generatedAt: AT, ...over }))) as ParsedTokenBrief;

describe('componentBrief tokens', () => {
  // -- from the task brief, Step 1 --------------------------------------

  it('lists each token once under used, in first-use order', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { type: ['Primary'] }, ...ident('color/surface/primary/default') },
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { type: ['Outline'] }, ...ident('color/surface/primary/default') },
      { part: 'Container', path: 'Container', property: 'height',
        conditions: { size: ['Large'] }, ...ident('button/lg-height') },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.tokens.used.map((u) => u.token)).toEqual([
      'color/surface/primary/default', 'button/lg-height',
    ]);
  });

  it('emits one binding per rule, carrying only the axes it depends on', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'height',
        conditions: { size: ['Large'] }, ...ident('button/lg-height') },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.tokens.bindings).toEqual([
      { path: 'Container', property: 'height', token: 'button/lg-height', kind: 'variable',
        when: { size: ['Large'] } },
    ]);
  });

  it('omits when entirely for a binding that holds in every variant', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'border-radius',
        conditions: {}, ...ident('rd-sm') },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.tokens.bindings[0]).toEqual(
      { path: 'Container', property: 'border-radius', token: 'rd-sm', kind: 'variable' });
    expect('when' in brief.tokens.bindings[0]).toBe(false);
  });

  it('no longer emits base or by_variant', () => {
    const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('base' in brief.tokens).toBe(false);
    expect('by_variant' in brief.tokens).toBe(false);
  });

  it('dedupes rules identical in path, property, token and conditions', () => {
    // tokens.ts documents that a part name is unique only among siblings, so
    // two nodes in different subtrees can minimize into identical rules.
    // Paths make most of those distinct, but a genuine duplicate must still
    // collapse to one.
    const rule = { part: 'Label', path: 'Container/Label', property: 'fill',
                   conditions: { type: ['Primary'] }, ...ident('color/text/default') };
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [rule, { ...rule }] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.tokens.bindings).toHaveLength(1);
  });

  it('keeps two rules that differ only in conditions', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { size: ['Large'] }, ...ident('a') },
      { part: 'Container', path: 'Container', property: 'fill',
        conditions: { size: ['Small'] }, ...ident('a') },
    ] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
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
    expect(universal).toEqual({
      path: 'Container/container', property: 'border-radius', token: 'radius/md', kind: 'variable',
    });
    expect(universal && 'when' in universal).toBe(false);
  });

  it('emits a binding with `when` naming the axis a variant-conditioned rule depends on', () => {
    const y = tokenBrief();
    expect(y.tokens.bindings).toContainEqual({
      path: 'Container/container', property: 'fill', token: 'color/bg/brand', kind: 'variable',
      when: { State: ['Enabled'] },
    });
    expect(y.tokens.bindings).toContainEqual({
      path: 'Container/container', property: 'fill', token: 'color/bg/brand-hover', kind: 'variable',
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

  it('states a resolution on every variable instead of a value: the brief has no foundation to read', () => {
    const y = tokenBrief();
    const used = usedEntry(y.tokens.used, 'color/bg/brand')!;
    expect(used.resolution?.status).toBe('no-foundation');
    expect('resolved' in used).toBe(false);
    expect('mode' in used).toBe(false);
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
        { part: 'container', path: 'Container/container', property: 'border-radius', conditions: {}, ...ident('radius/md') },
        { part: 'label', path: 'Container/label', property: 'typography', conditions: {}, ...identStyle('type/label', 'text-style') },
        { part: 'container', path: 'Container/container', property: 'fill', conditions: { State: ['Hover'] }, ...ident('color/bg/hover') },
      ],
    };
    const y = load(toYaml(componentBrief(wide, { generatedAt: AT }))) as ParsedTokenBrief;
    expect(instances.length).toBe(60);
    // Three rules produce three bindings, no matter how many variant
    // instances they'd have resolved against under v1.
    expect(y.tokens.bindings).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// componentBrief typography -- the bound text styles, each with a resolution
// ---------------------------------------------------------------------------
//
// The brief has no foundation to read, so it never carries a style's metrics;
// Component Context v5 does, in `references.foundation.styles`. These tests
// cover stating the bound styles with their resolution, and omitting the whole
// block when nothing is bound.

describe('componentBrief typography', () => {
  it('omits the block when no style is bound', () => {
    const b = componentBrief(baseSpec(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('typography' in b).toBe(false);
  });

  it('records a bound style with its resolution rather than dropping it', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [{
      part: 'Label', path: 'Container/Label', property: 'typography',
      conditions: {}, ...identStyle('Body/Regular', 'text-style') }] };
    const b = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    // Dropping it would make the brief claim the label has no typography at
    // all. Restated in the shared resolution vocabulary, so this can never
    // disagree with `tokens.used`.
    expect(b.typography?.['Body/Regular']).toEqual({
      resolution: {
        status: 'no-foundation',
        reason: 'No foundation snapshot was read, so no definition could be looked up.',
      },
    });
    expect(usedEntry(b.tokens.used, 'Body/Regular', 'text-style')?.resolution?.status).toBe('no-foundation');
  });
});

// ---------------------------------------------------------------------------
// componentBrief validation
// ---------------------------------------------------------------------------

describe('componentBrief validation', () => {
  it('omits the validation block entirely for a clean component', () => {
    const spec = { ...baseSpec(), gaps: [] };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    expect('validation' in brief).toBe(false);
  });

  it('mirrors a surviving gap as an unbound-value finding', () => {
    const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as unknown as BriefShape;
    const hit = brief.validation?.find((f) => f.id === 'unbound-value');
    expect(hit).toEqual({
      id: 'unbound-value', severity: 'warning',
      path: 'Container/container', property: 'gap',
      message: 'gap is a hardcoded 8 rather than a bound token.',
    });
  });

  it('flags a binding whose token names a state its own condition does not', () => {
    const spec = {
      ...baseSpec(),
      gaps: [],
      tokens: [{ part: 'Container', path: 'Container', property: 'fill',
                 conditions: { type: ['Primary'], size: ['Large'] },
                 ...ident('color/surface/primary/disabled') }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T' }) as unknown as BriefShape;
    const hit = brief.validation?.find((f) => f.id === 'default-state-uses-state-token');
    expect(hit?.message).toContain('disabled');
    expect(hit?.path).toBe('Container');
  });

});

// ---------------------------------------------------------------------------
// tokens.used as a list -- a variable and a style can share one name
// ---------------------------------------------------------------------------

describe('tokens.used as a list', () => {
  const specWith = (refs: Array<Partial<TokenRule>>): IntermediateSpec => ({
    ...baseSpec(),
    tokens: refs.map((r) => ({
      part: 'Container', path: 'Container', property: 'fills', conditions: {},
      id: 'VariableID:1', name: 'color/brand', kind: 'variable' as const, remote: false, ...r,
    })),
  });

  it('holds a variable and an effect style that share one name', () => {
    const brief = componentBrief(specWith([
      { id: 'VariableID:1', name: 'Elevation/1', kind: 'variable', property: 'fills' },
      { id: 'S:1', name: 'Elevation/1', kind: 'effect-style', property: 'effects' },
    ]), { generatedAt: AT }) as unknown as {
      tokens: { used: Array<{ token: string; kind: string; resolution?: { status: string } }> };
    };
    // A map keyed by name cannot hold both, and a conditional key that only
    // qualifies on collision is the kind of thing that bites later.
    expect(brief.tokens.used).toHaveLength(2);
    expect(brief.tokens.used.map((u) => u.kind).sort()).toEqual(['effect-style', 'variable']);
  });

  it('gives a paint style a kind and a stated status, never a bare {}', () => {
    const brief = componentBrief(specWith([
      { id: 'S:2', name: 'Brand/Card', kind: 'paint-style', property: 'fills' },
    ]), { generatedAt: AT }) as unknown as {
      tokens: { used: Array<{ token: string; kind: string; resolution: { status: string; reason: string } }> };
    };
    expect(brief.tokens.used[0]).toEqual({
      token: 'Brand/Card', kind: 'paint-style',
      resolution: { status: 'not-extracted', reason: 'Paint style definitions are not extracted.' },
    });
  });

  it('carries kind on every binding so it joins to used on (token, kind)', () => {
    const brief = componentBrief(specWith([{ kind: 'effect-style', id: 'S:1', property: 'effects' }]),
      { generatedAt: AT }) as unknown as {
        tokens: { bindings: Array<{ token: string; kind: string }> };
      };
    expect(brief.tokens.bindings[0].kind).toBe('effect-style');
  });

  it('calls a text style binding text-style, not typography', () => {
    const brief = componentBrief(specWith([
      { id: 'S:3', name: 'Paragraph/S', kind: 'text-style', property: 'typography' },
    ]), { generatedAt: AT }) as unknown as { tokens: { used: Array<{ kind: string }> } };
    // The style kinds share one vocabulary now: `typography` named the PROPERTY,
    // not the kind of thing bound.
    expect(brief.tokens.used[0].kind).toBe('text-style');
  });
});
