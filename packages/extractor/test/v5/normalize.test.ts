/**
 * Tests for the v4-to-v5 normalizer — Task 9 / spec §19.
 *
 * Every `V4_*` fixture below is hand-authored to match the REAL v4 shape
 * `foundationBrief`/`tokenOf`/`valueOf` produce (`packages/extractor/src/brief.ts`):
 * a token's `type` is `variable.resolvedType.toLowerCase()`, its `values` are
 * keyed by MODE DISPLAY NAME, and a mode value is one of v4's four flattened
 * shapes -- a bare string, a bare number, a `{hex, alpha}` object, or an
 * `{alias, resolved?, external?, collection?}` object (`valueOf`, brief.ts).
 * `unavailable` mirrors `FoundationSpec.unavailable` (`foundation.ts:137`).
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeV4, parseV4Path, syntheticId,
} from '../../src/v5/normalize';
import { validateLevel1, validateLevel2 } from '../../src/v5/validate';
import type { NormalizeMeta, V4Foundation } from '../../src/v5/normalize';
import type { CanonicalValue } from '../../src/v5/value';

const META: NormalizeMeta = { exportId: 'fixture-export', generatedAt: '2026-01-01T00:00:00.000Z' };

const V4_MINIMAL: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'color/bg/brand', type: 'string', values: { Value: 'ok' } },
      ],
    },
  ],
};

const V4_WITH_ALL_FOUR_SHAPES: V4Foundation = {
  collections: [
    {
      name: 'Primitives',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        // Bare string: an opaque colour (alpha 1), per valueOf's `v.alpha === 1 ? v.hex : ...`.
        { name: 'color/opaque', type: 'color', values: { Value: '#006b62' } },
        // `{hex, alpha}`: a translucent colour.
        { name: 'color/translucent', type: 'color', values: { Value: { hex: '#006b62', alpha: 0.5 } } },
        // Bare number: a float variable.
        { name: 'spacing/400', type: 'float', values: { Value: 16 } },
        // `{alias, resolved}`: a local alias with its concrete value already collapsed in.
        {
          name: 'color/alias-of-opaque',
          type: 'color',
          values: { Value: { alias: 'color/opaque', resolved: '#006b62' } },
        },
      ],
    },
  ],
};

const V4_WITH_FLOAT: V4Foundation = {
  collections: [
    {
      name: 'Spacing',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'spacing/400', type: 'float', values: { Value: 16 } },
      ],
    },
  ],
};

const V4_WITH_BAD_HEX: V4Foundation = {
  collections: [
    {
      name: 'Colors',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'color/broken', type: 'color', values: { Value: 'not-a-colour' } },
      ],
    },
  ],
};

// A qualified alias: v4 states BOTH a collection and a path. Real v4 emits a
// `collection` only for an alias it treats as external (valueOf's guard), so
// `resolved` is correctly absent here even though a same-named local token
// happens to exist -- see the "matched a token by name, but v4 recorded no
// value for it" branch in normalize.ts.
const V4_WITH_QUALIFIED_ALIAS: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        {
          name: 'color/accent',
          type: 'color',
          values: { Value: { alias: 'blue/500', external: true, collection: 'Colors' } },
        },
      ],
    },
    {
      name: 'Colors',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'blue/500', type: 'color', values: { Value: '#1a2b3c' } },
      ],
    },
  ],
};

// A bare, unqualified alias whose target path is unique across the whole
// file -- accepted per decision 3 step 2.
const V4_WITH_UNIQUE_NAME_ALIAS: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        {
          name: 'color/accent',
          type: 'color',
          values: { Value: { alias: 'colors/blue/500', resolved: '#1a2b3c' } },
        },
      ],
    },
    {
      name: 'Primitive',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'colors/blue/500', type: 'color', values: { Value: '#1a2b3c' } },
      ],
    },
  ],
};

// Two different collections both hold `colors/blue/500`, and a bare-name
// alias points at it. v4 cannot say which one it means, and neither can the
// normalizer -- it must report AMBIGUOUS_ALIAS_TARGET rather than pick one.
const V4_WITH_AMBIGUOUS_ALIAS: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        {
          name: 'color/accent',
          type: 'color',
          values: { Value: { alias: 'colors/blue/500', resolved: '#1a2b3c' } },
        },
      ],
    },
    {
      name: 'Primitive A',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'colors/blue/500', type: 'color', values: { Value: '#1a2b3c' } },
      ],
    },
    {
      name: 'Primitive B',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'colors/blue/500', type: 'color', values: { Value: '#1a2b3c' } },
      ],
    },
  ],
};

const V4_WITH_UNAVAILABLE_READ: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        { name: 'color/bg/brand', type: 'string', values: { Value: 'ok' } },
      ],
    },
  ],
  unavailable: ['Color base [deprecated]'],
};

const V4_WITH_CYRILLIC: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        {
          // The С in "Сhip" below is Cyrillic U+0421, not Latin C -- §21.1.8's
          // confusable-character fixture.
          name: `Background/Chip/${'С'}hip (Hover)`,
          type: 'string',
          values: { Value: 'ok' },
        },
      ],
    },
  ],
};

const V4_WITH_DECOMPOSED_NAME: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        // Decomposed ("Cafe" + combining acute), not the precomposed form --
        // do not "simplify" this to a plain 'Café' literal, that would defeat
        // the fixture.
        { name: `${'Café'.normalize('NFD')}/Surface`, type: 'string', values: { Value: 'ok' } },
      ],
    },
  ],
};

// Two modes are DECLARED and the token states a value for only one of them.
// v4 does this whenever a variable was never given a value in a mode.
const V4_WITH_UNSTATED_MODE: V4Foundation = {
  collections: [
    {
      name: 'Theme',
      modes: ['Light', 'Dark'],
      default_mode: 'Light',
      tokens: [
        { name: 'color/bg', type: 'color', values: { Light: '#ffffff' } },
      ],
    },
  ],
};

// A real v4 foundation brief: `foundationBrief` emits `text_styles` and
// `effect_styles` whenever the file has any (brief.ts:253-272).
const V4_WITH_COMPOSITE_STYLES: V4Foundation = {
  ...V4_MINIMAL,
  text_styles: [
    { name: 'Heading/H1', font: { family: 'Inter', style: 'Bold', size: 32 } },
    { name: 'Body/Default', font: { family: 'Inter', style: 'Regular', size: 16 } },
  ],
  effect_styles: [
    { name: 'Card/Shadow', effects: [] },
  ],
};

const V4_WITHOUT_DEFAULT_MODE: V4Foundation = {
  collections: [
    {
      name: 'Theme',
      modes: ['Light', 'Dark'],
      tokens: [
        { name: 'color/bg', type: 'color', values: { Light: '#ffffff', Dark: '#000000' } },
      ],
    },
  ],
};

const V4_WITH_UNRESOLVABLE_DEFAULT_MODE: V4Foundation = {
  collections: [
    {
      name: 'Theme',
      modes: ['Light', 'Dark'],
      // Names a mode the collection does not declare -- v4's own brief emits
      // `default_mode: undefined` for a deleted mode, but a hand-edited or
      // older document can carry a stale name outright.
      default_mode: 'Midnight',
      tokens: [
        { name: 'color/bg', type: 'color', values: { Light: '#ffffff', Dark: '#000000' } },
      ],
    },
  ],
};

const V4_WITH_ZERO_MODE_COLLECTION: V4Foundation = {
  collections: [
    { name: 'Empty', modes: [], tokens: [{ name: 'color/bg', type: 'color', values: {} }] },
  ],
};

// A cross-collection alias: the consuming token lives in "Semantic" under mode
// "Value", the target lives in "Primitive" whose modes are named differently,
// so a name match is impossible and the target collection's default mode is the
// only stated answer.
const V4_WITH_CROSS_COLLECTION_ALIAS: V4Foundation = {
  collections: [
    {
      name: 'Semantic',
      modes: ['Value'],
      default_mode: 'Value',
      tokens: [
        {
          name: 'color/accent',
          type: 'color',
          values: { Value: { alias: 'colors/blue/500', resolved: '#1a2b3c' } },
        },
      ],
    },
    {
      name: 'Primitive',
      modes: ['Base', 'Alt'],
      default_mode: 'Alt',
      tokens: [
        { name: 'colors/blue/500', type: 'color', values: { Base: '#1a2b3c', Alt: '#1a2b3c' } },
      ],
    },
  ],
};

describe('normalizeV4', () => {
  it('collapses all four v4 value shapes into one canonical shape', () => {
    // §21.1.6.
    const { artifact } = normalizeV4(V4_WITH_ALL_FOUR_SHAPES, META);
    for (const token of artifact.tokens) {
      for (const value of Object.values(token.values)) {
        expect(typeof value).toBe('object');
        expect(['literal', 'alias', 'missing']).toContain(value.kind);
      }
    }
  });

  it('mints injective ids that survive a separator inside a name', () => {
    // `figma-name:Color/color/bg/brand` is ambiguous: a token literally named
    // `bg/brand` in group `color` and one named `brand` in group `color/bg`
    // produce the same string. Percent-encoding each segment separates them.
    const a = syntheticId('token', 'Color', ['color', 'bg/brand']);
    const b = syntheticId('token', 'Color', ['color', 'bg', 'brand']);
    expect(a).not.toBe(b);
    expect(a).toBe('figma-name:token:Color/color/bg%2Fbrand');
    // The kind is in the id, so a token and a style with one path never collide.
    expect(syntheticId('style', 'Color', ['color', 'bg', 'brand'])).not.toBe(b);
  });

  it('marks synthetic identity with its own code', () => {
    const { diagnostics } = normalizeV4(V4_MINIMAL, META);
    const d = diagnostics.find((x) => x.code === 'SYNTHETIC_IDENTITY')!;
    expect(d.message).toContain('rename');
  });

  it('keeps a number and reports that its unit metadata is unavailable', () => {
    // The NUMBER is real data and must survive. The unit is not in a v4 export,
    // so the value takes the weaker `number` type and a dedicated code says
    // re-extraction is needed -- not UNSUPPORTED_VALUE_TYPE, which means a value
    // that cannot be represented at all.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_FLOAT, META);
    expect(Object.values(artifact.tokens[0].values)[0])
      .toEqual({ kind: 'literal', value: { type: 'number', value: 16 } });
    expect(diagnostics.map((d) => d.code)).toContain('UNIT_METADATA_UNAVAILABLE');
    expect(diagnostics.map((d) => d.code)).not.toContain('UNSUPPORTED_VALUE_TYPE');
  });

  it('emits missing plus INVALID_SOURCE_COLOR for a malformed colour', () => {
    const { artifact, diagnostics } = normalizeV4(V4_WITH_BAD_HEX, META);
    expect(Object.values(artifact.tokens[0].values)[0])
      .toEqual({ kind: 'missing', reason: 'invalid_source_value' });
    expect(diagnostics.map((d) => d.code)).toContain('INVALID_SOURCE_COLOR');
  });

  it('resolves a bare v4 alias by collection and path when both are available', () => {
    const { artifact } = normalizeV4(V4_WITH_QUALIFIED_ALIAS, META);
    const value = Object.values(artifact.tokens[0].values)[0];
    expect(value.kind).toBe('alias');
  });

  it('accepts a name-only alias match ONLY when it is unique', () => {
    const { artifact } = normalizeV4(V4_WITH_UNIQUE_NAME_ALIAS, META);
    expect(Object.values(artifact.tokens[0].values)[0].kind).toBe('alias');
  });

  it('reports ambiguity instead of taking the first match', () => {
    // Two collections holding `colors/blue/500`, and a bare-name alias. v4
    // cannot tell that apart from a real key -- and picking one silently is the
    // failure mode the whole artifact exists to prevent.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_AMBIGUOUS_ALIAS, META);
    const value: CanonicalValue = Object.values(artifact.tokens[0].values)[0];
    expect(value.kind).toBe('alias');
    if (value.kind === 'alias') expect(value.resolved.status).toBe('unresolved');
    expect(diagnostics.map((d) => d.code)).toContain('AMBIGUOUS_ALIAS_TARGET');
  });

  it('carries an unavailable v4 read into completeness and a diagnostic', () => {
    // v4's FoundationSpec already tracks these (`unavailable?: FoundationRead[]`,
    // foundation.ts:137), so the fact is available and must not be dropped.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_UNAVAILABLE_READ, META);
    expect(artifact.completeness.collections).toBe('partial');
    expect(artifact.completeness.unavailable_sources).toEqual(['Color base [deprecated]']);
    expect(diagnostics.map((d) => d.code)).toContain('SOURCE_PARTIALLY_UNAVAILABLE');
  });

  it('preserves a non-ASCII name and reports it', () => {
    // §21.1.8 -- the Cyrillic С in the Chip path.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_CYRILLIC, META);
    expect(artifact.tokens[0].name).toBe('Background/Chip/Сhip (Hover)');
    expect(diagnostics.map((d) => d.code)).toContain('CONFUSABLE_NAME');
  });

  it('normalizes to NFC without changing what a name says', () => {
    const { artifact } = normalizeV4(V4_WITH_DECOMPOSED_NAME, META);
    expect(artifact.tokens[0].name).toBe('Café/Surface'.normalize('NFC'));
  });

  it('respects the v4 escape when segmenting a path', () => {
    // v4 escaped a literal slash inside a node name as `\/`. A naive split
    // turns one segment into two.
    expect(parseV4Path('Icon\\/.animation/frame')).toEqual(['Icon/.animation', 'frame']);
  });

  it('produces the same semantic hash for two runs over one input', () => {
    const a = normalizeV4(V4_MINIMAL, { exportId: 'one', generatedAt: '2026-01-01T00:00:00.000Z' });
    const b = normalizeV4(V4_MINIMAL, { exportId: 'two', generatedAt: '2026-12-31T00:00:00.000Z' });
    expect(a.artifact.spec_layer.export.content_hash)
      .toBe(b.artifact.spec_layer.export.content_hash);
  });

  it('emits statistics computed from the finished artifact', () => {
    const { artifact } = normalizeV4(V4_WITH_ALL_FOUR_SHAPES, META);
    const stats = artifact.statistics as { tokens: number; aliases: { total: number } };
    expect(stats.tokens).toBe(artifact.tokens.length);
    expect(stats.aliases.total).toBe(
      artifact.tokens.flatMap((t) => Object.values(t.values))
        .filter((v) => v.kind === 'alias').length);
  });

  // -------------------------------------------------------------------------
  // §8.2 — one entry per DECLARED mode, or an explicit missing record.
  // -------------------------------------------------------------------------

  it('records an explicit missing value for a declared mode v4 never stated', () => {
    const { artifact, diagnostics } = normalizeV4(V4_WITH_UNSTATED_MODE, META);
    const collection = artifact.collections[0];
    const token = artifact.tokens[0];
    const darkId = collection.modes.find((m) => m.name === 'Dark')!.id;
    expect(Object.keys(token.values).sort()).toEqual(collection.modes.map((m) => m.id).sort());
    expect(token.values[darkId]).toEqual({ kind: 'missing', reason: 'no_value_for_mode' });
    expect(diagnostics.some((d) => d.code === 'MISSING_MODE_VALUE' && d.mode_id === darkId))
      .toBe(true);
  });

  it('produces an artifact that passes its own Level 2 mode-completeness check', () => {
    // The bug this closes: normalize iterated the modes v4 happened to STATE,
    // so a declared mode with no v4 entry got no key and no diagnostic --
    // and then validateLevel2 reported that same artifact as an error. The
    // normalizer and the validator disagreed about one artifact.
    for (const input of [V4_WITH_UNSTATED_MODE, V4_WITH_ALL_FOUR_SHAPES, V4_WITH_CROSS_COLLECTION_ALIAS]) {
      const { artifact } = normalizeV4(input, META);
      expect(validateLevel1(artifact)).toEqual([]);
      expect(validateLevel2(artifact).filter((d) => d.code === 'MISSING_MODE_VALUE')).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // Composite styles: not migrated, and not claimed absent either.
  // -------------------------------------------------------------------------

  it('reports v4 composite styles as unmigrated instead of claiming completeness', () => {
    // Phase 1 does not migrate text or effect styles (plan 3 owns them), but
    // `styles.typography: []` plus `completeness.styles: 'complete'` states
    // that the FILE has none. A consumer could not tell that from three styles
    // being thrown away.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_COMPOSITE_STYLES, META);
    expect(artifact.completeness.styles).toBe('partial');
    const d = diagnostics.find((x) => x.code === 'SOURCE_PARTIALLY_UNAVAILABLE')!;
    expect(d.details).toEqual({ typography_not_migrated: 2, effects_not_migrated: 1 });
    // The payload itself is unchanged -- the honesty is in `completeness`,
    // which is hashed, so the two exports are different artifacts.
    expect(artifact.styles).toEqual({ typography: [], effects: [] });
    expect(artifact.spec_layer.export.content_hash)
      .not.toBe(normalizeV4(V4_MINIMAL, META).artifact.spec_layer.export.content_hash);
  });

  it("says 'complete' only when the input genuinely states no composite styles", () => {
    const { artifact, diagnostics } = normalizeV4(V4_MINIMAL, META);
    expect(artifact.completeness.styles).toBe('complete');
    expect(diagnostics.some((d) => d.code === 'SOURCE_PARTIALLY_UNAVAILABLE')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The collection default mode is never substituted silently.
  // -------------------------------------------------------------------------

  it('reports, rather than invents, a default mode v4 does not state', () => {
    const { artifact, diagnostics } = normalizeV4(V4_WITHOUT_DEFAULT_MODE, META);
    const collection = artifact.collections[0];
    // NOT modes[0]: that would state a default the designer never chose, in a
    // form no validation level can distinguish from a real one.
    expect(collection.modes.map((m) => m.id)).not.toContain(collection.default_mode_id);
    const d = diagnostics.find((x) => x.code === 'UNRESOLVED_REFERENCE')!;
    expect(d.entity_id).toBe(collection.id);
    // A visibly invalid artifact plus a diagnostic beats a plausible fake, so
    // Level 2 must reject what normalize emitted here.
    expect(validateLevel2(artifact).some((x) => x.code === 'UNRESOLVED_REFERENCE')).toBe(true);
  });

  it('reports a stated default mode that resolves to no declared mode', () => {
    const { artifact, diagnostics } = normalizeV4(V4_WITH_UNRESOLVABLE_DEFAULT_MODE, META);
    const d = diagnostics.find((x) => x.code === 'UNRESOLVED_REFERENCE')!;
    // The STATED value is carried into the details rather than discarded --
    // silently replacing it with modes[0] threw away the only evidence that
    // the source said anything at all.
    expect(d.details?.stated_default_mode).toBe('Midnight');
    expect(artifact.collections[0].modes.map((m) => m.id))
      .not.toContain(artifact.collections[0].default_mode_id);
  });

  it('never puts a token id, or any non-mode id, in a zero-mode collection', () => {
    const { artifact, diagnostics } = normalizeV4(V4_WITH_ZERO_MODE_COLLECTION, META);
    const collection = artifact.collections[0];
    expect(collection.modes).toEqual([]);
    // The old fallback chain ended in `?? id`, putting the COLLECTION's own id
    // into default_mode_id -- a mode that does not exist, in a shape that
    // passed both validation levels.
    expect(collection.default_mode_id).not.toBe(collection.id);
    expect(collection.default_mode_id).not.toBe(artifact.tokens[0].id);
    expect(diagnostics.some((d) => d.code === 'UNRESOLVED_REFERENCE')).toBe(true);
    expect(validateLevel2(artifact).some((d) => d.code === 'UNRESOLVED_REFERENCE')).toBe(true);
  });

  it('resolves a cross-collection hop through the TARGET collection default mode', () => {
    // Mode ids are collection-scoped, and Figma resolves a cross-collection
    // alias through the target collection's own mode selection. normalize and
    // validate must apply one rule here or they answer the same question two
    // ways -- see convertAlias and walkAliasGraph's modeAfterHop.
    const { artifact } = normalizeV4(V4_WITH_CROSS_COLLECTION_ALIAS, META);
    const primitive = artifact.collections.find((c) => c.name === 'Primitive')!;
    const altId = primitive.modes.find((m) => m.name === 'Alt')!.id;
    expect(primitive.default_mode_id).toBe(altId);
    const value = Object.values(artifact.tokens[0].values)[0];
    expect(value.kind).toBe('alias');
    if (value.kind === 'alias' && value.resolved.status === 'resolved') {
      expect(value.resolved.chain).toEqual([{ token_id: artifact.tokens[1].id, mode_id: altId }]);
    } else {
      throw new Error('expected a resolved alias');
    }
    // And the artifact normalize produced passes its own alias walk.
    expect(validateLevel2(artifact)).toEqual([]);
  });

  it('runs the artifact diagnostics through sortDiagnostics before returning them', () => {
    // Review finding on Task 8: validateLevel1/2 return diagnostics unsorted,
    // so the normalizer's OWN output must be sorted itself rather than
    // inheriting discovery order from the two walks that built it.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_ALL_FOUR_SHAPES, META);
    const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2 };
    for (let i = 1; i < artifact.diagnostics.length; i += 1) {
      const prev = artifact.diagnostics[i - 1];
      const curr = artifact.diagnostics[i];
      expect(severityRank[prev.severity]).toBeLessThanOrEqual(severityRank[curr.severity]);
    }
    expect(artifact.diagnostics).toEqual(diagnostics);
  });
});
