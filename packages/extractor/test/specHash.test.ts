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

/** Re-cut on 2026-08-19 by Task 8: gap issue strings became stable ids (fixing
 *  `unbound` contradicting `tokens`) and gap properties were aligned with the
 *  token path's own vocabulary. Real content changes, so this supersedes the
 *  pre-v2-brief value `d445791b...` once: every existing component doc
 *  legitimately reports "update available" a single time, and must settle
 *  after a single Update. Every component doc on canvas stores a baseline
 *  computed this way, so a change to this constant means every one of them
 *  reports drift. Only a task that says it re-cuts the baseline may change it. */
const BUTTON_HASH = 'adcffcb7d2eec911d960bb883794cf1e387d8b8d729064670b708abce8490516';

it('is unchanged by removing the contrast field', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  expect(specContentHash(spec)).toBe(BUTTON_HASH);
});

it('is unchanged by adding paths to tokens and gaps', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  expect(spec.tokens[0].path).toBeTruthy();            // the field exists
  expect(specContentHash(spec)).toBe(BUTTON_HASH);  // and does not enter the hash
});
