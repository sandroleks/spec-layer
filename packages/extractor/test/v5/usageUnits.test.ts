import { describe, expect, it } from 'vitest';
import { buildEnvelope, type FoundationArtifactV5, type SemanticPayload } from '../../src/v5/canonical';
import type { CollectionV5, TokenV5 } from '../../src/v5/entities';
import type { LibraryBundleArtifact, LibraryBundleV1 } from '../../src/libraryBundle';
import type { ComponentBindingV5 } from '../../src/v5/componentContext';
import { usageUnits } from '../../src/v5/usageUnits';

const SOURCE = {
  provider: 'figma' as const,
  file_id: 'FILE1', file_name: 'Design System', file_version: null, library_enabled: null,
};

const modeOf = (collectionId: string): string => `${collectionId}:mode`;

const collection = (id: string, name: string): CollectionV5 => ({
  id, name, path: [name], default_mode_id: modeOf(id),
  modes: [{ id: modeOf(id), name: 'Default', order: 0 }],
});

/** A FLOAT variable the projection writes as a bare number: no unit-pinning scope. */
function numberToken(
  id: string, collectionId: string, name: string, value: number, scopes: string[] = [],
): TokenV5 {
  return {
    id, collection_id: collectionId, name, path: name.split('/'),
    type: 'number', description: '', scopes,
    values: { [modeOf(collectionId)]: { kind: 'literal', value: { type: 'number', value } } },
  };
}

/** A token whose value in its one mode aliases `target`. */
function aliasToken(
  id: string, collectionId: string, name: string, target: TokenV5, scopes: string[] = [],
): TokenV5 {
  return {
    id, collection_id: collectionId, name, path: name.split('/'),
    type: 'number', description: '', scopes,
    values: {
      [modeOf(collectionId)]: {
        kind: 'alias',
        reference: {
          target_id: target.id, target_collection_id: target.collection_id,
          target_path: target.path, external: false,
        },
        resolved: {
          status: 'resolved',
          value: { type: 'number', value: 0 },
          chain: [{ token_id: target.id, mode_id: modeOf(target.collection_id) }],
        },
      },
    },
  };
}

function foundationWith(collections: CollectionV5[], tokens: TokenV5[]): FoundationArtifactV5 {
  const payload: SemanticPayload = {
    completeness: { collections: 'complete', styles: 'complete', unavailable_sources: [] },
    collections, tokens, styles: { typography: [], effects: [] },
  };
  return {
    ...payload,
    spec_layer: buildEnvelope(payload, {
      exportId: 'foundation:1', generatedAt: '2026-09-11T00:00:00.000Z', build: null, source: SOURCE,
    }),
    diagnostics: [], statistics: {},
  };
}

/** Only `references.bindings` matters here, so the rest of the artifact stays out. */
function componentWith(bindings: Array<Partial<ComponentBindingV5>>): LibraryBundleArtifact {
  return {
    spec_layer: { export: { content_hash: 'c'.repeat(64) } },
    references: {
      used: [],
      bindings: bindings.map((b) => ({ path: 'Container', kind: 'variable' as const, ...b })),
    },
  } as unknown as LibraryBundleArtifact;
}

function bundleWith(
  foundation: FoundationArtifactV5 | null,
  components: Array<{ name: string; artifact: LibraryBundleArtifact }> = [],
): LibraryBundleV1 {
  return {
    schema: 'spec-layer-library-bundle', version: '1.0.0',
    fileName: 'DS', pluginVersion: '5.1.0', extractorVersion: '2',
    foundation: foundation === null
      ? null
      : { ai: '', artifact: foundation as unknown as LibraryBundleArtifact },
    components: components.map((c) => ({ name: c.name, ai: '', artifact: c.artifact })),
  };
}

describe('usageUnits: alias-scope evidence', () => {
  it('derives px for a primitive that a scope-pinned alias points at', () => {
    const foundation = collection('CollectionID:foundation', 'Foundation');
    const radius = collection('CollectionID:radius', 'Radius');
    const primitive = numberToken('VariableID:radius-300', foundation.id, 'radius/300', 8);
    const scoped = aliasToken('VariableID:rd-sm', radius.id, 'rd-sm', primitive, ['CORNER_RADIUS']);

    const map = usageUnits(bundleWith(foundationWith([foundation, radius], [primitive, scoped])));

    expect(map.get('VariableID:radius-300')).toEqual({
      unit: 'px', via: 'alias-scope', source: 'Radius.rd-sm', reason: 'CORNER_RADIUS',
    });
  });
});

describe('usageUnits: contradicting evidence', () => {
  it('derives nothing when a unitless-number scope and a length scope point at one primitive', () => {
    // number/1 used as both full opacity and a hairline stroke. OPACITY states
    // "unitless number" exactly as CORNER_RADIUS states "px" (units.ts), so the
    // two aliases disagree and the primitive has no single answer. Taking the
    // px side would write `opacity: 1px`, which no report would name.
    const f = collection('CollectionID:f', 'F');
    const primitive = numberToken('VariableID:c', f.id, 'number/1', 1);
    const opacity = aliasToken('VariableID:a', f.id, 'opacity/full', primitive, ['OPACITY']);
    const stroke = aliasToken('VariableID:b', f.id, 'stroke/hairline', primitive, ['STROKE_FLOAT']);

    const map = usageUnits(bundleWith(foundationWith([f], [primitive, opacity, stroke])));

    expect(map.get('VariableID:c')).toBeUndefined();
  });

  it('lets a contradiction one alias hop away refute a length binding', () => {
    // One component binds a fade token to opacity, another binds a size token
    // to height, and both alias the same primitive. Evidence travels down the
    // alias chain, so refutation has to travel with it.
    const f = collection('CollectionID:f', 'F');
    const primitive = numberToken('VariableID:p', f.id, 'number/1', 1);
    const fade = aliasToken('VariableID:s', f.id, 'semantic/fade', primitive);
    const size = aliasToken('VariableID:t', f.id, 'semantic/size', primitive);

    const map = usageUnits(bundleWith(
      foundationWith([f], [primitive, fade, size]),
      [
        { name: 'Fade', artifact: componentWith([{ property: 'opacity', source_id: fade.id }]) },
        { name: 'Box', artifact: componentWith([{ property: 'height', source_id: size.id }]) },
      ],
    ));

    expect(map.get('VariableID:p')).toBeUndefined();
    expect(map.get('VariableID:s')).toBeUndefined();
    // The size token's own binding is not in doubt; only what it aliases is.
    expect(map.get('VariableID:t')?.via).toBe('binding');
  });

  it('does not carry evidence past a token whose own scopes answer', () => {
    // A CORNER_RADIUS token aliasing a GAP token aliasing a primitive: the GAP
    // token states its own unit and pins its own chain, so nothing needs to
    // reach through it, and nothing does. The names are chosen so the radius
    // token sorts FIRST: without the barrier it would win the tie and cite a
    // scope two hops away as the reason.
    const f = collection('CollectionID:f', 'F');
    const primitive = numberToken('VariableID:leaf', f.id, 'number/2', 2);
    const gap = aliasToken('VariableID:mid', f.id, 'zz/gap-sm', primitive, ['GAP']);
    const radius = aliasToken('VariableID:top', f.id, 'aa/radius-sm', gap, ['CORNER_RADIUS']);

    const map = usageUnits(bundleWith(foundationWith([f], [primitive, gap, radius])));

    expect(map.get('VariableID:leaf')).toEqual({
      unit: 'px', via: 'alias-scope', source: 'F.zz.gap-sm', reason: 'GAP',
    });
  });
});

describe('usageUnits: binding evidence', () => {
  it('derives px through an alias hop when a component binds the alias to a length', () => {
    const foundation = collection('CollectionID:foundation', 'Foundation');
    const density = collection('CollectionID:density', 'Density');
    const primitive = numberToken('VariableID:spacing-900', foundation.id, 'spacing/900', 36);
    const semantic = aliasToken(
      'VariableID:button-lg-height', density.id, 'button/lg-height', primitive, ['ALL_SCOPES'],
    );

    const map = usageUnits(bundleWith(
      foundationWith([foundation, density], [primitive, semantic]),
      [{ name: 'buttonPrimary', artifact: componentWith([{ property: 'height', source_id: semantic.id }]) }],
    ));

    expect(map.get('VariableID:button-lg-height')?.via).toBe('binding');
    expect(map.get('VariableID:button-lg-height')?.source).toBe('buttonPrimary');
    expect(map.get('VariableID:button-lg-height')?.reason).toBe('height');
    expect(map.get('VariableID:spacing-900')?.unit).toBe('px'); // through the alias hop
  });

  it('returns no answer when evidence conflicts', () => {
    const c = collection('CollectionID:f', 'F');
    const token = numberToken('VariableID:x', c.id, 'x', 1);

    const map = usageUnits(bundleWith(
      foundationWith([c], [token]),
      [{
        name: 'c',
        artifact: componentWith([
          { path: 'A', property: 'gap', source_id: token.id },
          { path: 'B', property: 'opacity', source_id: token.id },
        ]),
      }],
    ));

    expect(map.get('VariableID:x')).toBeUndefined();
  });
});
