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
