import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { specContentHash, extract } from '../src/index';
import type { SerializedNode } from '../src/index';

// Minimal serialized COMPONENT: a frame with one text child, no variables.
const NODE: SerializedNode = {
  id: '1:1', name: 'Button', type: 'COMPONENT',
  children: [{ id: '1:2', name: 'Label', type: 'TEXT', characters: 'Click' }],
} as unknown as SerializedNode;

describe('specContentHash', () => {
  it('is stable and ignores rawValues + deep anatomy', () => {
    const spec = extract(NODE, { figmaFile: 'FILEKEY' });
    const h1 = specContentHash(spec);

    // rawValues is presentation-only → must not affect the hash.
    const withRaw = { ...spec, rawValues: [{ part: 'Label', property: 'color', value: '#fff' }] };
    expect(specContentHash(withRaw as typeof spec)).toBe(h1);

    // A deep (depth>0) anatomy part is canvas-only → must not affect the hash.
    const withDeep = {
      ...spec,
      anatomy: [...spec.anatomy, { id: '1:3', name: 'Icon', type: 'FRAME', nested: false, depth: 1 }],
    };
    expect(specContentHash(withDeep as typeof spec)).toBe(h1);

    // It is a 64-char hex SHA-256.
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

/** Re-cut on 2026-08-19 by Task 8: gap issue strings became stable ids, which
 *  is a real content change, so every existing component doc legitimately shows
 *  "update available" once. It must settle after a single Update.
 *  Every component doc on canvas stores a baseline computed this way, so a change
 *  to this constant means every one of them reports drift. Only a task that says
 *  it re-cuts the baseline may change it. */
const BUTTON_HASH_V2 = 'b49b6a3dd3b50fe73c7b2ced8e64f25517e4f56383746e455e338335bd5a873d';

it('is unchanged by removing the contrast field', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  expect(specContentHash(spec)).toBe(BUTTON_HASH_V2);
});

it('is unchanged by adding paths to tokens and gaps', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  expect(spec.tokens[0].path).toBeTruthy();            // the field exists
  expect(specContentHash(spec)).toBe(BUTTON_HASH_V2);  // and does not enter the hash
});
