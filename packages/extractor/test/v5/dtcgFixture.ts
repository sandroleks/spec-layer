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
