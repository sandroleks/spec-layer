import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildFoundation, buildFoundationArtifactV5,
  type FoundationArtifactV5, type SerializedFoundation,
} from '../../src/index';

const SERIALIZED = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-serialized.json', import.meta.url),
);

/** A fresh direct-path artifact from the publishable synthetic fixture. */
export function syntheticArtifact(): FoundationArtifactV5 {
  const serialized = JSON.parse(readFileSync(SERIALIZED, 'utf8')) as SerializedFoundation;
  return buildFoundationArtifactV5(buildFoundation(serialized), {
    exportId: 'dtcg-test', generatedAt: '2026-09-03T00:00:00.000Z', build: null,
  }).artifact;
}

/** Reads an object at a dotted path inside a tree, or undefined. */
export function leaf(tree: unknown, path: string): Record<string, unknown> | undefined {
  let node: unknown = tree;
  for (const seg of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'object' && node !== null ? node as Record<string, unknown> : undefined;
}

/**
 * Mirrors Mapped Radius.rd-sm -> Foundation.radius.300 from a real pull:
 * rd-sm is scoped CORNER_RADIUS, so Figma's own resolution types its
 * "resolved" snapshot as a dimension (a real spec-layer.meta.json holds
 * exactly `resolved: { value: 8, unit: "px" }` for it) -- but the direct
 * alias target carries no such scope, so ITS own literal is a bare number.
 * DTCG requires the two to agree. Shared by dtcg.test.ts (the repair itself)
 * and css.test.ts (that the repair reaches CSS as a real length).
 */
export function radiusMismatchArtifact(): FoundationArtifactV5 {
  const artifact = syntheticArtifact();
  const foundation = artifact.collections.find((c) => c.id === 'CollectionID:primitives');
  const radius = artifact.collections.find((c) => c.id === 'CollectionID:semantic');
  if (!foundation || !radius) throw new Error('fixture lost Primitives/Semantic');
  foundation.name = 'Foundation';
  radius.name = 'Radius';

  const target = artifact.tokens.find((t) => t.id === 'VariableID:unknown-number');
  if (!target) throw new Error('fixture lost Primitives.number.unknown-scope');
  target.name = 'radius/300';
  target.values['ModeID:p-light'] = { kind: 'literal', value: { type: 'number', value: 8 } };

  const owner = artifact.tokens.find((t) => t.id === 'VariableID:gap');
  if (!owner) throw new Error('fixture lost Primitives.spacing.gap');
  owner.name = 'rd-sm';
  owner.scopes = ['CORNER_RADIUS'];
  owner.collection_id = radius.id;
  owner.values = {
    'ModeID:s-light': {
      kind: 'alias',
      reference: {
        target_id: target.id, target_collection_id: foundation.id,
        target_path: ['radius', '300'], external: false,
      },
      resolved: {
        status: 'resolved',
        value: { type: 'dimension', number: 8, unit: 'px' },
        chain: [{ token_id: target.id, mode_id: 'ModeID:p-light' }],
      },
    },
  };
  return artifact;
}
