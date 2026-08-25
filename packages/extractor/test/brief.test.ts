import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { foundationBrief, componentBrief } from '../src/brief';
import type { ComponentBriefOptions } from '../src/brief';
import { toYaml } from '../src/yaml';
import { buildFoundation, narrowFoundation } from '../src/foundation';
import type { FoundationSpec, SerializedFoundation } from '../src/foundation';
import type { IntermediateSpec } from '../src/extract';
import type { YamlValue } from '../src/yaml';
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
  effectStyles: [],
};

/** Minimal FoundationSpec for the group-descriptions tests below: one
 *  single-mode collection holding one COLOR variable, just enough to exercise
 *  the guidelines block without dragging in FOUNDATION's second mode/alias
 *  machinery, which those tests have no use for. */
function oneCollection(): FoundationSpec {
  return {
    fileKey: 'FILE1', extractedAt: 'T', textStyles: [], effectStyles: [],
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

/**
 * Structural shape of the raw (pre-YAML) object foundationBrief and
 * componentBrief return, covering just the blocks the tests below read
 * directly off that object -- before it round-trips through YAML, so a test
 * can still tell a genuinely-absent key from a present-but-undefined one via
 * `'x' in obj`. A field every test only ever passes whole into `expect(...)`
 * or checks with `in` stays optional here; a field a test indexes or
 * dereferences further (`.api.variants.type`, `.guidelines.group_descriptions.A`,
 * `.collections[0].tokens[0]`, ...) is typed as present, because a raw,
 * un-narrowed chain like that needs every intermediate step to be provably
 * defined. One cast at the point each brief is produced, reused by every
 * test below instead of a fresh `any` at each site.
 */
/** One `tokens.used` entry now that `used` is a list, not a map keyed by
 *  name: every entry carries `token` and `kind` (the join identity), a
 *  variable entry also carries whatever `lookupToken` found, and a style
 *  entry (text-style / effect-style) carries neither a definition nor a
 *  lookup, only a `resolution` when it isn't a pointer to something real. */
interface UsedEntry {
  token: string;
  kind: string;
  resolution?: { status: string; reason: string };
  alias?: string;
  resolved?: string | number | boolean | Record<string, unknown>;
  external?: boolean;
  mode?: string;
  code?: Record<string, string>;
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
  component?: { name: string; related?: string[] };
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
  guidelines: { origin?: string; group_descriptions: Record<string, Record<string, string>> };
  collections: Array<{ name: string; tokens: Array<{ name: string; values: Record<string, YamlValue> }> }>;
  typography?: Record<string, {
    resolution?: { status: string; reason: string };
    source_name?: string;
    font_family?: string;
    font_style?: string;
    font_size?: number;
    line_height?: { unit: string; value?: number };
    letter_spacing?: { unit: string; value: number };
  }>;
  effects?: Record<string, {
    resolution?: { status: string; reason: string };
    source_name?: string;
    description?: string;
    layers?: unknown[];
  }>;
  effects_inline?: Array<{ path: string; layers: unknown[] }>;
}

describe('foundationBrief', () => {
  it('stamps the envelope with the extractor version and brief version', () => {
    const b = foundationBrief(FOUNDATION, { generatedAt: AT }) as Record<string, Record<string, unknown>>;
    expect(b.spec_layer.kind).toBe('foundation');
    expect(b.spec_layer.version).toBe(4);
    expect(b.spec_layer.extractor).toBe('1');
  });

  it('names the file key as file_key, and omits the source block entirely when unavailable', () => {
    const withKey = foundationBrief(FOUNDATION, { generatedAt: AT }) as unknown as BriefShape;
    expect(withKey.source).toEqual({ file_key: 'abc123' });
    // Not `source: {}`: an empty container reads as a measured verdict rather
    // than as an absence, so the whole key is missing instead.
    const noKey = foundationBrief({ ...FOUNDATION, fileKey: 'unknown' },
      { generatedAt: AT }) as unknown as Record<string, unknown>;
    expect('source' in noKey).toBe(false);
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
    }) as unknown as BriefShape;
    expect(brief.guidelines.origin).toBe('generated');
    expect(brief.guidelines.group_descriptions).toEqual({
      Primitives: { 'color/surface': 'Surfaces you paint panels with.' },
    });
  });

  it('nests by collection so two collections can share a folder name', () => {
    const brief = foundationBrief(oneCollection(), {
      generatedAt: 'T',
      groupDescriptions: { A: { color: 'From A.' }, B: { color: 'From B.' } },
    }) as unknown as BriefShape;
    expect(brief.guidelines.group_descriptions.A.color).toBe('From A.');
    expect(brief.guidelines.group_descriptions.B.color).toBe('From B.');
  });

  it('omits the guidelines block entirely when there are no descriptions', () => {
    const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('guidelines' in brief).toBe(false);
  });

  it('omits the block when a description map is present but empty', () => {
    const brief = foundationBrief(oneCollection(), {
      generatedAt: 'T', groupDescriptions: { Primitives: {} },
    }) as unknown as BriefShape;
    expect('guidelines' in brief).toBe(false);
  });

  it('never carries a contrast block', () => {
    const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as unknown as
      Record<string, unknown>;
    // A guard, not a shape check: contrast used to ride along here, and its
    // failure list grows with the file, which is exactly what this payload
    // cannot afford. The measurement still exists for the foundation FRAME.
    expect('contrast' in brief).toBe(false);
  });

  it('still emits collections and text styles unchanged', () => {
    const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as unknown as BriefShape;
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
  it('stamps a component envelope and the source identity', () => {
    const y = brief();
    expect(y.spec_layer.kind).toBe('component');
    expect(y.source).toEqual(
      { file_key: 'abc123', node_id: '1:100', node_name: 'Button', component_key: 'm3-button' });
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

  it('resolves token values through the foundation when one is supplied', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    // color/bg/brand resolves at the collection's default mode (Light).
    expect(usedEntry(y.tokens.used, 'color/bg/brand')?.resolved).toBe('#2563EB');
  });

  it("names the resolved value's mode as the collection's own default mode", () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    expect(usedEntry(y.tokens.used, 'color/bg/brand')?.mode).toBe('Light');
  });

  // From the task brief: a collection whose default mode is NOT the first one
  // declared (Dark, not Light) must still name that mode, rather than a
  // reader assuming the first mode listed is always the one in force.
  it('names the mode a resolved value was read at', () => {
    const foundation: FoundationSpec = {
      fileKey: 'F', extractedAt: 'T', textStyles: [], effectStyles: [],
      collections: [{
        id: 'c1', name: 'Semantic', defaultModeId: 'm2',
        modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
        variables: [{
          name: 'color/surface/default', group: '', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: {
            m1: { kind: 'color', hex: '#ffffff', alpha: 1 },
            m2: { kind: 'color', hex: '#111111', alpha: 1 },
          },
        }],
      }],
    };
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [{ part: 'Container', path: 'Container',
      property: 'fill', conditions: {}, ...ident('color/surface/default') }] };
    const brief = componentBrief(spec, { generatedAt: 'T', foundation }) as unknown as BriefShape;
    const used = usedEntry(brief.tokens.used, 'color/surface/default')!;
    // The collection's own default mode is m2, so the value is the Dark one,
    // and the brief says so instead of leaving a reader to assume Light.
    expect(used.resolved).toBe('#111111');
    expect(used.mode).toBe('Dark');
  });

  it('drops a deleted default mode rather than leaking its internal Figma id', () => {
    const foundation: FoundationSpec = {
      fileKey: 'F', extractedAt: 'T', textStyles: [], effectStyles: [],
      collections: [{
        id: 'c1', name: 'Semantic', defaultModeId: 'gone',
        modes: [{ modeId: 'm1', name: 'Light' }],
        variables: [{
          name: 'color/surface/default', group: '', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'color', hex: '#ffffff', alpha: 1 } },
        }],
      }],
    };
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [{ part: 'Container', path: 'Container',
      property: 'fill', conditions: {}, ...ident('color/surface/default') }] };
    const brief = componentBrief(spec, { generatedAt: 'T', foundation }) as unknown as BriefShape;
    const used = usedEntry(brief.tokens.used, 'color/surface/default')!;
    expect('mode' in used).toBe(false);
    expect(JSON.stringify(used)).not.toContain('gone');
  });

  it('omits resolved entirely when no foundation is supplied', () => {
    const y = tokenBrief();
    const used = usedEntry(y.tokens.used, 'color/bg/brand')!;
    expect('resolved' in used).toBe(false);
    expect('mode' in used).toBe(false);
  });

  it('emits code when the resolved variable has codeSyntax', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    expect(usedEntry(y.tokens.used, 'color/bg/brand')?.code).toEqual({ WEB: '--color-bg-brand' });
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
// componentBrief typography -- resolving a bound text style to real metrics
// ---------------------------------------------------------------------------
//
// v1 emitted only the style's display string ("Button/L : 14px Medium"), with
// no value and no code: a consumer could not generate CSS from that string,
// and requiredRatio could not pick a WCAG threshold without a real size and
// weight. These tests cover resolving the bound style against
// FoundationSpec.textStyles, recording (not dropping) a style the foundation
// dump doesn't carry, and omitting the whole block when nothing is bound.

describe('componentBrief typography', () => {
  /** The exact float noise a real Figma file produced for 140% and 0.2px. */
  const noisyFoundation: FoundationSpec = {
    fileKey: 'F', extractedAt: 'T', collections: [], effectStyles: [],
    textStyles: [{
      name: 'Button/L : 14px Medium', group: 'Button', description: '',
      fontFamily: 'Open Sans', fontStyle: 'Regular', fontSize: 14,
      lineHeight: { unit: 'PERCENT', value: 139.9999976158142 },
      letterSpacing: { unit: 'PIXELS', value: 0.20000000298023224 },
      paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL',
      textDecoration: 'NONE', boundVariables: {},
    }],
  };
  const noisySpec = (): IntermediateSpec => ({ ...baseSpec(), tokens: [{
    part: 'Label', path: 'Container/Label', property: 'typography',
    conditions: { size: ['Large'] }, ...identStyle('Button/L : 14px Medium', 'text-style') }] });

  it('trims binary-float noise off the metrics', () => {
    // Measured from a real run: a designer typed 140 and 0.2, and Figma stored
    // doubles. Emitted raw, an agent copies 139.9999976158142 into CSS.
    const b = componentBrief(
      noisySpec(), { generatedAt: 'T', foundation: noisyFoundation }) as unknown as BriefShape;
    expect(b.typography?.['Button/L : 14px Medium']?.line_height)
      .toEqual({ unit: 'PERCENT', value: 140 });
    expect(b.typography?.['Button/L : 14px Medium']?.letter_spacing)
      .toEqual({ unit: 'PIXELS', value: 0.2 });
  });

  it('keeps a precision a type ramp actually expresses', () => {
    // Rounding must not flatten a real fractional value into a lie.
    const foundation: FoundationSpec = {
      ...noisyFoundation,
      textStyles: [{
        ...noisyFoundation.textStyles[0],
        lineHeight: { unit: 'PERCENT', value: 137.5 },
        letterSpacing: { unit: 'PIXELS', value: -0.25 },
      }],
    };
    const b = componentBrief(noisySpec(), { generatedAt: 'T', foundation }) as unknown as BriefShape;
    expect(b.typography?.['Button/L : 14px Medium']?.line_height)
      .toEqual({ unit: 'PERCENT', value: 137.5 });
    expect(b.typography?.['Button/L : 14px Medium']?.letter_spacing)
      .toEqual({ unit: 'PIXELS', value: -0.25 });
  });

  it('points a text-style entry at the typography block instead of an empty map', () => {
    // A typography binding names a TEXT STYLE, not a variable, so lookupToken
    // finds nothing. It used to emit a bare `{}`, which reads as "could not be
    // resolved" when the metrics are in fact right there in `typography`. Since
    // this style IS defined in the foundation, `used` carries a bare pointer
    // (token + kind), never a copy of the metrics that live in `typography`.
    const b = componentBrief(
      noisySpec(), { generatedAt: 'T', foundation: noisyFoundation }) as unknown as BriefShape;
    expect(usedEntry(b.tokens.used, 'Button/L : 14px Medium', 'text-style'))
      .toEqual({ token: 'Button/L : 14px Medium', kind: 'text-style' });
  });

  it('resolves a bound text style to real metrics', () => {
    const foundation: FoundationSpec = {
      fileKey: 'F', extractedAt: 'T', collections: [], effectStyles: [],
      textStyles: [{
        name: 'Button/L : 14px Medium', group: 'Button', description: '',
        fontFamily: 'Inter', fontStyle: 'Medium', fontSize: 14,
        lineHeight: { unit: 'PIXELS', value: 20 },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL',
        textDecoration: 'NONE', boundVariables: {},
      }],
    };
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [{
      part: 'Label', path: 'Container/Label', property: 'typography',
      conditions: { size: ['Large'] }, ...identStyle('Button/L : 14px Medium', 'text-style') }] };
    const b = componentBrief(spec, { generatedAt: 'T', foundation }) as unknown as BriefShape;
    expect(b.typography?.['Button/L : 14px Medium']).toEqual({
      source_name: 'Button/L : 14px Medium',
      font_family: 'Inter', font_style: 'Medium', font_size: 14,
      line_height: { unit: 'PIXELS', value: 20 },
      letter_spacing: { unit: 'PIXELS', value: 0 },
    });
  });

  it('omits the block when no style is bound', () => {
    const b = componentBrief(baseSpec(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('typography' in b).toBe(false);
  });

  it('records a bound style the foundation cannot resolve rather than dropping it', () => {
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [{
      part: 'Label', path: 'Container/Label', property: 'typography',
      conditions: {}, ...identStyle('Missing/Style', 'text-style') }] };
    const foundation: FoundationSpec =
      { fileKey: 'F', extractedAt: 'T', collections: [], textStyles: [], effectStyles: [] };
    const b = componentBrief(spec, { generatedAt: 'T', foundation }) as unknown as BriefShape;
    // A style bound in the file but absent from this dump is unresolved, not
    // absent. Dropping it would make the brief claim the label has no
    // typography at all -- restated in the shared resolution vocabulary rather
    // than an ad-hoc string, so this can never disagree with `tokens.used`.
    expect(b.typography?.['Missing/Style']).toEqual({
      resolution: {
        status: 'not-in-snapshot',
        reason: 'local to this file but absent from the foundation snapshot, which is read '
          + 'once per session. Read the foundations again to pick it up.',
      },
    });
  });

  it('records an AUTO line height truthfully, with no fabricated value', () => {
    const foundation: FoundationSpec = {
      fileKey: 'F', extractedAt: 'T', collections: [], effectStyles: [],
      textStyles: [{
        name: 'Heading/Auto', group: 'Heading', description: '',
        fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PERCENT', value: 0 },
        paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL',
        textDecoration: 'NONE', boundVariables: {},
      }],
    };
    const spec: IntermediateSpec = { ...baseSpec(), tokens: [{
      part: 'Label', path: 'Container/Label', property: 'typography',
      conditions: {}, ...identStyle('Heading/Auto', 'text-style') }] };
    const raw = componentBrief(spec, { generatedAt: 'T', foundation }) as unknown as BriefShape;
    const entry = raw.typography?.['Heading/Auto'];
    // Truthful: no numeric value is invented for AUTO, and the raw object
    // (pre-YAML) genuinely lacks the key rather than holding it undefined.
    expect(entry?.line_height?.unit).toBe('AUTO');
    expect(entry?.line_height && 'value' in entry.line_height).toBe(false);

    // The YAML round trip must not resurrect a fabricated 0 or null either.
    const y = load(toYaml(componentBrief(spec, { generatedAt: 'T', foundation }))) as
      { typography: Record<string, { line_height: { unit: string; value?: number } }> };
    expect(y.typography['Heading/Auto'].line_height).toEqual({ unit: 'AUTO' });
  });
});

// ---------------------------------------------------------------------------
// componentBrief tokens.used flattening -- one test per valueOf kind
// ---------------------------------------------------------------------------

/**
 * One `used` entry for `token`, looked up directly off the raw (non-YAML)
 * brief object, for a single-token component bound to `token`. Raw rather
 * than round-tripped through YAML deliberately: several assertions below
 * check `'key' in entry`, which only proves a key is truly absent (not merely
 * undefined-valued) when read off the object the emitter itself will filter,
 * not off the emitter's own output.
 */
function usedFor(foundation: FoundationSpec, token: string): UsedEntry {
  const spec: IntermediateSpec = { ...baseSpec(), tokens: [
    { part: 'Container', path: 'Container', property: 'fill', conditions: {}, ...ident(token) },
  ] };
  const brief = componentBrief(spec, { generatedAt: 'T', foundation }) as unknown as BriefShape;
  return usedEntry(brief.tokens.used, token)!;
}

/** One collection covering all six `FoundationValue` kinds `valueOf` switches
 *  on, so each kind's flattened `used` entry can be asserted in isolation.
 *  `color/alpha` and `unresolved/cycle` exist alongside the two more common
 *  kinds specifically because `valueOf`'s color and alias branches are each
 *  two cases, not one -- an opaque color collapses to a bare hex string but a
 *  translucent one stays an object, and a resolvable alias carries a
 *  `resolved` key that an unresolved one cannot. */
function sixKindFoundation(): FoundationSpec {
  return {
    fileKey: 'F', extractedAt: 'T', textStyles: [], effectStyles: [],
    collections: [{
      id: 'c1', name: 'Kinds', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Mode1' }],
      variables: [
        { name: 'color/opaque', group: '', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'color', hex: '#112233', alpha: 1 } } },
        { name: 'color/alpha', group: '', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'color', hex: '#112233', alpha: 0.5 } } },
        { name: 'number/radius', group: '', resolvedType: 'FLOAT', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'number', value: 8 } } },
        { name: 'string/font', group: '', resolvedType: 'STRING', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'string', value: 'Inter' } } },
        { name: 'boolean/flag', group: '', resolvedType: 'BOOLEAN', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'boolean', value: true } } },
        { name: 'alias/internal', group: '', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'alias', targetName: 'color/opaque', targetCollection: 'Kinds',
            external: false, resolved: { kind: 'color', hex: '#112233', alpha: 1 } } } },
        { name: 'alias/external', group: '', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'alias', targetName: 'brand/blue', targetCollection: 'Other Library',
            external: true, resolved: null } } },
        { name: 'unresolved/cycle', group: '', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'unresolved', reason: 'cycle' } } },
      ],
    }],
  };
}

describe('componentBrief tokens.used flattening', () => {
  const foundation = sixKindFoundation();

  it('flattens an opaque color to a bare hex string under resolved', () => {
    const used = usedFor(foundation, 'color/opaque');
    expect(used).toEqual({ token: 'color/opaque', kind: 'variable', resolved: '#112233', mode: 'Mode1' });
  });

  it('flattens a translucent color to a {hex, alpha} object under resolved', () => {
    const used = usedFor(foundation, 'color/alpha');
    expect(used).toEqual({
      token: 'color/alpha', kind: 'variable',
      resolved: { hex: '#112233', alpha: 0.5 }, mode: 'Mode1',
    });
  });

  it('flattens a number to a machine-readable number under resolved, not a formatted string', () => {
    const used = usedFor(foundation, 'number/radius');
    expect(used.resolved).toBe(8);
    expect(typeof used.resolved).toBe('number');
  });

  it('flattens a string to a bare string under resolved', () => {
    const used = usedFor(foundation, 'string/font');
    expect(used).toEqual({ token: 'string/font', kind: 'variable', resolved: 'Inter', mode: 'Mode1' });
  });

  it('flattens a boolean to a bare boolean under resolved', () => {
    const used = usedFor(foundation, 'boolean/flag');
    expect(used).toEqual({ token: 'boolean/flag', kind: 'variable', resolved: true, mode: 'Mode1' });
  });

  it('flattens a resolvable alias to alias and resolved as siblings, no value wrapper', () => {
    const used = usedFor(foundation, 'alias/internal');
    expect(used).toEqual({
      token: 'alias/internal', kind: 'variable',
      alias: 'color/opaque', resolved: '#112233', mode: 'Mode1',
    });
    expect('value' in used).toBe(false);
  });

  it('keeps the external flag on an unresolved external alias, and omits resolved rather than nulling it', () => {
    const used = usedFor(foundation, 'alias/external');
    expect(used).toEqual({
      token: 'alias/external', kind: 'variable', alias: 'brand/blue', external: true, mode: 'Mode1',
    });
    expect('resolved' in used).toBe(false);
  });

  it('surfaces an unresolved value truthfully under resolved instead of dropping it', () => {
    const used = usedFor(foundation, 'unresolved/cycle');
    expect(used).toEqual({
      token: 'unresolved/cycle', kind: 'variable', resolved: { unresolved: 'cycle' }, mode: 'Mode1',
    });
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

  // Exercises the real wiring end to end: the resolved-number map is built
  // from the same lookupToken() results tokens.used reports, not re-derived,
  // so this also proves that map actually gets populated with a real number
  // (sixKindFoundation's number/radius resolves to 8) rather than staying
  // empty because of a field-name mismatch on lookupToken's return shape.
  it('flags a rendered radius disagreeing with its bound token, resolved via the foundation', () => {
    const spec = {
      ...baseSpec(),
      gaps: [],
      tokens: [{ part: 'container', path: 'Container/container', property: 'border-radius',
                 conditions: {}, ...ident('number/radius') }],
      layout: [{ part: 'container', path: 'Container/container',
                 summary: 'horizontal, radius 4', values: { radius: 4 } }],
    };
    const brief = componentBrief(spec, { generatedAt: 'T', foundation: sixKindFoundation() }) as unknown as BriefShape;
    const hit = brief.validation?.find((f) => f.id === 'geometry-token-mismatch');
    expect(hit?.message).toContain('4');
    expect(hit?.message).toContain('8');
  });
});

// ---------------------------------------------------------------------------
// tokens.used as a list -- a variable and a style can share one name
// ---------------------------------------------------------------------------

/** A minimal FoundationSpec holding one effect style named `name`, so the
 *  "pointer, not a copy" test below has a real definition for `effects:` to
 *  carry and `tokens.used` to point at. */
function foundationWithEffectStyle(name: string): FoundationSpec {
  return {
    fileKey: 'F', extractedAt: 'T', collections: [], textStyles: [],
    effectStyles: [{
      name, group: '', description: '',
      effects: [{
        type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
        color: { hex: '#000000', alpha: 0.25 }, offset: { x: 0, y: 2 }, radius: 4,
      }],
    }],
  };
}

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
      resolution: { status: 'not-extracted', reason: 'paint style definitions are not extracted.' },
    });
  });

  it('carries kind on every binding so it joins to used on (token, kind)', () => {
    const brief = componentBrief(specWith([{ kind: 'effect-style', id: 'S:1', property: 'effects' }]),
      { generatedAt: AT }) as unknown as {
        tokens: { bindings: Array<{ token: string; kind: string }> };
      };
    expect(brief.tokens.bindings[0].kind).toBe('effect-style');
  });

  it('makes a style entry a pointer, never a copy of its definition', () => {
    const foundation = foundationWithEffectStyle('Focused/Primary');
    const brief = componentBrief(specWith([
      { id: 'S:1', name: 'Focused/Primary', kind: 'effect-style', property: 'effects' },
    ]), { generatedAt: AT, foundation }) as unknown as {
      tokens: { used: Array<Record<string, unknown>> };
      effects: Record<string, { source_name: string; layers: unknown[] }>;
    };
    // Inlining would give the brief two owners for the same values, which is the
    // failure componentBrief already guards against for `unbound` vs `tokens`.
    expect(brief.tokens.used[0]).toEqual({ token: 'Focused/Primary', kind: 'effect-style' });
    expect(brief.effects['Focused/Primary'].source_name).toBe('Focused/Primary');
    expect(brief.effects['Focused/Primary'].layers).toHaveLength(1);
  });

  it('cannot produce not-in-scope, because componentBrief is never given a narrowed spec', () => {
    // actions.ts:512 always passes the unnarrowed currentFoundationSpec(). A
    // status that cannot occur on a path does not belong in that path's
    // vocabulary, so this asserts the absence rather than trusting the call site.
    const foundation = oneCollection();
    expect('narrowedTo' in foundation).toBe(false);
    const brief = componentBrief(specWith([
      { id: 'VariableID:99', name: 'color/new', kind: 'variable' },
    ]), { generatedAt: AT, foundation }) as unknown as {
      tokens: { used: Array<{ resolution?: { status: string } }> };
    };
    expect(brief.tokens.used[0].resolution?.status).toBe('not-in-snapshot');
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

// ---------------------------------------------------------------------------
// honest values and containers (B6, B7)
// ---------------------------------------------------------------------------

/** One collection ('Semantic') holding a plain colour token and a second
 *  token that aliases out to `targetName` in `targetCollection`, external by
 *  default. `targetCollection` is what an EXTERNAL alias carries end to end;
 *  passing '' models `readCollectionName` failing to name it. */
function aliasFoundation(targetCollection = 'Core Palette'): FoundationSpec {
  return {
    fileKey: 'FILE1', extractedAt: 'T', textStyles: [], effectStyles: [],
    collections: [{
      id: 'sem', name: 'Semantic', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      variables: [
        {
          name: 'color/bg/default', group: 'color', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'color', hex: '#ffffff', alpha: 1 } },
        },
        {
          name: 'color/bg/alias', group: 'color', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: {
            m1: { kind: 'alias', targetName: 'colors/gray/200', targetCollection,
                  external: true, resolved: null },
          },
        },
      ],
    }],
  };
}

/** Same shape as aliasFoundation, but the second token's alias resolves
 *  LOCALLY (external: false). A local alias already resolves, so its
 *  targetCollection -- 'Semantic', the same collection it lives in -- must
 *  never surface: naming it would add a line without adding information. */
function localAliasFoundation(): FoundationSpec {
  return {
    fileKey: 'FILE1', extractedAt: 'T', textStyles: [], effectStyles: [],
    collections: [{
      id: 'sem', name: 'Semantic', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      variables: [
        {
          name: 'color/bg/default', group: 'color', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'color', hex: '#ffffff', alpha: 1 } },
        },
        {
          name: 'color/bg/alias', group: 'color', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: {
            m1: { kind: 'alias', targetName: 'color/bg/default', targetCollection: 'Semantic',
                  external: false, resolved: { kind: 'color', hex: '#ffffff', alpha: 1 } },
          },
        },
      ],
    }],
  };
}

/** One collection holding a single colour token at the given alpha, to probe
 *  the rounding boundary between "noise" (0.03999999910593033) and a real
 *  value the percent field can express (0.125). */
function alphaFoundation(alpha: number): FoundationSpec {
  return {
    fileKey: 'FILE1', extractedAt: 'T', textStyles: [], effectStyles: [],
    collections: [{
      id: 'c1', name: 'Colors', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      variables: [{
        name: 'color/overlay', group: 'color', resolvedType: 'COLOR',
        description: '', codeSyntax: {},
        valuesByMode: { m1: { kind: 'color', hex: '#000000', alpha } },
      }],
    }],
  };
}

/** A raw dump (buildFoundation input, not a resolved FoundationSpec) with two
 *  collections -- 'Primitives' (id 'prim') and 'Semantic' (id 'sem') -- so
 *  narrowFoundation's collection branch has a real target to narrow down to,
 *  distinct from the collection left behind. Carries one real text style, not
 *  `[]`: narrowFoundation's textStyles branch returns null BEFORE stamping
 *  anything when textStyles is empty, which would make a textStyles-scoped
 *  narrowing test vacuous (asserting against a spec that was never produced). */
function twoCollectionDump(): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: 'T', externals: [], effectStyles: [],
    textStyles: [{
      name: 'Body/Regular', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PERCENT', value: 0 },
      paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: {},
    }],
    collections: [
      {
        id: 'prim', name: 'Primitives', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Value' }],
        variables: [{
          id: 'v1', name: 'color/gray/100', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
        }],
      },
      {
        id: 'sem', name: 'Semantic', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Mode 1' }],
        variables: [{
          id: 'v2', name: 'color/bg/default', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
        }],
      },
    ],
  };
}

describe('honest values and containers', () => {
  it('names the collection an external alias points into', () => {
    // In one real export, 13 external target names also existed locally and 4
    // did not. Without the collection, the payload prints a name matching a
    // local token of different identity with nothing to separate them.
    const brief = foundationBrief(aliasFoundation(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.collections[0].tokens[1].values['Mode 1'])
      .toEqual({ alias: 'colors/gray/200', external: true, collection: 'Core Palette' });
  });

  it('omits the collection when the reader could not name it', () => {
    const brief = foundationBrief(aliasFoundation(''), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('collection' in (brief.collections[0].tokens[1].values['Mode 1'] as object)).toBe(false);
  });

  it('leaves a local alias alone', () => {
    // A local alias already resolves, so naming its collection adds a line
    // without adding information.
    const brief = foundationBrief(localAliasFoundation(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('collection' in (brief.collections[0].tokens[1].values['Mode 1'] as object)).toBe(false);
  });

  it('trims float noise off alpha without flattening a real 0.125', () => {
    const brief = foundationBrief(alphaFoundation(0.03999999910593033), { generatedAt: 'T' }) as unknown as BriefShape;
    expect((brief.collections[0].tokens[0].values['Mode 1'] as { alpha: number }).alpha).toBe(0.04);
    const fine = foundationBrief(alphaFoundation(0.125), { generatedAt: 'T' }) as unknown as BriefShape;
    // Four decimals, not two: Figma's own percent field can express 0.125 and
    // two decimals would silently round it to 0.13.
    expect((fine.collections[0].tokens[0].values['Mode 1'] as { alpha: number }).alpha).toBe(0.125);
  });

  it('omits source entirely when Figma exposes no file key', () => {
    const brief = foundationBrief({ ...oneCollection(), fileKey: 'unknown' },
      { generatedAt: 'T' }) as unknown as Record<string, unknown>;
    // `source: {}` is not an honest empty: it reads as a measured verdict.
    expect('source' in brief).toBe(false);
  });

  it('omits empty text_styles and effect_styles rather than emitting []', () => {
    const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as unknown as Record<string, unknown>;
    expect('text_styles' in brief).toBe(false);
    expect('effect_styles' in brief).toBe(false);
  });

  it('says what a narrowed copy covers, and says nothing on a whole-file copy', () => {
    const whole = buildFoundation(twoCollectionDump());
    expect('scope' in (foundationBrief(whole, { generatedAt: 'T' }) as object)).toBe(false);

    const narrowed = narrowFoundation(whole, { target: 'collection', collectionId: 'sem' })!;
    const brief = foundationBrief(narrowed, { generatedAt: 'T' }) as unknown as {
      scope: { collections: string[]; text_styles: string; effect_styles: string };
    };
    // `text_styles: []` used to read as "this file has no text styles". It means
    // "this copy does not cover them".
    expect(brief.scope).toEqual({
      collections: ['Semantic'], text_styles: 'excluded', effect_styles: 'excluded',
    });
  });

  it('states scope for a text-styles-scoped copy, distinctly from a collection-scoped one', () => {
    const whole = buildFoundation(twoCollectionDump());
    const narrowed = narrowFoundation(whole, { target: 'textStyles' });
    // Guards the vacuous-test trap: narrowFoundation's textStyles branch
    // returns null BEFORE stamping narrowedTo when textStyles is empty, so a
    // fixture with none would make every assertion below compare against
    // `undefined` rather than against real behaviour.
    expect(narrowed).not.toBeNull();
    const brief = foundationBrief(narrowed!, { generatedAt: 'T' }) as unknown as {
      scope: { collections: string; text_styles: string; effect_styles: string };
      text_styles?: unknown[];
    };
    expect(brief.scope).toEqual({
      collections: 'excluded', text_styles: 'included', effect_styles: 'excluded',
    });
    // Pins 'included' against what the payload actually contains, not just
    // against the literal string: a textStyles-scoped copy covers them, so it
    // must still emit the text_styles block itself.
    expect(brief.text_styles).toBeDefined();
    expect(brief.text_styles!.length).toBeGreaterThan(0);
  });
});
