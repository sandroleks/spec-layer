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
