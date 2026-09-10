import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { specContentHash, specHashProjection, contentHash, canonicalEqual, extract } from '../src/index';
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
 *  that says it re-cuts the baseline may change it, and no task in this plan does.
 *  Re-derived from cf299fb, the merge base of the hidden-elements branch, and
 *  unchanged, so it also serves as the pre-feature value for that branch. */
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

describe('specHashProjection', () => {
  it('is exactly the object specContentHash hashes, on every fixture', () => {
    for (const file of ['packages/extractor/test/fixtures/button.json', 'packages/extractor/test/fixtures/chip.json']) {
      const spec = extract(JSON.parse(readFileSync(file, 'utf8')), { figmaFile: 'FILE1' });
      expect(contentHash(specHashProjection(spec))).toBe(specContentHash(spec));
    }
    expect(contentHash(specHashProjection(extract(NODE, { figmaFile: 'FILEKEY' }))))
      .toBe(specContentHash(extract(NODE, { figmaFile: 'FILEKEY' })));
  });

  it('keeps the legacy token key and leaves rawValues, nodeEffects and the file name out', () => {
    const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
    const spec = extract(node, { figmaFile: 'FILE1', figmaFileName: 'Design System' });
    const projection = specHashProjection(spec);
    const keys = Object.keys(projection);
    expect(keys).not.toContain('rawValues');
    expect(keys).not.toContain('nodeEffects');
    expect(keys).not.toContain('figmaFileName');
    expect(projection.tokens.length).toBeGreaterThan(0);
    for (const rule of projection.tokens) {
      expect(Object.keys(rule).sort()).toEqual(['conditions', 'part', 'property', 'token']);
    }
    for (const part of projection.anatomy) {
      expect(Object.keys(part).sort()).toEqual(['id', 'name', 'nested', 'type']);
    }
  });
});

describe('canonicalEqual', () => {
  it('ignores key order and undefined-valued keys, and is otherwise strict', () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 1 }, { a: '1' })).toBe(false);
    expect(canonicalEqual([1, 2], [2, 1])).toBe(false);
    expect(canonicalEqual(null, undefined)).toBe(false);
  });
});

describe('specContentHash and parts hidden by default', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/chip-hidden.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });

  it('excludes property-bound hidden parts unless asked, so a doc with the toggle off hashes as before', () => {
    expect(specHashProjection(spec).anatomy.map((p) => p.name)).toEqual(['Label']);
    expect(specHashProjection(spec, {})).toEqual(specHashProjection(spec));
    expect(specHashProjection(spec, { includeHidden: false })).toEqual(specHashProjection(spec));
    expect(specContentHash(spec)).toBe(contentHash(specHashProjection(spec)));
  });

  it('includes the revealed depth-0 parts when asked, and nothing deeper', () => {
    const projection = specHashProjection(spec, { includeHidden: true });
    // Layer order, so the drawn callouts and the hashed list agree.
    expect(projection.anatomy.map((p) => p.name)).toEqual(['Icon left', 'Label', 'Icon right']);
    expect(specContentHash(spec, { includeHidden: true })).toBe(contentHash(projection));
    expect(specContentHash(spec, { includeHidden: true })).not.toBe(specContentHash(spec));
  });

  it('leaves related out of the toggle: it is computed from parts shown by default', () => {
    expect(specHashProjection(spec, { includeHidden: true }).related).toEqual(specHashProjection(spec).related);
  });

  it('filters token rules by the same flag, so the drawn table and the baseline agree', () => {
    // The chip-hidden fixture carries no bindings, so this builds the case
    // directly: a bound hidden icon beside a bound visible label.
    const bound = JSON.parse(readFileSync('packages/extractor/test/fixtures/chip-hidden.json', 'utf8')) as SerializedNode;
    const variant = bound.children![0];
    variant.children![0].bindings = [
      { property: 'fills', id: 'VariableID:80', name: 'Role/Text/Accent', kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1' },
    ];
    variant.children![1].bindings = [
      { property: 'fills', id: 'VariableID:81', name: 'Role/Text/Default', kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1' },
    ];
    const withBindings = extract(bound, { figmaFile: 'FILE1' });

    expect(specHashProjection(withBindings).tokens.map((t) => t.token))
      .toEqual(['Role/Text/Default']);
    expect(specHashProjection(withBindings, { includeHidden: true }).tokens.map((t) => t.token))
      .toEqual(['Role/Text/Accent', 'Role/Text/Default']);
    // No `shownBy` key in the projection: a rule's presence in the array is
    // what the hash needs, and every committed baseline predates the field.
    for (const row of specHashProjection(withBindings, { includeHidden: true }).tokens) {
      expect('shownBy' in row).toBe(false);
    }
  });
});

/** Pre-feature canvas hash of chip-hidden.json, computed at cf299fb (the merge
 *  base of the hidden-elements branch) with this fixture copied into a
 *  throwaway worktree, so the pre-feature extractor simply ignored
 *  `visibleProperty`. Together with CHIP_HASH above, which was computed the
 *  same way and matched, it proves the toggle-off path is byte-identical to
 *  what shipped: one fixture that carries hidden bound layers and one that
 *  carries none. A change here means every committed component doc reports an
 *  update it did not earn. */
const CHIP_HIDDEN_OFF_HASH = '5929fb9a46b5c4258933b2068efc89d3c4eb5c0b072eae334ba2b75ebca441ff';

describe('the toggle-off canvas hash matches the pre-feature extractor', () => {
  it('is unchanged on a fixture with no hidden bound layers', () => {
    const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/chip.json', 'utf8'));
    expect(specContentHash(extract(node, { figmaFile: 'FILE1' }))).toBe(CHIP_HASH);
  });

  it('is unchanged on a fixture full of hidden bound layers, by default and when asked', () => {
    const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/chip-hidden.json', 'utf8'));
    const spec = extract(node, { figmaFile: 'FILE1' });
    expect(specContentHash(spec)).toBe(CHIP_HIDDEN_OFF_HASH);
    expect(specContentHash(spec, { includeHidden: false })).toBe(CHIP_HIDDEN_OFF_HASH);
  });
});
