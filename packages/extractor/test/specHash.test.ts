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

it('is unchanged by the Figma file name', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const named = extract(node, { figmaFile: 'FILE1', figmaFileName: 'Design System' });
  const renamed = extract(node, { figmaFile: 'FILE1', figmaFileName: 'Design System (2026)' });
  expect(named.figmaFileName).toBe('Design System');      // the field exists
  expect(specContentHash(named)).toBe(BUTTON_HASH);       // and does not enter the hash
  expect(specContentHash(renamed)).toBe(BUTTON_HASH);     // so a rename is not drift
});

/** Cut on 2026-08-25 before Phase A of the brief-resolution-fidelity plan, from
 *  the tree as it stood at BRIEF_VERSION 3. Its whole job is to fail loudly if
 *  the `token` to `name` rename, the ref-keyed minimization, or the composite-key
 *  change moves the drift baseline. Same rule as BUTTON_HASH above: only a task
 *  that says it re-cuts the baseline may change it, and no task in this plan does. */
const CHIP_HASH = 'f2f7e6432f44b8405f31a9094a7494bdf89f68483a52dedd222a0d48e006d12b';

it('is unchanged across the whole of Phase A, on both fixtures', () => {
  for (const [file, expected] of [
    ['packages/extractor/test/fixtures/button.json', BUTTON_HASH],
    ['packages/extractor/test/fixtures/chip.json', CHIP_HASH],
  ] as const) {
    const node = JSON.parse(readFileSync(file, 'utf8'));
    expect(specContentHash(extract(node, { figmaFile: 'FILE1' }))).toBe(expected);
  }
});

it('is unchanged by nodeEffects', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  const withEffects = {
    ...spec,
    nodeEffects: [{ part: 'Container', path: 'Container', effects: [{ type: 'unknown', figma_type: 'X' }] }],
  };
  // Same contract as rawValues: additive detail that alters no rendered output
  // must never mark a committed document as drifted.
  expect(specContentHash(withEffects as typeof spec)).toBe(BUTTON_HASH);
});
