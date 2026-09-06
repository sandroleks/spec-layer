# Library Semantic Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Review detected changes" in the Library list what changed, item by item with before and after values, by storing the hash projection as a baseline on each generated Section and diffing it against the live projection.

**Architecture:** The diff input is the hash input. `specContentHash` is refactored to hash a new exported `specHashProjection(spec)`, and `foundationContentHash` already hashes `unitContent()`. Each doc Section stores that projection under a new plugin data key beside the doc link, written in the same commit. A pure, Figma-free `diff.ts` in the extractor turns two projections into `ChangeGroup[]`. The UI requests the baseline lazily when a drifted row is expanded and renders four change states.

**Tech Stack:** TypeScript, Vitest, npm workspaces (`@spec-layer/extractor`, `@spec-layer/plugin`), Figma Plugin API (`setPluginData`/`getPluginData`), esbuild.

**Spec:** `docs/superpowers/specs/2026-09-06-library-semantic-diff-design.md`. Read it before starting any task.

## Global Constraints

- Nothing here changes `specContentHash`, `foundationContentHash`, `EXTRACTOR_VERSION` (currently `'2'`), any v5 schema, or any v5 artifact. The golden hashes in `packages/extractor/test/specHash.test.ts` (`BUTTON_HASH`, `CHIP_HASH`) must not change.
- The extractor is Figma-free: nothing under `packages/extractor/src` may reference `figma`, `window`, `document`, or `TextEncoder`.
- The plugin main thread (`packages/plugin/src/main.ts` and everything it imports, including `docLink.ts`) has no browser globals. `npm run check:sandbox` scans the built bundle. Use the existing `utf8ByteLength` helper in `docLink.ts`, never `TextEncoder`.
- Do not use `localeCompare` in new code. Where a sort is needed use `compareCodeUnits` from `packages/extractor/src/v5/diagnostics.ts` (re-exported from `./v5/index`). Output order from `diffKeyed` follows input order, so most callers never sort.
- Never emit a raw NUL byte (the `\0` escape, or a literal control character that lint, tests, and `git diff` all hide) in any source or doc. Build composite keys with `JSON.stringify([...])`.
- Plugin UI copy: sentence case, second person, no em dashes (the character `—` is forbidden in `packages/plugin/src/ui/**`), honest about limits. Value transitions are spelled "changed to", never an arrow. See `docs/plugin-voice-and-copy.md`.
- Never fabricate: an unresolved foundation value renders as `unresolved (<reason>)`, never a guessed number. An over-budget baseline is dropped whole (serializes to `''`), never truncated.
- `DOC_BASELINE_KEY = 'specLayerBaseline'`, `BASELINE_BUDGET_BYTES = 90 * 1024`.
- Commits: single line, lowercase, conventional, scoped, e.g. `feat(extractor): add diffKeyed`. Do not commit `CHANGELOG.md` changes until Task 10.
- Run the named test file after each step with `npx vitest run <path>`; run `npm run check` once at the end of Task 9 and Task 10.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/extractor/src/hash.ts` (modify) | Adds `SpecHashProjection`, `specHashProjection()`, `canonicalEqual()`. `specContentHash` becomes `contentHash(specHashProjection(spec))`. |
| `packages/extractor/src/diff.ts` (create) | Pure diff engine: `diffKeyed`, `ChangeGroup`, `componentChangeGroups`, `foundationChangeGroups`, value formatters. |
| `packages/extractor/src/index.ts` (modify) | `export * from './diff'`. |
| `packages/extractor/test/specHash.test.ts` (modify) | Projection/hash equality on every fixture; `canonicalEqual`. |
| `packages/extractor/test/diff.test.ts` (create) | All diff engine tests. |
| `packages/plugin/src/docLink.ts` (modify) | `DOC_BASELINE_KEY`, `BASELINE_BUDGET_BYTES`, baseline types, `serializeBaseline`, `parseBaseline`, `baselineFor`. |
| `packages/plugin/test/docLink.test.ts` (modify) | Baseline storage tests. |
| `packages/plugin/src/messages.ts` (modify) | `renderDocFrame.baseline`, `requestDocBaseline`, `docBaseline`. |
| `packages/plugin/src/ui/actions.ts` (modify) | Both `renderDocFrame` send sites add `baseline`. |
| `packages/plugin/test/fromSource.test.ts` (modify) | Asserts the Update path sends a baseline whose hash is the message's `contentHash`. |
| `packages/plugin/src/main.ts` (modify) | Three write points, detach clear, `requestDocBaseline` handler. |
| `packages/plugin/src/ui/viewModel/library.ts` (modify) | `LibraryChangeState`, `LibraryChangeResult`, `resolveLibraryChanges`, row fields. |
| `packages/plugin/src/ui/viewModel/contracts.ts` (modify) | `ChangeGroup` becomes a re-export of the extractor type. |
| `packages/plugin/test/libraryViewModel.test.ts` (modify) | Change state and resolver tests. |
| `packages/plugin/src/ui/screens/library.ts` (modify) | Renders the four change states and three fallback lines. |
| `packages/plugin/test/libraryScreen.test.ts` (modify) | Panel body tests. |
| `packages/plugin/src/ui/ui-vnext.ts` (modify) | `libraryLiveProjection`, `libraryChanges`, `toggleLibraryReview`, `docBaseline` handler. |
| `CHANGELOG.md`, `ARCHITECTURE.md`, `docs/plugin-knowledge-map.md`, `docs/reviews/2026-09-05-major-review.md`, `packages/plugin/TESTING.md`, the spec (modify) | Documentation, Task 10. |

---

### Task 1: `specHashProjection` and `canonicalEqual` in `hash.ts`

**Files:**
- Modify: `packages/extractor/src/hash.ts`
- Test: `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export interface SpecHashProjection { name: string; figmaKey: string; figmaFile: string; figmaNode: string; anatomyComponentId: string; anatomy: { id: string; name: string; type: string; nested: boolean }[]; props: ComponentProp[]; variants: VariantAxis[]; variantInstances: VariantInstance[]; states: string[]; tokens: { part: string; property: string; conditions: Record<string, string[]>; token: string }[]; related: string[]; gaps: { part: string; property: string; issue: GapIssue; value?: number | string }[]; layout: { part: string; summary: string }[] }`
  - `export function specHashProjection(spec: IntermediateSpec): SpecHashProjection`
  - `export function specContentHash(spec: IntermediateSpec): string` (unchanged signature and output)
  - `export function canonicalEqual(a: unknown, b: unknown): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/specHash.test.ts`. Change the import line at the top to:

```ts
import { specContentHash, specHashProjection, contentHash, canonicalEqual, extract } from '../src/index';
```

Append at the end of the file:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/specHash.test.ts`
Expected: FAIL. The import of `specHashProjection` and `canonicalEqual` resolves to `undefined` and the new tests throw `TypeError: specHashProjection is not a function`.

- [ ] **Step 3: Refactor `hash.ts`**

Replace the imports at the top of `packages/extractor/src/hash.ts` with:

```ts
import { sha256 } from 'js-sha256';
import type { IntermediateSpec, VariantInstance } from './extract';
import type { ComponentProp, VariantAxis } from './props';
import type { GapIssue } from './tokens';
import { unitContent, type FoundationSpec, type FoundationScope } from './foundation';
```

After `export const contentHash = ...` add:

```ts
/**
 * "Would hash the same": two values are equal when their canonical
 * serializations match. Key order and undefined-valued keys are ignored,
 * exactly as contentHash ignores them. This is the equality the Library diff
 * uses, so "changed" in a change list means precisely "moved the hash".
 */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/**
 * The object specContentHash hashes. Exported so the Library can store it as a
 * doc's drift baseline and diff it later: the diff input IS the hash input, so
 * a change list can never disagree with the badge in either direction.
 *
 * The legacy `token` key (from the newer `name` field) and the depth-0 anatomy
 * reduction are part of the contract: every committed doc's baseline was hashed
 * over exactly this shape.
 */
export interface SpecHashProjection {
  name: string;
  figmaKey: string;
  figmaFile: string;
  figmaNode: string;
  anatomyComponentId: string;
  anatomy: { id: string; name: string; type: string; nested: boolean }[];
  props: ComponentProp[];
  variants: VariantAxis[];
  variantInstances: VariantInstance[];
  states: string[];
  tokens: { part: string; property: string; conditions: Record<string, string[]>; token: string }[];
  related: string[];
  gaps: { part: string; property: string; issue: GapIssue; value?: number | string }[];
  layout: { part: string; summary: string }[];
}
```

Then change the existing `specContentHash` function. Keep every existing comment inside it word for word. Rename the function to `specHashProjection`, change its return type to `SpecHashProjection`, and replace its final line `return contentHash(hashable);` with `return hashable;`. Its doc comment becomes:

```ts
/**
 * The drift baseline projection. Excludes rawValues, and reduces anatomy to the
 * legacy depth-0 {id,name,type,nested} shape, so canvas-only 2.0 additions
 * never flip the hash for existing committed specs. specContentHash hashes
 * exactly this object and the Library stores exactly this object as a doc's
 * baseline, so the two cannot drift apart.
 */
```

Then add, directly after it:

```ts
/**
 * The drift baseline hash. This is the single source of truth for a component
 * doc's content_hash; on-canvas drift detection and the stored baseline both
 * derive from specHashProjection.
 */
export function specContentHash(spec: IntermediateSpec): string {
  return contentHash(specHashProjection(spec));
}
```

- [ ] **Step 4: Run the tests to verify they pass, including the golden hashes**

Run: `npx vitest run packages/extractor/test/specHash.test.ts packages/extractor/test/foundationHash.test.ts`
Expected: PASS. `BUTTON_HASH` and `CHIP_HASH` are unchanged. If either golden test fails, the refactor changed the hashable object; undo and compare with the original body.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: exit code 0.

```bash
git add packages/extractor/src/hash.ts packages/extractor/test/specHash.test.ts
git commit -m "refactor(extractor): expose the spec hash projection and canonical equality"
```

---

### Task 2: `diffKeyed` core

**Files:**
- Create: `packages/extractor/src/diff.ts`
- Modify: `packages/extractor/src/index.ts`
- Test: `packages/extractor/test/diff.test.ts`

**Interfaces:**
- Consumes: `canonicalEqual` from `./hash` (Task 1).
- Produces:
  - `export interface ListDiff<T> { added: T[]; removed: T[]; changed: { before: T; after: T }[]; reordered: boolean }`
  - `export function diffKeyed<T>(before: readonly T[], after: readonly T[], key: (item: T) => string, equal?: (a: T, b: T) => boolean): ListDiff<T>`

- [ ] **Step 1: Write the failing tests**

Create `packages/extractor/test/diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffKeyed } from '../src/diff';

interface Item { id: string; value: number }
const byId = (item: Item) => item.id;

describe('diffKeyed', () => {
  it('returns empty lists and no reorder for two empty lists', () => {
    expect(diffKeyed([], [], byId)).toEqual({ added: [], removed: [], changed: [], reordered: false });
  });

  it('reports added items in after order and removed items in before order', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }];
    const after: Item[] = [{ id: 'z', value: 9 }, { id: 'b', value: 2 }, { id: 'y', value: 8 }];
    const d = diffKeyed(before, after, byId);
    expect(d.added.map(byId)).toEqual(['z', 'y']);
    expect(d.removed.map(byId)).toEqual(['a', 'c']);
    expect(d.changed).toEqual([]);
    expect(d.reordered).toBe(false);
  });

  it('reports a changed item with its before and after, in after order', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    const after: Item[] = [{ id: 'b', value: 20 }, { id: 'a', value: 10 }];
    const d = diffKeyed(before, after, byId);
    expect(d.changed).toEqual([
      { before: { id: 'b', value: 2 }, after: { id: 'b', value: 20 } },
      { before: { id: 'a', value: 1 }, after: { id: 'a', value: 10 } },
    ]);
    // A change list is not a reorder even though the order also moved.
    expect(d.reordered).toBe(false);
  });

  it('flags a pure reorder and nothing else', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    const after: Item[] = [{ id: 'b', value: 2 }, { id: 'a', value: 1 }];
    expect(diffKeyed(before, after, byId)).toEqual({ added: [], removed: [], changed: [], reordered: true });
  });

  it('does not flag a reorder when the lists are identical', () => {
    const list: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    expect(diffKeyed(list, [...list], byId).reordered).toBe(false);
  });

  it('compares equal keys by canonical serialization: key order and undefined do not count', () => {
    const before = [{ id: 'a', x: 1, y: 2 }];
    const after = [{ id: 'a', y: 2, x: 1, z: undefined }];
    expect(diffKeyed(before, after, (i) => i.id).changed).toEqual([]);
  });

  it('pairs duplicate keys positionally and reports surplus as added or removed, never merged', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'a', value: 2 }, { id: 'a', value: 3 }];
    const after: Item[] = [{ id: 'a', value: 1 }, { id: 'a', value: 20 }];
    const d = diffKeyed(before, after, byId);
    expect(d.changed).toEqual([{ before: { id: 'a', value: 2 }, after: { id: 'a', value: 20 } }]);
    expect(d.removed).toEqual([{ id: 'a', value: 3 }]);
    expect(d.added).toEqual([]);

    const grown = diffKeyed(after, before, byId);
    expect(grown.added).toEqual([{ id: 'a', value: 3 }]);
    expect(grown.removed).toEqual([]);
  });

  it('accepts a custom equality', () => {
    const before: Item[] = [{ id: 'a', value: 1 }];
    const after: Item[] = [{ id: 'a', value: 2 }];
    expect(diffKeyed(before, after, byId, () => true).changed).toEqual([]);
    expect(diffKeyed(before, after, byId, (x, y) => x.value === y.value).changed).toHaveLength(1);
  });

  it('works on plain strings keyed by themselves', () => {
    const d = diffKeyed(['hover', 'focus'], ['focus', 'disabled'], (s) => s);
    expect(d.added).toEqual(['disabled']);
    expect(d.removed).toEqual(['hover']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/extractor/test/diff.test.ts`
Expected: FAIL with `Cannot find module '../src/diff'`.

- [ ] **Step 3: Create `diff.ts` with the core**

Create `packages/extractor/src/diff.ts`:

```ts
/**
 * diff.ts: the semantic diff behind the Library's "Review detected changes".
 *
 * Pure and Figma-free. Two layers: a keyed-list core (diffKeyed) that the later
 * `spec-layer diff` command reuses with its own v5 keys, and group builders that
 * turn two hash projections into the ChangeGroup[] a Library row renders.
 *
 * The diff input is the hash input. componentChangeGroups takes two
 * SpecHashProjection values and foundationChangeGroups two FoundationUnitContent
 * values: exactly the objects specContentHash and foundationContentHash hash.
 * Comparing anything else could disagree with the "Update available" badge.
 */
import { canonicalEqual } from './hash';

export interface ListDiff<T> {
  added: T[];
  removed: T[];
  changed: { before: T; after: T }[];
  /** Same key sequence set and equal values, different order. */
  reordered: boolean;
}

/**
 * Diff two lists by identity key.
 *
 * Output order follows the `after` list for added and changed and the `before`
 * list for removed, so a caller never sorts and no locale is involved.
 * Duplicate keys within one list are paired positionally; surplus items are
 * reported as added or removed, never silently merged. `equal` defaults to
 * canonical equality, so "changed" means "would hash differently".
 */
export function diffKeyed<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  equal: (a: T, b: T) => boolean = canonicalEqual,
): ListDiff<T> {
  const beforeByKey = new Map<string, T[]>();
  for (const item of before) {
    const k = key(item);
    const group = beforeByKey.get(k);
    if (group) group.push(item);
    else beforeByKey.set(k, [item]);
  }

  // How many `after` items have claimed each key so far. The nth `after` item
  // with a key pairs with the nth `before` item with that key.
  const consumed = new Map<string, number>();
  const added: T[] = [];
  const changed: { before: T; after: T }[] = [];
  for (const item of after) {
    const k = key(item);
    const index = consumed.get(k) ?? 0;
    consumed.set(k, index + 1);
    const priors = beforeByKey.get(k);
    if (!priors || index >= priors.length) {
      added.push(item);
      continue;
    }
    const prior = priors[index];
    if (!equal(prior, item)) changed.push({ before: prior, after: item });
  }

  const removed: T[] = [];
  const seen = new Map<string, number>();
  for (const item of before) {
    const k = key(item);
    const index = seen.get(k) ?? 0;
    seen.set(k, index + 1);
    if (index >= (consumed.get(k) ?? 0)) removed.push(item);
  }

  // With nothing added, removed or changed, every value is equal, so the only
  // remaining difference is order. JSON.stringify rather than a joined string
  // so no separator character can collide with a key.
  const reordered = added.length === 0 && removed.length === 0 && changed.length === 0
    && JSON.stringify(before.map(key)) !== JSON.stringify(after.map(key));

  return { added, removed, changed, reordered };
}
```

Add to `packages/extractor/src/index.ts`, directly after `export * from './hash';`:

```ts
export * from './diff';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/extractor/test/diff.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/diff.ts packages/extractor/src/index.ts packages/extractor/test/diff.test.ts
git commit -m "feat(extractor): add the keyed-list diff core"
```

---

### Task 3: Foundation value formatters and `foundationChangeGroups`

**Files:**
- Modify: `packages/extractor/src/diff.ts`
- Test: `packages/extractor/test/diff.test.ts`

**Interfaces:**
- Consumes: `diffKeyed` (Task 2); `FoundationUnitContent`, `FoundationRow`, `FoundationValue`, `FoundationTextMetrics` from `./foundation`; `compareCodeUnits` from `./v5/diagnostics`.
- Produces:
  - `export interface ChangeGroup { label: string; items: string[] }`
  - `export function formatFoundationValue(value: FoundationValue): string`
  - `export function formatTextMetrics(metrics: FoundationTextMetrics): string`
  - `export function foundationChangeGroups(before: FoundationUnitContent, after: FoundationUnitContent): ChangeGroup[]`
  - Internal helpers reused by Task 4: `REORDERED`, `list()`, `stringSetItems()`, `groups()`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/diff.test.ts`. Extend the import line to:

```ts
import { diffKeyed, formatFoundationValue, formatTextMetrics, foundationChangeGroups } from '../src/diff';
import type { FoundationUnitContent, FoundationValue, FoundationVariableRow, FoundationTextRow } from '../src/foundation';
```

Append:

```ts
const BLUE: FoundationValue = { kind: 'color', hex: '#0055FF', alpha: 1 };
const BLUE_2: FoundationValue = { kind: 'color', hex: '#0044EE', alpha: 1 };

function colorRow(name: string, light: FoundationValue, dark: FoundationValue, description = ''): FoundationVariableRow {
  return {
    kind: 'variable', name, description, resolvedType: 'COLOR',
    cells: [{ modeName: 'Light', value: light }, { modeName: 'Dark', value: dark }],
  };
}

function unit(rows: FoundationUnitContent['rows'], overrides: Partial<FoundationUnitContent> = {}): FoundationUnitContent {
  return { collectionName: 'Semantic', modeNames: ['Light', 'Dark'], rows, omittedModeNames: [], ...overrides };
}

describe('formatFoundationValue', () => {
  it('renders each value kind without inventing anything', () => {
    expect(formatFoundationValue(BLUE)).toBe('#0055FF');
    expect(formatFoundationValue({ kind: 'color', hex: '#0055FF', alpha: 0.8 })).toBe('#0055FF at 80%');
    expect(formatFoundationValue({ kind: 'number', value: 12 })).toBe('12');
    expect(formatFoundationValue({ kind: 'string', value: 'Inter' })).toBe('Inter');
    expect(formatFoundationValue({ kind: 'boolean', value: false })).toBe('false');
    expect(formatFoundationValue({
      kind: 'alias', targetName: 'blue/500', targetCollection: 'Primitives', external: false, resolved: BLUE,
    })).toBe('{Primitives/blue/500} resolving to #0055FF');
    expect(formatFoundationValue({
      kind: 'alias', targetName: 'blue/500', targetCollection: 'Brand Kit', external: true, resolved: null,
    })).toBe('{Brand Kit/blue/500}');
    expect(formatFoundationValue({ kind: 'unresolved', reason: 'missing' })).toBe('unresolved (missing)');
  });
});

describe('formatTextMetrics', () => {
  it('renders family, style, size and line height, and says auto or unknown honestly', () => {
    expect(formatTextMetrics({ fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PIXELS', value: 40 } }))
      .toBe('Inter Bold 32/40');
    expect(formatTextMetrics({ fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PERCENT', value: 125 } }))
      .toBe('Inter Bold 32/125%');
    expect(formatTextMetrics({ fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'AUTO' } }))
      .toBe('Inter Bold 32/auto');
    expect(formatTextMetrics({ fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PIXELS' } }))
      .toBe('Inter Bold 32/unknown');
  });
});

describe('foundationChangeGroups', () => {
  it('returns no groups when nothing differs', () => {
    const a = unit([colorRow('color/brand/500', BLUE, BLUE)]);
    expect(foundationChangeGroups(a, unit([colorRow('color/brand/500', BLUE, BLUE)]))).toEqual([]);
  });

  it('itemizes a changed cell by mode with before and after', () => {
    const before = unit([colorRow('color/brand/500', BLUE, BLUE)]);
    const after = unit([colorRow('color/brand/500', BLUE_2, BLUE)]);
    expect(foundationChangeGroups(before, after)).toEqual([
      { label: 'Tokens', items: ['color/brand/500 in Light: #0055FF changed to #0044EE'] },
    ]);
  });

  it('reports added and removed rows by name', () => {
    const before = unit([colorRow('color/brand/500', BLUE, BLUE), colorRow('color/brand/700', BLUE, BLUE)]);
    const after = unit([colorRow('color/brand/500', BLUE, BLUE), colorRow('color/brand/600', BLUE, BLUE)]);
    expect(foundationChangeGroups(before, after)).toEqual([
      { label: 'Tokens', items: ['Added color/brand/600', 'Removed color/brand/700'] },
    ]);
  });

  it('reports a changed type as one item and does not itemize its cells', () => {
    const before = unit([colorRow('size/base', BLUE, BLUE)]);
    const afterRow: FoundationVariableRow = {
      kind: 'variable', name: 'size/base', description: '', resolvedType: 'FLOAT',
      cells: [{ modeName: 'Light', value: { kind: 'number', value: 4 } }, { modeName: 'Dark', value: { kind: 'number', value: 4 } }],
    };
    expect(foundationChangeGroups(before, unit([afterRow]))).toEqual([
      { label: 'Tokens', items: ['size/base: type COLOR changed to FLOAT'] },
    ]);
  });

  it('reports a variable turned text style as a changed type', () => {
    const before = unit([colorRow('heading/lg', BLUE, BLUE)]);
    const text: FoundationTextRow = {
      kind: 'textStyle', name: 'heading/lg', description: '',
      metrics: { fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PIXELS', value: 40 } },
    };
    expect(foundationChangeGroups(before, unit([text]))).toEqual([
      { label: 'Tokens', items: ['heading/lg: type COLOR changed to text style'] },
    ]);
  });

  it('reports changed text metrics as one item', () => {
    const metrics = { fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PIXELS' as const, value: 40 } };
    const before = unit([{ kind: 'textStyle', name: 'heading/lg', description: '', metrics }], { collectionName: '', modeNames: [] });
    const after = unit([{ kind: 'textStyle', name: 'heading/lg', description: '', metrics: { ...metrics, fontSize: 36 } }], { collectionName: '', modeNames: [] });
    expect(foundationChangeGroups(before, after)).toEqual([
      { label: 'Tokens', items: ['heading/lg: Inter Bold 32/40 changed to Inter Bold 36/40'] },
    ]);
  });

  it('puts a description change in its own group without a token item', () => {
    const before = unit([colorRow('color/brand/500', BLUE, BLUE, 'Old')]);
    const after = unit([colorRow('color/brand/500', BLUE, BLUE, 'New')]);
    expect(foundationChangeGroups(before, after)).toEqual([
      { label: 'Descriptions', items: ['Description of color/brand/500 changed'] },
    ]);
  });

  it('reports mode changes, including modes left out, under Modes', () => {
    const before = unit([], { modeNames: ['Light'], omittedModeNames: ['Dark'] });
    const after = unit([], { modeNames: ['Light', 'Dark'], omittedModeNames: [] });
    expect(foundationChangeGroups(before, after)).toEqual([
      { label: 'Modes', items: ['Added mode Dark', 'Mode Dark is no longer left out'] },
    ]);
  });

  it('reports a pure mode reorder as one line', () => {
    const before = unit([], { modeNames: ['Light', 'Dark'] });
    const after = unit([], { modeNames: ['Dark', 'Light'] });
    expect(foundationChangeGroups(before, after)).toEqual([
      { label: 'Modes', items: ['Order changed, values unchanged'] },
    ]);
  });

  it('reports collection name, group and part numbering under Part', () => {
    const before = unit([], { collectionName: 'Core', group: 'color', part: { index: 0, total: 2 } });
    const after = unit([], { collectionName: 'Primitives', group: 'colour', part: { index: 0, total: 3 } });
    expect(foundationChangeGroups(before, after)).toEqual([
      { label: 'Part', items: [
        'Collection Core changed to Primitives',
        'Group color changed to colour',
        'Part 1 of 2 changed to 1 of 3',
      ] },
    ]);
    expect(foundationChangeGroups(unit([]), unit([], { group: 'color', part: { index: 1, total: 2 } }))).toEqual([
      { label: 'Part', items: ['Added group color', 'Added part 2 of 2'] },
    ]);
  });

  it('keeps groups in the fixed order Tokens, Descriptions, Modes, Part', () => {
    const before = unit([colorRow('a', BLUE, BLUE, 'x')], { modeNames: ['Light', 'Dark'], collectionName: 'Core' });
    const after = unit([colorRow('a', BLUE_2, BLUE, 'y')], { modeNames: ['Light'], collectionName: 'Base' });
    expect(foundationChangeGroups(before, after).map((g) => g.label)).toEqual(['Tokens', 'Descriptions', 'Modes', 'Part']);
  });

  it('treats a projection missing its lists as empty rather than throwing', () => {
    const partial = { collectionName: 'Semantic', modeNames: ['Light'] } as unknown as FoundationUnitContent;
    expect(foundationChangeGroups(partial, unit([colorRow('a', BLUE, BLUE)], { modeNames: ['Light'] })))
      .toEqual([{ label: 'Tokens', items: ['Added a'] }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/diff.test.ts`
Expected: FAIL with `formatFoundationValue is not a function` (and the two others).

- [ ] **Step 3: Implement the formatters and the foundation builder**

In `packages/extractor/src/diff.ts`, extend the imports:

```ts
import { canonicalEqual } from './hash';
import type {
  FoundationRow, FoundationTextMetrics, FoundationUnitContent, FoundationValue,
} from './foundation';
```

Append after `diffKeyed`:

```ts
// ---------------------------------------------------------------------------
// Group builders
// ---------------------------------------------------------------------------

export interface ChangeGroup { label: string; items: string[] }

/** The one line a group shows when only its order moved. */
const REORDERED = 'Order changed, values unchanged';

/**
 * A stored baseline is not validated past "projection is an object", so a
 * list may be missing or malformed. Treat anything that is not an array as an
 * empty list rather than throwing: a half-readable baseline still explains
 * what it can.
 */
function list<T>(value: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function stringSetItems(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
  added: (value: string) => string,
  removed: (value: string) => string,
): string[] {
  const d = diffKeyed(list(before), list(after), (s) => s);
  const items = [...d.added.map(added), ...d.removed.map(removed)];
  if (d.reordered) items.push(REORDERED);
  return items;
}

function pushReordered(items: string[]): void {
  if (!items.includes(REORDERED)) items.push(REORDERED);
}

/** Only groups with at least one item, in the order given. */
function groups(entries: readonly [string, string[]][]): ChangeGroup[] {
  return entries
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function scalarItem(label: string, before: string | undefined, after: string | undefined): string {
  if (before === undefined) return `Added ${label.toLowerCase()} ${after}`;
  if (after === undefined) return `Removed ${label.toLowerCase()} ${before}`;
  return `${label} ${before} changed to ${after}`;
}

// ---------------------------------------------------------------------------
// Foundation
// ---------------------------------------------------------------------------

/**
 * One formatter per value kind so item copy is uniform. Nothing is invented:
 * an unresolved value names its reason and never a guessed number, and an
 * alias with no resolution shows only its reference.
 */
export function formatFoundationValue(value: FoundationValue): string {
  switch (value.kind) {
    case 'color':
      return value.alpha < 1 ? `${value.hex} at ${Math.round(value.alpha * 100)}%` : value.hex;
    case 'number':
      return String(value.value);
    case 'string':
      return value.value;
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'alias': {
      const reference = `{${value.targetCollection}/${value.targetName}}`;
      return value.resolved ? `${reference} resolving to ${formatFoundationValue(value.resolved)}` : reference;
    }
    case 'unresolved':
      return `unresolved (${value.reason})`;
  }
}

function formatLineHeight(lineHeight: FoundationTextMetrics['lineHeight']): string {
  if (lineHeight.unit === 'AUTO') return 'auto';
  if (lineHeight.value === undefined) return 'unknown';
  return lineHeight.unit === 'PERCENT' ? `${lineHeight.value}%` : String(lineHeight.value);
}

/** "family style size/lineHeight", the same line the frame draws. */
export function formatTextMetrics(metrics: FoundationTextMetrics): string {
  return `${metrics.fontFamily} ${metrics.fontStyle} ${metrics.fontSize}/${formatLineHeight(metrics.lineHeight)}`;
}

function rowTypeLabel(row: FoundationRow): string {
  return row.kind === 'textStyle' ? 'text style' : row.resolvedType;
}

function formatPart(part: FoundationUnitContent['part']): string | undefined {
  return part ? `${part.index + 1} of ${part.total}` : undefined;
}

/**
 * Groups, in order: Tokens, Descriptions, Modes, Part. Empty groups are
 * dropped; `[]` means nothing differs, which for two inputs that hash
 * differently should not happen.
 */
export function foundationChangeGroups(
  before: FoundationUnitContent,
  after: FoundationUnitContent,
): ChangeGroup[] {
  const tokens: string[] = [];
  const descriptions: string[] = [];

  const rows = diffKeyed(list(before.rows), list(after.rows), (row) => row.name);
  for (const row of rows.added) tokens.push(`Added ${row.name}`);
  for (const row of rows.removed) tokens.push(`Removed ${row.name}`);
  for (const { before: b, after: a } of rows.changed) {
    const typeChanged = b.kind !== a.kind
      || (b.kind === 'variable' && a.kind === 'variable' && b.resolvedType !== a.resolvedType);
    if (typeChanged) {
      // Comparing a colour to a number cell by cell says nothing.
      tokens.push(`${a.name}: type ${rowTypeLabel(b)} changed to ${rowTypeLabel(a)}`);
    } else if (b.kind === 'variable' && a.kind === 'variable') {
      // Cells added or removed follow the mode set, which the Modes group
      // already explains; only a value that moved is a token item.
      const cells = diffKeyed(list(b.cells), list(a.cells), (cell) => cell.modeName);
      for (const { before: cb, after: ca } of cells.changed) {
        tokens.push(`${a.name} in ${ca.modeName}: ${formatFoundationValue(cb.value)} changed to ${formatFoundationValue(ca.value)}`);
      }
    } else if (b.kind === 'textStyle' && a.kind === 'textStyle' && !canonicalEqual(b.metrics, a.metrics)) {
      tokens.push(`${a.name}: ${formatTextMetrics(b.metrics)} changed to ${formatTextMetrics(a.metrics)}`);
    }
    if (b.description !== a.description) descriptions.push(`Description of ${a.name} changed`);
  }
  if (rows.reordered) pushReordered(tokens);

  const modes = [
    ...stringSetItems(before.modeNames, after.modeNames,
      (mode) => `Added mode ${mode}`, (mode) => `Removed mode ${mode}`),
    ...stringSetItems(before.omittedModeNames, after.omittedModeNames,
      (mode) => `Mode ${mode} is now left out`, (mode) => `Mode ${mode} is no longer left out`),
  ];

  const part: string[] = [];
  if (before.collectionName !== after.collectionName) {
    part.push(`Collection ${before.collectionName} changed to ${after.collectionName}`);
  }
  if (before.group !== after.group) part.push(scalarItem('Group', before.group, after.group));
  if (!canonicalEqual(before.part, after.part)) part.push(scalarItem('Part', formatPart(before.part), formatPart(after.part)));

  return groups([
    ['Tokens', tokens],
    ['Descriptions', descriptions],
    ['Modes', modes],
    ['Part', part],
  ]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/diff.test.ts`
Expected: PASS. If the "modes left out" test fails on ordering, note that `stringSetItems` emits added before removed within each list, and `modeNames` items come before `omittedModeNames` items.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0. The `switch` in `formatFoundationValue` is exhaustive over `FoundationValue['kind']` and deliberately has no `default`, so a kind added later fails typecheck here instead of rendering silently. If TypeScript reports "not all code paths return a value", a case is missing; add it rather than adding a `default`.

```bash
git add packages/extractor/src/diff.ts packages/extractor/test/diff.test.ts
git commit -m "feat(extractor): itemize foundation drift into change groups"
```

---

### Task 4: `componentChangeGroups`

**Files:**
- Modify: `packages/extractor/src/diff.ts`
- Test: `packages/extractor/test/diff.test.ts`

**Interfaces:**
- Consumes: `SpecHashProjection` (Task 1), helpers from Task 3, `compareCodeUnits` from `./v5/diagnostics`.
- Produces: `export function componentChangeGroups(before: SpecHashProjection, after: SpecHashProjection): ChangeGroup[]`

- [ ] **Step 1: Write the failing tests**

Extend the import line in `packages/extractor/test/diff.test.ts`:

```ts
import {
  diffKeyed, formatFoundationValue, formatTextMetrics, foundationChangeGroups, componentChangeGroups,
} from '../src/diff';
import type { SpecHashProjection } from '../src/hash';
```

Append:

```ts
function projection(overrides: Partial<SpecHashProjection> = {}): SpecHashProjection {
  return {
    name: 'Button',
    figmaKey: 'key-1',
    figmaFile: 'FILE1',
    figmaNode: '1:1',
    anatomyComponentId: '1:2',
    anatomy: [{ id: '1:3', name: 'Label', type: 'TEXT', nested: false }],
    props: [{ name: 'Size', kind: 'variant', options: ['Small', 'Medium'], default: 'Small' }],
    variants: [{ prop: 'Size', values: ['Small', 'Medium'] }],
    variantInstances: [{ nodeId: '1:2', name: 'Size=Small', values: { Size: 'Small' } }],
    states: ['default', 'hover'],
    tokens: [{ part: 'Label', property: 'fill', conditions: {}, token: 'color.primary' }],
    related: ['Icon'],
    gaps: [{ part: 'Label', property: 'padding', issue: 'hardcoded-value', value: 8 }],
    layout: [{ part: 'Container', summary: 'horizontal, gap 8' }],
    ...overrides,
  };
}

describe('componentChangeGroups', () => {
  it('returns no groups when nothing differs', () => {
    expect(componentChangeGroups(projection(), projection())).toEqual([]);
  });

  it('explains an identity-only change so an otherwise empty list still explains the badge', () => {
    expect(componentChangeGroups(projection(), projection({ figmaNode: '9:9' }))).toEqual([
      { label: 'Name', items: ['Source identity changed'] },
    ]);
    expect(componentChangeGroups(projection(), projection({ name: 'Button v2', anatomyComponentId: '2:2' }))).toEqual([
      { label: 'Name', items: ['Name Button changed to Button v2', 'Source identity changed'] },
    ]);
  });

  it('itemizes property additions, removals and field changes', () => {
    const after = projection({
      props: [
        { name: 'Size', kind: 'variant', options: ['Small', 'Medium', 'Large'], default: 'Medium' },
        { name: 'Description', kind: 'text' },
      ],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      { label: 'Properties', items: [
        'Added Description property',
        'Size property: options were Small, Medium changed to Small, Medium, Large',
        'Size property: default Small changed to Medium',
      ] },
    ]);
    expect(componentChangeGroups(projection(), projection({ props: [] }))).toEqual([
      { label: 'Properties', items: ['Removed Size property'] },
    ]);
    expect(componentChangeGroups(projection(), projection({
      props: [{ name: 'Size', kind: 'text', options: ['Small', 'Medium'], default: 'Small' }],
    }))).toEqual([
      { label: 'Properties', items: ['Size property: kind variant changed to text'] },
    ]);
  });

  it('itemizes variant axes and variant instances under Variants', () => {
    const after = projection({
      variants: [{ prop: 'Size', values: ['Small', 'Medium', 'Large'] }, { prop: 'State', values: ['Default'] }],
      variantInstances: [
        { nodeId: '1:2', name: 'Size=Small, State=Default', values: { Size: 'Small', State: 'Default' } },
        { nodeId: '1:9', name: 'Size=Large, State=Default', values: { Size: 'Large', State: 'Default' } },
      ],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      { label: 'Variants', items: [
        'Added State axis',
        'Size: values were Small, Medium changed to Small, Medium, Large',
        'Added variant Size=Large, State=Default',
        'Variant Size=Small changed to Size=Small, State=Default',
        'Variant Size=Small, State=Default: values Size=Small changed to Size=Small, State=Default',
      ] },
    ]);
  });

  it('itemizes anatomy parts by id', () => {
    const after = projection({
      anatomy: [
        { id: '1:3', name: 'Text', type: 'TEXT', nested: true },
        { id: '1:4', name: 'Icon', type: 'INSTANCE', nested: true },
      ],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      { label: 'Anatomy', items: [
        'Added Icon part',
        'Part Label renamed to Text',
        'Text part: nested false changed to true',
      ] },
    ]);
  });

  it('treats states and related as sets', () => {
    expect(componentChangeGroups(projection(), projection({ states: ['default', 'disabled'], related: [] }))).toEqual([
      { label: 'States', items: ['Added state disabled', 'Removed state hover'] },
      { label: 'Related', items: ['Removed related Icon'] },
    ]);
    expect(componentChangeGroups(projection(), projection({ states: ['hover', 'default'] }))).toEqual([
      { label: 'States', items: ['Order changed, values unchanged'] },
    ]);
  });

  it('keys tokens by part, property and conditions and spells conditions out', () => {
    const before = projection({
      tokens: [
        { part: 'Label', property: 'fill', conditions: {}, token: 'color.primary' },
        { part: 'Label', property: 'fill', conditions: { Size: ['Large'] }, token: 'color.primary' },
        { part: 'Icon', property: 'padding', conditions: {}, token: 'space.2' },
      ],
    });
    const after = projection({
      tokens: [
        { part: 'Label', property: 'fill', conditions: {}, token: 'color.brand.500' },
        { part: 'Label', property: 'fill', conditions: { Size: ['Large'], State: ['Hover'] }, token: 'color.brand.600' },
      ],
    });
    expect(componentChangeGroups(before, after)).toEqual([
      { label: 'Tokens', items: [
        'Added Label / fill when Size is Large and State is Hover: color.brand.600',
        'Removed Label / fill when Size is Large',
        'Removed Icon / padding',
        'Label / fill: color.primary changed to color.brand.500',
      ] },
    ]);
  });

  it('keys conditions independently of axis key order', () => {
    const before = projection({ tokens: [{ part: 'L', property: 'fill', conditions: { A: ['1'], B: ['2'] }, token: 't' }] });
    const after = projection({ tokens: [{ part: 'L', property: 'fill', conditions: { B: ['2'], A: ['1'] }, token: 't' }] });
    expect(componentChangeGroups(before, after)).toEqual([]);
  });

  it('itemizes unbound values with their issue and value', () => {
    const after = projection({
      gaps: [
        { part: 'Label', property: 'padding', issue: 'hardcoded-value', value: 12 },
        { part: 'Container', property: 'fill', issue: 'hardcoded-color', value: '#FFFFFF' },
        { part: 'Icon', property: 'stroke', issue: 'missing-token-binding' },
      ],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      { label: 'Unbound values', items: [
        'Added Container / fill (hardcoded color): #FFFFFF',
        'Added Icon / stroke (missing token binding)',
        'Label / padding (hardcoded value): 8 changed to 12',
      ] },
    ]);
  });

  it('itemizes layout by part', () => {
    const after = projection({
      layout: [{ part: 'Container', summary: 'vertical, gap 12' }, { part: 'Label', summary: 'hug' }],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      { label: 'Layout', items: [
        'Added Label layout: hug',
        'Container: horizontal, gap 8 changed to vertical, gap 12',
      ] },
    ]);
  });

  it('keeps groups in the fixed order', () => {
    const after = projection({
      name: 'X', props: [], variants: [], anatomy: [], states: [], tokens: [], gaps: [], layout: [], related: [],
    });
    expect(componentChangeGroups(projection(), after).map((g) => g.label)).toEqual([
      'Name', 'Properties', 'Variants', 'Anatomy', 'States', 'Tokens', 'Unbound values', 'Layout', 'Related',
    ]);
  });

  it('treats a projection missing its lists as empty rather than throwing', () => {
    const partial = { name: 'Button', figmaKey: 'key-1', figmaFile: 'FILE1', figmaNode: '1:1', anatomyComponentId: '1:2' } as unknown as SpecHashProjection;
    const result = componentChangeGroups(partial, projection());
    expect(result.find((g) => g.label === 'States')).toEqual({ label: 'States', items: ['Added state default', 'Added state hover'] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/diff.test.ts`
Expected: FAIL with `componentChangeGroups is not a function`.

- [ ] **Step 3: Implement the component builder**

In `packages/extractor/src/diff.ts`, extend imports:

```ts
import { canonicalEqual, type SpecHashProjection } from './hash';
import { compareCodeUnits } from './v5/diagnostics';
```

Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TokenEntry = SpecHashProjection['tokens'][number];
type GapEntry = SpecHashProjection['gaps'][number];

/** Axis order is not identity: two rules with the same axes and values are the same rule. */
function conditionsKey(conditions: Record<string, string[]>): string {
  return JSON.stringify(Object.entries(conditions ?? {}).sort(([a], [b]) => compareCodeUnits(a, b)));
}

function formatConditions(conditions: Record<string, string[]>): string {
  const clauses = Object.entries(conditions ?? {}).map(([axis, values]) => `${axis} is ${values.join(', ')}`);
  return clauses.length > 0 ? ` when ${clauses.join(' and ')}` : '';
}

function tokenLabel(rule: TokenEntry): string {
  return `${rule.part} / ${rule.property}${formatConditions(rule.conditions)}`;
}

function gapLabel(gap: GapEntry): string {
  return `${gap.part} / ${gap.property} (${String(gap.issue).replace(/-/g, ' ')})`;
}

function formatList(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : 'none';
}

function formatDefault(value: string | boolean | undefined): string {
  return value === undefined ? 'no default' : String(value);
}

function formatGapValue(value: number | string | undefined): string {
  return value === undefined ? 'no value' : String(value);
}

function formatValues(values: Record<string, string>): string {
  const entries = Object.entries(values ?? {}).map(([axis, value]) => `${axis}=${value}`);
  return entries.length > 0 ? entries.join(', ') : 'none';
}

/**
 * Groups, in order: Name, Properties, Variants, Anatomy, States, Tokens,
 * Unbound values, Layout, Related. `figmaKey`, `figmaFile`, `figmaNode` and
 * `anatomyComponentId` are hashed identity, not content, so a change in any of
 * them is one "Source identity changed" line under Name.
 */
export function componentChangeGroups(
  before: SpecHashProjection,
  after: SpecHashProjection,
): ChangeGroup[] {
  const name: string[] = [];
  if (before.name !== after.name) name.push(`Name ${before.name} changed to ${after.name}`);
  if (
    before.figmaKey !== after.figmaKey
    || before.figmaFile !== after.figmaFile
    || before.figmaNode !== after.figmaNode
    || before.anatomyComponentId !== after.anatomyComponentId
  ) {
    name.push('Source identity changed');
  }

  const properties: string[] = [];
  const props = diffKeyed(list(before.props), list(after.props), (prop) => prop.name);
  for (const prop of props.added) properties.push(`Added ${prop.name} property`);
  for (const prop of props.removed) properties.push(`Removed ${prop.name} property`);
  for (const { before: b, after: a } of props.changed) {
    if (b.kind !== a.kind) properties.push(`${a.name} property: kind ${b.kind} changed to ${a.kind}`);
    if (!canonicalEqual(b.options, a.options)) {
      properties.push(`${a.name} property: options were ${formatList(b.options)} changed to ${formatList(a.options)}`);
    }
    if (b.default !== a.default) {
      properties.push(`${a.name} property: default ${formatDefault(b.default)} changed to ${formatDefault(a.default)}`);
    }
  }
  if (props.reordered) pushReordered(properties);

  const variants: string[] = [];
  const axes = diffKeyed(list(before.variants), list(after.variants), (axis) => axis.prop);
  for (const axis of axes.added) variants.push(`Added ${axis.prop} axis`);
  for (const axis of axes.removed) variants.push(`Removed ${axis.prop} axis`);
  for (const { before: b, after: a } of axes.changed) {
    variants.push(`${a.prop}: values were ${formatList(b.values)} changed to ${formatList(a.values)}`);
  }
  if (axes.reordered) pushReordered(variants);
  const instances = diffKeyed(list(before.variantInstances), list(after.variantInstances), (v) => v.nodeId);
  for (const v of instances.added) variants.push(`Added variant ${v.name}`);
  for (const v of instances.removed) variants.push(`Removed variant ${v.name}`);
  for (const { before: b, after: a } of instances.changed) {
    if (b.name !== a.name) variants.push(`Variant ${b.name} changed to ${a.name}`);
    if (!canonicalEqual(b.values, a.values)) {
      variants.push(`Variant ${a.name}: values ${formatValues(b.values)} changed to ${formatValues(a.values)}`);
    }
  }
  if (instances.reordered) pushReordered(variants);

  const anatomy: string[] = [];
  const parts = diffKeyed(list(before.anatomy), list(after.anatomy), (part) => part.id);
  for (const part of parts.added) anatomy.push(`Added ${part.name} part`);
  for (const part of parts.removed) anatomy.push(`Removed ${part.name} part`);
  for (const { before: b, after: a } of parts.changed) {
    if (b.name !== a.name) anatomy.push(`Part ${b.name} renamed to ${a.name}`);
    if (b.type !== a.type) anatomy.push(`${a.name} part: type ${b.type} changed to ${a.type}`);
    if (b.nested !== a.nested) anatomy.push(`${a.name} part: nested ${b.nested} changed to ${a.nested}`);
  }
  if (parts.reordered) pushReordered(anatomy);

  const states = stringSetItems(before.states, after.states,
    (state) => `Added state ${state}`, (state) => `Removed state ${state}`);

  const tokens: string[] = [];
  const rules = diffKeyed(list(before.tokens), list(after.tokens),
    (rule) => JSON.stringify([rule.part, rule.property, conditionsKey(rule.conditions)]));
  for (const rule of rules.added) tokens.push(`Added ${tokenLabel(rule)}: ${rule.token}`);
  for (const rule of rules.removed) tokens.push(`Removed ${tokenLabel(rule)}`);
  for (const { before: b, after: a } of rules.changed) {
    tokens.push(`${tokenLabel(a)}: ${b.token} changed to ${a.token}`);
  }
  if (rules.reordered) pushReordered(tokens);

  const unbound: string[] = [];
  const gaps = diffKeyed(list(before.gaps), list(after.gaps),
    (gap) => JSON.stringify([gap.part, gap.property, gap.issue]));
  for (const gap of gaps.added) {
    unbound.push(`Added ${gapLabel(gap)}${gap.value !== undefined ? `: ${gap.value}` : ''}`);
  }
  for (const gap of gaps.removed) unbound.push(`Removed ${gapLabel(gap)}`);
  for (const { before: b, after: a } of gaps.changed) {
    unbound.push(`${gapLabel(a)}: ${formatGapValue(b.value)} changed to ${formatGapValue(a.value)}`);
  }
  if (gaps.reordered) pushReordered(unbound);

  const layout: string[] = [];
  const layouts = diffKeyed(list(before.layout), list(after.layout), (entry) => entry.part);
  for (const entry of layouts.added) layout.push(`Added ${entry.part} layout: ${entry.summary}`);
  for (const entry of layouts.removed) layout.push(`Removed ${entry.part} layout`);
  for (const { before: b, after: a } of layouts.changed) {
    layout.push(`${a.part}: ${b.summary} changed to ${a.summary}`);
  }
  if (layouts.reordered) pushReordered(layout);

  const related = stringSetItems(before.related, after.related,
    (value) => `Added related ${value}`, (value) => `Removed related ${value}`);

  return groups([
    ['Name', name],
    ['Properties', properties],
    ['Variants', variants],
    ['Anatomy', anatomy],
    ['States', states],
    ['Tokens', tokens],
    ['Unbound values', unbound],
    ['Layout', layout],
    ['Related', related],
  ]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/diff.test.ts`
Expected: PASS. If the "tokens" test fails on order: added items come first in `after` order, then removed in `before` order, then changed in `after` order. Adjust the test expectation only if the implementation matches this documented order and the test does not.

- [ ] **Step 5: Lint, typecheck, full extractor tests, commit**

Run: `npm run lint && npm run typecheck && npx vitest run packages/extractor`
Expected: all exit 0.

```bash
git add packages/extractor/src/diff.ts packages/extractor/test/diff.test.ts
git commit -m "feat(extractor): itemize component drift into change groups"
```

---

### Task 5: Baseline storage in `docLink.ts`

**Files:**
- Modify: `packages/plugin/src/docLink.ts`
- Test: `packages/plugin/test/docLink.test.ts`

**Interfaces:**
- Consumes: `SpecHashProjection`, `FoundationUnitContent` types from `@spec-layer/extractor`; existing `utf8ByteLength`, `isFoundationLink`, `DocLinkData`.
- Produces:
  - `export const DOC_BASELINE_KEY = 'specLayerBaseline'`
  - `export const BASELINE_BUDGET_BYTES = 90 * 1024`
  - `export interface ComponentDocBaseline { v: 1; kind: 'component'; contentHash: string; projection: SpecHashProjection }`
  - `export interface FoundationDocBaseline { v: 1; kind: 'foundation'; contentHash: string; projection: FoundationUnitContent }`
  - `export type DocBaseline = ComponentDocBaseline | FoundationDocBaseline`
  - `export function serializeBaseline(baseline: DocBaseline): string`
  - `export function parseBaseline(raw: string): DocBaseline | null`
  - `export function baselineFor(link: DocLinkData, raw: string): DocBaseline | null`

- [ ] **Step 1: Write the failing tests**

In `packages/plugin/test/docLink.test.ts`, extend the import block from `'../src/docLink'` to also import:

```ts
  DOC_LINK_KEY, DOC_BASELINE_KEY, BASELINE_BUDGET_BYTES,
  serializeBaseline, parseBaseline, baselineFor,
  type DocBaseline, type ComponentDocBaseline, type FoundationDocBaseline,
```

and add to the extractor import:

```ts
import { EXTRACTOR_VERSION, type ProseDrafts, type SpecHashProjection, type FoundationUnitContent } from '@spec-layer/extractor';
```

Append at the end of the file:

```ts
describe('baseline storage', () => {
  const PROJECTION: SpecHashProjection = {
    name: 'Button', figmaKey: 'k', figmaFile: 'F', figmaNode: '1:1', anatomyComponentId: '1:2',
    anatomy: [{ id: '1:3', name: 'Label', type: 'TEXT', nested: false }],
    props: [], variants: [], variantInstances: [], states: [],
    tokens: [{ part: 'Label', property: 'fill', conditions: {}, token: 'color.primary' }],
    related: [], gaps: [], layout: [],
  };
  const UNIT: FoundationUnitContent = {
    collectionName: 'Semantic', modeNames: ['Light'], omittedModeNames: [],
    rows: [{ kind: 'variable', name: 'bg/brand', description: '', resolvedType: 'COLOR',
      cells: [{ modeName: 'Light', value: { kind: 'color', hex: '#0055FF', alpha: 1 } }] }],
  };
  const COMPONENT: ComponentDocBaseline = { v: 1, kind: 'component', contentHash: 'abc', projection: PROJECTION };
  const FOUNDATION: FoundationDocBaseline = { v: 1, kind: 'foundation', contentHash: 'fh', projection: UNIT };
  const FOUNDATION_LINK: FoundationDocLink = {
    v: 1, kind: 'foundation',
    scope: { target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: ['m1'] },
    contentHash: 'fh', selfHash: 's',
    config: { includeDescriptions: true, aiNotes: false, includeContrast: false },
    generatedAt: 1, pluginVersion: '5.0.0',
  };

  it('uses its own plugin data key, so it never crowds the link or the prose', () => {
    expect(DOC_BASELINE_KEY).toBe('specLayerBaseline');
    expect(new Set([DOC_LINK_KEY, DOC_PROSE_KEY, DOC_BASELINE_KEY]).size).toBe(3);
  });

  it('round-trips a component and a foundation baseline', () => {
    expect(parseBaseline(serializeBaseline(COMPONENT))).toEqual(COMPONENT);
    expect(parseBaseline(serializeBaseline(FOUNDATION))).toEqual(FOUNDATION);
  });

  it('returns null on empty, malformed, wrong version, wrong kind, or a non-object projection', () => {
    expect(parseBaseline('')).toBeNull();
    expect(parseBaseline('not json')).toBeNull();
    expect(parseBaseline('[]')).toBeNull();
    expect(parseBaseline(JSON.stringify({ ...COMPONENT, v: 2 }))).toBeNull();
    expect(parseBaseline(JSON.stringify({ ...COMPONENT, kind: 'prose' }))).toBeNull();
    expect(parseBaseline(JSON.stringify({ ...COMPONENT, contentHash: 5 }))).toBeNull();
    expect(parseBaseline(JSON.stringify({ ...COMPONENT, projection: [] }))).toBeNull();
    expect(parseBaseline(JSON.stringify({ ...COMPONENT, projection: 'x' }))).toBeNull();
    expect(parseBaseline(JSON.stringify({ ...COMPONENT, projection: null }))).toBeNull();
  });

  it('does not validate the projection interior: the diff treats unknown shapes as absent lists', () => {
    const parsed = parseBaseline(JSON.stringify({ ...COMPONENT, projection: { name: 'only' } }));
    expect(parsed?.kind).toBe('component');
  });

  it('drops a baseline over budget whole and logs the size', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const huge: ComponentDocBaseline = {
        ...COMPONENT,
        projection: { ...PROJECTION, name: 'x'.repeat(BASELINE_BUDGET_BYTES + 1) },
      };
      expect(serializeBaseline(huge)).toBe('');
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0];
      expect(message).toContain(String(BASELINE_BUDGET_BYTES));
      expect(message).toMatch(/\d+ bytes/);
    } finally {
      warn.mockRestore();
    }
  });

  it('has a 90 kB budget, under Figma\'s 100 kB per-entry cap', () => {
    expect(BASELINE_BUDGET_BYTES).toBe(90 * 1024);
  });

  it('works in a realm with no TextEncoder, which is the Figma main thread', () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.TextEncoder;
    delete g.TextEncoder;
    try {
      expect(() => serializeBaseline(COMPONENT)).not.toThrow();
      expect(parseBaseline(serializeBaseline(FOUNDATION))).toEqual(FOUNDATION);
    } finally {
      g.TextEncoder = saved;
    }
  });

  it('baselineFor returns the baseline only when kind and hash match the link', () => {
    const componentLink: ComponentDocLink = { ...DATA, contentHash: 'abc' } as ComponentDocLink;
    expect(baselineFor(componentLink, serializeBaseline(COMPONENT))).toEqual(COMPONENT);
    expect(baselineFor(FOUNDATION_LINK, serializeBaseline(FOUNDATION))).toEqual(FOUNDATION);
  });

  it('baselineFor rejects a stale baseline whose hash no longer matches the link', () => {
    const componentLink: ComponentDocLink = { ...DATA, contentHash: 'newer' } as ComponentDocLink;
    expect(baselineFor(componentLink, serializeBaseline(COMPONENT))).toBeNull();
  });

  it('baselineFor rejects a baseline of the other kind even when the hash matches', () => {
    const componentLink: ComponentDocLink = { ...DATA, contentHash: 'fh' } as ComponentDocLink;
    expect(baselineFor(componentLink, serializeBaseline(FOUNDATION))).toBeNull();
    const foundationLink: FoundationDocLink = { ...FOUNDATION_LINK, contentHash: 'abc' };
    expect(baselineFor(foundationLink, serializeBaseline(COMPONENT))).toBeNull();
  });

  it('baselineFor returns null for empty or unparseable data', () => {
    expect(baselineFor(DATA, '')).toBeNull();
    expect(baselineFor(DATA, '{')).toBeNull();
  });

  it('DocBaseline narrows on kind', () => {
    const b: DocBaseline = FOUNDATION;
    if (b.kind === 'foundation') expect(b.projection.modeNames).toEqual(['Light']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: FAIL with `serializeBaseline is not a function` (and `DOC_BASELINE_KEY` undefined).

- [ ] **Step 3: Implement**

In `packages/plugin/src/docLink.ts`, change the extractor import to:

```ts
import {
  contentHash,
  type FoundationScope, type ProseDrafts, type SpecHashProjection, type FoundationUnitContent,
} from '@spec-layer/extractor';
```

Directly after `export const PROSE_BUDGET_BYTES = 64 * 1024;` add:

```ts
/**
 * The drift baseline for "Review detected changes": the exact object the doc's
 * content hash was computed over, stored beside the link so a later refresh can
 * diff it against the live projection. A hash alone cannot be diffed.
 *
 * Its own key rather than a field on the link, for the same reason as prose:
 * the library scan parses every link on every refresh and never needs this.
 * Figma's 100 kB cap is per entry, so a separate key gets its own budget and
 * cannot crowd out the link or the prose.
 */
export const DOC_BASELINE_KEY = 'specLayerBaseline';

/**
 * Ceiling on a serialized baseline. Over budget is dropped whole, never
 * truncated: half a baseline presented as complete would make the diff report
 * every missing item as "removed", which is fabrication.
 */
export const BASELINE_BUDGET_BYTES = 90 * 1024;

export interface ComponentDocBaseline {
  v: 1;
  kind: 'component';
  /** Must equal the doc link's contentHash, or the baseline is discarded. */
  contentHash: string;
  projection: SpecHashProjection;
}

export interface FoundationDocBaseline {
  v: 1;
  kind: 'foundation';
  contentHash: string;
  projection: FoundationUnitContent;
}

export type DocBaseline = ComponentDocBaseline | FoundationDocBaseline;
```

After `parseProse` (before `/** Everything needed to faithfully regenerate a doc on Update. */`) add:

```ts
export function serializeBaseline(baseline: DocBaseline): string {
  const out = JSON.stringify(baseline);
  const bytes = utf8ByteLength(out);
  if (bytes > BASELINE_BUDGET_BYTES) {
    // Same rule as prose: dropped whole, and logged, because a silent drop
    // leaves the Library saying "Update this doc once" after an Update that
    // did run. The log is the only record of why.
    console.warn(`[Spec Layer] baseline dropped: ${bytes} bytes exceeds the ${BASELINE_BUDGET_BYTES}-byte budget`);
    return '';
  }
  return out;
}

/**
 * Defensive parse: null on empty, malformed, wrong `v`, wrong `kind`, or a
 * projection that is not an object. The projection's interior is deliberately
 * not validated; the diff treats unknown shapes as absent lists.
 */
export function parseBaseline(raw: string): DocBaseline | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.kind !== 'component' && o.kind !== 'foundation') return null;
  if (typeof o.contentHash !== 'string') return null;
  if (!o.projection || typeof o.projection !== 'object' || Array.isArray(o.projection)) return null;
  return o as unknown as DocBaseline;
}

/**
 * The one main-thread entry point: parse, then accept only a baseline whose
 * kind matches the link's and whose contentHash equals the link's. A stale
 * baseline (an older Update that stored a link but whose baseline write was
 * dropped) or a foreign one is rejected here, in a pure function, rather than
 * in main.ts.
 */
export function baselineFor(link: DocLinkData, raw: string): DocBaseline | null {
  const baseline = parseBaseline(raw);
  if (!baseline) return null;
  const kind = isFoundationLink(link) ? 'foundation' : 'component';
  if (baseline.kind !== kind || baseline.contentHash !== link.contentHash) return null;
  return baseline;
}
```

Note `baselineFor` references `DocLinkData` and `isFoundationLink`, which are declared later in the file. Function declarations and type aliases hoist, so this compiles; if `npm run lint` complains about use-before-define, move the three baseline functions to the end of the file instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`

```bash
git add packages/plugin/src/docLink.ts packages/plugin/test/docLink.test.ts
git commit -m "feat(plugin): store and validate a doc's drift baseline"
```

---

### Task 6: Wire protocol, write points, and the `requestDocBaseline` handler

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/ui/actions.ts` (two `renderDocFrame` send sites, around lines 338 and 475)
- Modify: `packages/plugin/src/main.ts` (imports; `renderDocFrame`, `renderFoundation`, `updateFoundationDoc`, `detachDoc` handlers; new `requestDocBaseline` handler)
- Test: `packages/plugin/test/fromSource.test.ts`

**Interfaces:**
- Consumes: `specHashProjection`, `SpecHashProjection`, `FoundationUnitContent`, `unitContent`, `retargetScope` (existing), `DocBaseline`, `DOC_BASELINE_KEY`, `serializeBaseline`, `baselineFor` (Task 5).
- Produces:
  - `UiToMain`: `renderDocFrame` gains `baseline: SpecHashProjection`; new `{ type: 'requestDocBaseline'; docId: string }`.
  - `MainToUi`: new `{ type: 'docBaseline'; docId: string; baseline: DocBaseline | null; live?: FoundationUnitContent | null }`.

- [ ] **Step 1: Write the failing test**

In `packages/plugin/test/fromSource.test.ts`, extend the extractor import:

```ts
import { extract, specHashProjection, contentHash } from '@spec-layer/extractor';
import type { ProseDrafts, SerializedNode } from '@spec-layer/extractor';
```

Add inside `describe('updateFromSource', ...)`, after the "omits prose" test:

```ts
  it('sends the hash projection as the baseline, and its hash is the message contentHash', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), goodSource, ui);
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      contentHash: string; baseline: unknown;
    };
    const expected = specHashProjection(extract(goodSource.node, { figmaFile: goodSource.fileKey }));
    expect(msg.baseline).toEqual(expected);
    expect(contentHash(msg.baseline)).toBe(msg.contentHash);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/fromSource.test.ts`
Expected: FAIL: `msg.baseline` is `undefined`.

- [ ] **Step 3: Extend the message types**

In `packages/plugin/src/messages.ts`, change the first import line to:

```ts
import type {
  SerializedNode, SerializedFoundation, FoundationSelection, FoundationScope, ProseDrafts,
  SpecHashProjection, FoundationUnitContent,
} from '@spec-layer/extractor';
```

and the docLink import to:

```ts
import type { DocConfig, FoundationConfig, DocBaseline } from './docLink';
```

In `UiToMain`, replace the `renderDocFrame` member with:

```ts
  /** `baseline` is the projection `contentHash` was computed over, stored on
   *  the Section under DOC_BASELINE_KEY so the Library can later diff it
   *  against the live projection. Same object, same function: main wraps it
   *  with `kind` and `contentHash` and never recomputes it. */
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; extractorVersion: string; config: DocConfig; prose?: ProseDrafts; baseline: SpecHashProjection }
```

Add to `UiToMain` after `requestDocProse`:

```ts
  /** Lazy: sent only when a drifted row is expanded. Nothing new rides the
   *  `library` message, which is the hot path. */
  | { type: 'requestDocBaseline'; docId: string }
```

Add to `MainToUi` after `docProse`:

```ts
  /** Reply for `requestDocBaseline`. `baseline` is null when the Section is
   *  gone, unlinked, has no baseline, the baseline fails to parse, or its
   *  contentHash no longer equals the link's. For a foundation link `live` is
   *  the current unitContent for the doc's (retargeted) scope, the same object
   *  whose hash produced the row's badge; `live: null` means the scope no
   *  longer resolves. Absent for component links: the UI already holds the
   *  live projection from its drift check. */
  | { type: 'docBaseline'; docId: string; baseline: DocBaseline | null; live?: FoundationUnitContent | null }
```

- [ ] **Step 4: Send the baseline from both UI build paths**

In `packages/plugin/src/ui/actions.ts`, change the first import to include `specHashProjection`:

```ts
import {
  extract, ProseProxyError, specContentHash, specHashProjection, buildFoundation,
  buildFoundationArtifactV5, foundationDtcgDocument,
  buildComponentArtifactV5, componentAiContext, toYaml,
} from '@spec-layer/extractor';
```

At the first send site (inside `runCreateDocFrame`, around line 338), add one field after `contentHash`:

```ts
      contentHash: specContentHash(state.currentSpec!),
      baseline: specHashProjection(state.currentSpec!),
```

At the second send site (inside `updateFromSource`, around line 475), add after `contentHash: specContentHash(spec),`:

```ts
      baseline: specHashProjection(spec),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/fromSource.test.ts`
Expected: PASS. `npm run typecheck` will now FAIL on `main.ts` because `requestDocBaseline` is an unhandled `UiToMain` case only if the switch is exhaustive; either way continue to Step 6.

- [ ] **Step 6: Write points and the handler in `main.ts`**

Extend the extractor import in `packages/plugin/src/main.ts` (it already imports `unitContent`, `foundationContentHash`, `type FoundationUnitContent`); nothing new is needed from the extractor. Extend the docLink import to:

```ts
import {
  DOC_LINK_KEY, DOC_REGISTRY_KEY, DOC_PROSE_KEY, DOC_BASELINE_KEY,
  parseDocLink, serializeDocLink, parseRegistry, serializeRegistry, addDoc, pruneRegistry,
  textContentHash, isFoundationLink, foundationScopeKey, retargetScope,
  serializeProse, parseProse, mergeFoundationGroupDescriptions,
  serializeBaseline, baselineFor,
  type DocLinkData, type FoundationDocLink, type DocRegistry, type DocBaseline,
} from './docLink';
```

**Write point 1, `renderDocFrame`.** Directly after the line
`section.setPluginData(DOC_PROSE_KEY, msg.prose ? serializeProse(msg.prose) : '');` add:

```ts
        // The diff baseline: the projection msg.contentHash was computed over,
        // written in the same commit as the link so the two can never disagree.
        // Over budget serializes to '' and the row shows the fallback until
        // the next Update.
        section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
          v: 1, kind: 'component', contentHash: msg.contentHash, projection: msg.baseline,
        }));
```

**Write point 2, `renderFoundation`.** Directly after
`section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));` inside the units loop (the line that follows `data.selfHash = textContentHash(collectGeneratedLane(section));`) add:

```ts
          // `content` is the object foundationContentHash hashed for this
          // link, so it is the baseline verbatim.
          section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
            v: 1, kind: 'foundation', contentHash: data.contentHash, projection: content,
          }));
```

**Write point 3, `updateFoundationDoc`.** Directly after
`section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));` in that handler add:

```ts
        section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
          v: 1, kind: 'foundation', contentHash: data.contentHash, projection: content,
        }));
```

**Clear point, `detachDoc`.** Replace the line
`if (node && node.type === 'SECTION') (node as SectionNode).setPluginData(DOC_LINK_KEY, '');` with:

```ts
        if (node && node.type === 'SECTION') {
          (node as SectionNode).setPluginData(DOC_LINK_KEY, '');
          (node as SectionNode).setPluginData(DOC_BASELINE_KEY, '');
        }
```

`removeDoc` needs no change: deleting the Section takes every key with it.

**Handler.** Add a new case directly after the `requestDocProse` case:

```ts
    case 'requestDocBaseline': {
      // Every failure resolves to `baseline: null` and the UI's fallback, never
      // to a partial answer. Same getNodeByIdAsync caveat as requestDocProse:
      // under dynamic-page access it can reject, not just resolve null.
      let baseline: DocBaseline | null = null;
      let live: FoundationUnitContent | null | undefined;
      try {
        const docNode = await figma.getNodeByIdAsync(msg.docId);
        const section = docNode && docNode.type === 'SECTION' ? (docNode as SectionNode) : null;
        const link = section ? parseDocLink(section.getPluginData(DOC_LINK_KEY)) : null;
        if (section && link) {
          baseline = baselineFor(link, section.getPluginData(DOC_BASELINE_KEY));
          if (baseline && isFoundationLink(link)) {
            // A fresh read, retargeted the way requestLibrary retargets, so
            // the live side of the diff is the object whose hash produced the
            // badge. Not the session cache: that can lag the library refresh.
            const { fileKey } = resolveFileKey(figma.fileKey, null);
            const dump = await serializeFoundation(
              createFoundationReader(figma.variables, figma), fileKey, new Date().toISOString(), figma.root.name,
            );
            const spec = buildFoundation(dump);
            live = unitContent(spec, retargetScope(link.scope, spec.collections));
          }
        }
      } catch (err) {
        console.error('[Spec Layer] baseline read failed for', msg.docId, err);
        baseline = null;
        live = undefined;
      }
      figma.ui.postMessage({
        type: 'docBaseline',
        docId: msg.docId,
        baseline,
        ...(live !== undefined ? { live } : {}),
      } as MainToUi);
      break;
    }
```

- [ ] **Step 7: Typecheck, build, sandbox scan**

Run: `npm run typecheck && npm run build:plugin && npm run check:sandbox`
Expected: all exit 0. The sandbox scan must stay clean: `docLink.ts` uses `utf8ByteLength`, not `TextEncoder`.

Run: `npx vitest run packages/plugin`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/ui/actions.ts packages/plugin/src/main.ts packages/plugin/test/fromSource.test.ts
git commit -m "feat(plugin): write the drift baseline with every doc and serve it on request"
```

---

### Task 7: View model change states and `resolveLibraryChanges`

**Files:**
- Modify: `packages/plugin/src/ui/viewModel/library.ts`
- Modify: `packages/plugin/src/ui/viewModel/contracts.ts`
- Test: `packages/plugin/test/libraryViewModel.test.ts`

**Interfaces:**
- Consumes: `ChangeGroup`, `componentChangeGroups`, `foundationChangeGroups`, `SpecHashProjection`, `FoundationUnitContent` from `@spec-layer/extractor`; `DocBaseline` from `../../docLink`.
- Produces (all exported from `viewModel/library.ts`):
  - `export type LibraryChangeState = 'idle' | 'pending' | 'ready' | 'unavailable'`
  - `export type LibraryChangeUnavailableReason = 'noBaseline' | 'staleVersion' | 'other'`
  - `export type LibraryChangeResult = { state: 'pending' } | { state: 'ready'; groups: ChangeGroup[] } | { state: 'unavailable'; reason: LibraryChangeUnavailableReason }`
  - `LibraryRowModel` gains `changeState: LibraryChangeState` and `changeUnavailableReason: LibraryChangeUnavailableReason | null`; `changeGroups` becomes `ChangeGroup[] | null`.
  - `BuildLibraryModelOptions` gains `changes?: ReadonlyMap<string, LibraryChangeResult>`.
  - `export function resolveLibraryChanges(input: { baseline: DocBaseline | null; live?: FoundationUnitContent | null; liveProjection?: SpecHashProjection }): LibraryChangeResult`

- [ ] **Step 1: Write the failing tests**

In `packages/plugin/test/libraryViewModel.test.ts`, extend the import from `'../src/ui/viewModel/library'` with `resolveLibraryChanges, type LibraryChangeResult`, and add:

```ts
import type { SpecHashProjection, FoundationUnitContent } from '@spec-layer/extractor';
import type { ComponentDocBaseline, FoundationDocBaseline } from '../src/docLink';
```

Find the existing test at line 116 that has `changeGroups: null` in an expected object (in `describe('buildLibraryRow capabilities')`) and add to that same expected object:

```ts
      changeState: 'pending',
      changeUnavailableReason: null,
```

(the row in that test is expanded, so it reads as pending)

Append at the end of the file:

```ts
describe('change states', () => {
  const drifted = new Map<string, LibraryDriftState>([['doc-1', 'drifted']]);
  const groups = [{ label: 'Tokens', items: ['Label / fill: a changed to b'] }];

  it('is idle for a row that is not expanded, even when a result exists', () => {
    const changes = new Map<string, LibraryChangeResult>([['doc-1', { state: 'ready', groups }]]);
    const row = buildLibraryRow(entry(), { drift: drifted, changes });
    expect(row.expanded).toBe(false);
    expect(row.changeState).toBe('idle');
    expect(row.changeGroups).toBeNull();
    expect(row.changeUnavailableReason).toBeNull();
  });

  it('is pending when expanded with no result yet', () => {
    const row = buildLibraryRow(entry(), { drift: drifted, expandedDocId: 'doc-1' });
    expect(row.expanded).toBe(true);
    expect(row.changeState).toBe('pending');
    expect(row.changeGroups).toBeNull();
  });

  it('is ready with groups when the result landed', () => {
    const changes = new Map<string, LibraryChangeResult>([['doc-1', { state: 'ready', groups }]]);
    const row = buildLibraryRow(entry(), { drift: drifted, expandedDocId: 'doc-1', changes });
    expect(row.changeState).toBe('ready');
    expect(row.changeGroups).toEqual(groups);
    expect(row.changeUnavailableReason).toBeNull();
  });

  it('is unavailable with its reason', () => {
    const changes = new Map<string, LibraryChangeResult>([['doc-1', { state: 'unavailable', reason: 'noBaseline' }]]);
    const row = buildLibraryRow(entry(), { drift: drifted, expandedDocId: 'doc-1', changes });
    expect(row.changeState).toBe('unavailable');
    expect(row.changeGroups).toBeNull();
    expect(row.changeUnavailableReason).toBe('noBaseline');
  });

  it('never expands a row whose status is not updateAvailable, so it stays idle', () => {
    for (const drift of ['inSync', 'staleVersion', 'pending', 'unavailable'] as LibraryDriftState[]) {
      const row = buildLibraryRow(entry(), {
        drift: new Map([['doc-1', drift]]), expandedDocId: 'doc-1',
        changes: new Map([['doc-1', { state: 'ready', groups }]]),
      });
      expect(row.expanded).toBe(false);
      expect(row.changeState).toBe('idle');
    }
    const edited = buildLibraryRow(entry({ selfEdited: true }), {
      drift: new Map([['doc-1', 'inSync']]), expandedDocId: 'doc-1',
    });
    expect(edited.status).toBe('edited');
    expect(edited.changeState).toBe('idle');
  });
});

describe('resolveLibraryChanges', () => {
  const projection: SpecHashProjection = {
    name: 'Button', figmaKey: 'k', figmaFile: 'F', figmaNode: '1:1', anatomyComponentId: '1:2',
    anatomy: [], props: [], variants: [], variantInstances: [], states: ['default'],
    tokens: [], related: [], gaps: [], layout: [],
  };
  const unit: FoundationUnitContent = {
    collectionName: 'Semantic', modeNames: ['Light'], omittedModeNames: [],
    rows: [{ kind: 'variable', name: 'bg/brand', description: '', resolvedType: 'COLOR',
      cells: [{ modeName: 'Light', value: { kind: 'color', hex: '#0055FF', alpha: 1 } }] }],
  };
  const component: ComponentDocBaseline = { v: 1, kind: 'component', contentHash: 'a', projection };
  const foundation: FoundationDocBaseline = { v: 1, kind: 'foundation', contentHash: 'f', projection: unit };

  it('is unavailable with noBaseline when main sent none', () => {
    expect(resolveLibraryChanges({ baseline: null })).toEqual({ state: 'unavailable', reason: 'noBaseline' });
    expect(resolveLibraryChanges({ baseline: null, liveProjection: projection }))
      .toEqual({ state: 'unavailable', reason: 'noBaseline' });
  });

  it('diffs a component baseline against the cached live projection', () => {
    const live = { ...projection, states: ['default', 'hover'] };
    expect(resolveLibraryChanges({ baseline: component, liveProjection: live })).toEqual({
      state: 'ready', groups: [{ label: 'States', items: ['Added state hover'] }],
    });
  });

  it('is unavailable when a component row has no cached live projection', () => {
    expect(resolveLibraryChanges({ baseline: component })).toEqual({ state: 'unavailable', reason: 'other' });
  });

  it('diffs a foundation baseline against the live unit content main sent', () => {
    const live: FoundationUnitContent = { ...unit, modeNames: ['Light', 'Dark'] };
    expect(resolveLibraryChanges({ baseline: foundation, live })).toEqual({
      state: 'ready', groups: [{ label: 'Modes', items: ['Added mode Dark'] }],
    });
  });

  it('is unavailable when the foundation scope no longer resolves or live is missing', () => {
    expect(resolveLibraryChanges({ baseline: foundation, live: null })).toEqual({ state: 'unavailable', reason: 'other' });
    expect(resolveLibraryChanges({ baseline: foundation })).toEqual({ state: 'unavailable', reason: 'other' });
  });

  it('is ready with no groups when the two sides are identical', () => {
    expect(resolveLibraryChanges({ baseline: component, liveProjection: projection })).toEqual({ state: 'ready', groups: [] });
  });

  it('turns a throwing diff into unavailable rather than propagating', () => {
    const broken = { ...component, projection: null as unknown as SpecHashProjection };
    expect(resolveLibraryChanges({ baseline: broken, liveProjection: projection })).toEqual({ state: 'unavailable', reason: 'other' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/libraryViewModel.test.ts`
Expected: FAIL: `resolveLibraryChanges is not a function`, and the `changeState` expectations fail.

- [ ] **Step 3: Implement in the view model**

In `packages/plugin/src/ui/viewModel/library.ts`, replace the imports with:

```ts
import {
  componentChangeGroups, foundationChangeGroups,
  type ChangeGroup, type FoundationUnitContent, type SpecHashProjection,
} from '@spec-layer/extractor';
import { resolveStatus, type DocBaseline } from '../../docLink';
import type { FoundationIconKind } from '../../foundationIcon';
import type { LibraryEntry } from '../../messages';
```

After the `LibraryFilter` type add:

```ts
/**
 * Where an expanded row's change list stands. `idle` is every row that is not
 * expanded. Expanding a drifted row sets `pending` and asks main for the
 * baseline; the reply resolves to `ready` (possibly with no groups) or
 * `unavailable` with the reason the UI knows.
 */
export type LibraryChangeState = 'idle' | 'pending' | 'ready' | 'unavailable';

export type LibraryChangeUnavailableReason =
  /** Main sent no baseline: the doc predates baselines, its baseline was
   *  over budget, or it no longer matches the link. An Update writes one. */
  | 'noBaseline'
  /** The doc was built by an older extractor; a hash diff is meaningless. */
  | 'staleVersion'
  /** Anything else: no live side, or the diff itself failed. */
  | 'other';

export type LibraryChangeResult =
  | { state: 'pending' }
  | { state: 'ready'; groups: ChangeGroup[] }
  | { state: 'unavailable'; reason: LibraryChangeUnavailableReason };
```

In `LibraryRowModel`, replace the `changeGroups` member and its comment with:

```ts
  changeState: LibraryChangeState;
  /** Populated only in the `ready` state. `null` otherwise. */
  changeGroups: ChangeGroup[] | null;
  /** Populated only in the `unavailable` state. `null` otherwise. */
  changeUnavailableReason: LibraryChangeUnavailableReason | null;
```

In `BuildLibraryModelOptions` add:

```ts
  /** Per-doc change results for the current refresh pass; a row not in the
   *  map that is expanded reads as `pending`. */
  changes?: ReadonlyMap<string, LibraryChangeResult>;
```

In `buildLibraryRow`, before the `return`, compute:

```ts
  const expanded = options.expandedDocId === entry.docId && status === 'updateAvailable';
  const change: LibraryChangeResult | null = expanded
    ? options.changes?.get(entry.docId) ?? { state: 'pending' }
    : null;
```

and in the returned object replace `expanded: ...` and `changeGroups: null,` with:

```ts
    expanded,
    changeState: change ? change.state : 'idle',
    changeGroups: change?.state === 'ready' ? change.groups : null,
    changeUnavailableReason: change?.state === 'unavailable' ? change.reason : null,
```

Append at the end of the file:

```ts
/**
 * Turn a `docBaseline` reply into the row's change result. Pure so every branch
 * is testable without the message loop. Every failure is `unavailable`, never
 * a partial list.
 */
export function resolveLibraryChanges(input: {
  baseline: DocBaseline | null;
  live?: FoundationUnitContent | null;
  liveProjection?: SpecHashProjection;
}): LibraryChangeResult {
  if (!input.baseline) return { state: 'unavailable', reason: 'noBaseline' };
  try {
    if (input.baseline.kind === 'foundation') {
      if (!input.live) return { state: 'unavailable', reason: 'other' };
      return { state: 'ready', groups: foundationChangeGroups(input.baseline.projection, input.live) };
    }
    if (!input.liveProjection) return { state: 'unavailable', reason: 'other' };
    return { state: 'ready', groups: componentChangeGroups(input.baseline.projection, input.liveProjection) };
  } catch {
    return { state: 'unavailable', reason: 'other' };
  }
}
```

In `packages/plugin/src/ui/viewModel/contracts.ts`, `LibraryRowView` and the local `ChangeGroup` were deleted as dead in the final-review fix wave: nothing imported either of them from that file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/libraryViewModel.test.ts`
Expected: PASS. `npx vitest run packages/plugin/test/libraryScreen.test.ts` will FAIL on the missing `changeState` fields in its `row()` helper: that is Task 8.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/viewModel/library.ts packages/plugin/src/ui/viewModel/contracts.ts packages/plugin/test/libraryViewModel.test.ts
git commit -m "feat(plugin): model the library change states and resolve a baseline reply"
```

---

### Task 8: Render the change states in the Library screen

**Files:**
- Modify: `packages/plugin/src/ui/screens/library.ts`
- Test: `packages/plugin/test/libraryScreen.test.ts`

**Interfaces:**
- Consumes: `LibraryRowModel.changeState`, `changeUnavailableReason`, `changeGroups` (Task 7); `LibraryChangeUnavailableReason` type.
- Produces: markup only. The details panel body per state:
  - `pending`: `Comparing…`
  - `ready` with groups: one `<section class="sl-library-change-group">` per group (existing markup).
  - `ready` without groups: alert row "Source changed" + "No itemized differences were found."
  - `unavailable`: alert row "Source changed" + reason line.
  - `idle`: empty body (the panel is hidden anyway).

- [ ] **Step 1: Update the fixtures and write the failing tests**

In `packages/plugin/test/libraryScreen.test.ts`:

In the `row()` helper add after `changeGroups: null,`:

```ts
    changeState: 'idle',
    changeUnavailableReason: null,
```

Change the first `ROWS` entry to:

```ts
  row('buttonText', 'updateAvailable', { expanded: true, changeState: 'unavailable', changeUnavailableReason: 'other' }),
```

In the test "renders concrete groups without invented summary captions", add `changeState: 'ready',` beside `expanded: true,`. In "escapes document and change content before placing it in HTML", add `changeState: 'ready',` to both rows that carry `changeGroups`.

Then add, inside `describe('library screen presentation', ...)` after the "renders concrete groups" test:

```ts
  it('says it is comparing while the baseline is in flight', () => {
    const markup = libraryScrollMarkup(model({
      rows: [row('pendingDiff', 'updateAvailable', { expanded: true, changeState: 'pending' })],
    }));
    expect(markup).toContain('Comparing…');
    expect(markup).not.toContain('Source changed');
    expect(markup).not.toContain('<li>');
  });

  it('admits when a ready diff found nothing rather than showing an empty panel', () => {
    const markup = libraryScrollMarkup(model({
      rows: [row('emptyDiff', 'updateAvailable', { expanded: true, changeState: 'ready', changeGroups: [] })],
    }));
    expect(markup).toContain('<strong>Source changed</strong>');
    expect(markup).toContain('No itemized differences were found.');
  });

  it('names the reason a comparison is unavailable', () => {
    const line = (reason: 'noBaseline' | 'staleVersion' | 'other') => libraryScrollMarkup(model({
      rows: [row('why', 'updateAvailable', { expanded: true, changeState: 'unavailable', changeUnavailableReason: reason })],
    }));
    expect(line('noBaseline')).toContain('Update this doc once to enable change lists.');
    expect(line('staleVersion')).toContain('The extractor changed. Rebuild to compare future changes.');
    expect(line('other')).toContain('A detailed comparison isn&#39;t available. Review the source from the row menu.');
    for (const reason of ['noBaseline', 'staleVersion', 'other'] as const) {
      expect(line(reason)).toContain('<strong>Source changed</strong>');
    }
  });

  it('renders no change copy at all for an idle row', () => {
    const markup = libraryScrollMarkup(model({
      rows: [row('idleRow', 'updateAvailable', { expanded: false, changeState: 'idle' })],
    }));
    expect(markup).not.toContain('Comparing…');
    expect(markup).not.toContain('Source changed');
  });

  it('keeps the plugin voice in every change line', () => {
    const markup = libraryScrollMarkup(model({
      rows: [
        row('a', 'updateAvailable', { expanded: true, changeState: 'pending' }),
        row('b', 'updateAvailable', { expanded: true, changeState: 'ready', changeGroups: [] }),
        row('c', 'updateAvailable', { expanded: true, changeState: 'unavailable', changeUnavailableReason: 'noBaseline' }),
        row('d', 'updateAvailable', { expanded: true, changeState: 'unavailable', changeUnavailableReason: 'staleVersion' }),
      ],
    }));
    // Scope the check to the change panels: other parts of the screen (the
    // unknown-age label, for one) legitimately use the character.
    const panels = markup
      .split('class="sl-library-change-list">')
      .slice(1)
      .map((rest) => rest.split('</div></div>')[0]);
    expect(panels).toHaveLength(4);
    for (const panel of panels) expect(panel).not.toContain('—');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/libraryScreen.test.ts`
Expected: FAIL on "says it is comparing" (no `Comparing…` in the markup) and the reason lines.

- [ ] **Step 3: Implement the rendering**

In `packages/plugin/src/ui/screens/library.ts`, extend the view model type import:

```ts
import type {
  LibraryChangeUnavailableReason,
  LibraryFilter,
  LibraryModel,
  LibraryRowModel,
  LibraryRowStatus,
} from '../viewModel/library';
```

Replace `changeDetailsMarkup` and add the copy table above it:

```ts
/**
 * The second line under "Source changed" when no list can be shown. The
 * `other` line is the pre-baseline fallback, kept verbatim. Pre-escaped
 * because it is placed in HTML directly, not through esc().
 */
const CHANGE_UNAVAILABLE_COPY: Record<LibraryChangeUnavailableReason, string> = {
  noBaseline: 'Update this doc once to enable change lists.',
  staleVersion: 'The extractor changed. Rebuild to compare future changes.',
  other: 'A detailed comparison isn&#39;t available. Review the source from the row menu.',
};

function changeFallbackMarkup(detail: string): string {
  return (
    '<div class="sl-library-change-fallback">' +
    `${icon('alertCircle', 16)}<span><strong>Source changed</strong>` +
    `<small>${detail}</small>` +
    '</span></div>'
  );
}

function changeContentMarkup(row: LibraryRowPresentation): string {
  switch (row.changeState) {
    case 'idle':
      return '';
    case 'pending':
      // Reuses the fallback container so the pending line needs no new CSS.
      return '<div class="sl-library-change-fallback"><span><strong>Comparing…</strong></span></div>';
    case 'ready':
      return row.changeGroups?.length
        ? row.changeGroups.map(changeGroupMarkup).join('')
        // Should not occur: the diff input is the hash input. Better than an
        // empty panel if it does.
        : changeFallbackMarkup('No itemized differences were found.');
    case 'unavailable':
      return changeFallbackMarkup(CHANGE_UNAVAILABLE_COPY[row.changeUnavailableReason ?? 'other']);
  }
}

function changeDetailsMarkup(row: LibraryRowPresentation): string {
  return (
    `<div id="sl-library-details-${esc(row.docId)}" class="sl-library-details"` +
    `${row.expanded ? '' : ' hidden'}>` +
    '<div class="sl-library-details-inner">' +
    '<h2>Changes</h2>' +
    `<div class="sl-library-change-list">${changeContentMarkup(row)}</div>` +
    '</div></div>'
  );
}
```

`LibraryRowPresentation` extends `Omit<LibraryRowModel, 'changeGroups'>` and so already carries `changeState` and `changeUnavailableReason` from Task 7. No change needed there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/libraryScreen.test.ts`
Expected: PASS, including the pre-existing "uses the honest detailed-comparison fallback verbatim" test.

- [ ] **Step 5: Run every plugin test that builds rows, then commit**

Run: `npx vitest run packages/plugin && npm run lint && npm run typecheck`
Expected: PASS. If `harness.ts` (the dev harness) fails typecheck because it builds a `LibraryRowModel` literal, add `changeState: 'idle', changeUnavailableReason: null` to that literal.

```bash
git add packages/plugin/src/ui/screens/library.ts packages/plugin/test/libraryScreen.test.ts
git commit -m "feat(plugin): render library change states and fallback reasons"
```

---

### Task 9: Controller wiring in `ui-vnext.ts`

**Files:**
- Modify: `packages/plugin/src/ui/ui-vnext.ts`

**Interfaces:**
- Consumes: `specHashProjection`, `contentHash`, `SpecHashProjection` from the extractor; `LibraryChangeResult`, `resolveLibraryChanges` from the view model; `requestDocBaseline` / `docBaseline` messages (Task 6).
- Produces: no new exports. `main.ts` and `ui-vnext.ts` are outside coverage; verification is typecheck, build, sandbox scan, and the manual matrix rows in Task 10.

- [ ] **Step 1: Imports and state**

Change line 8 of `packages/plugin/src/ui/ui-vnext.ts` to:

```ts
import {
  extract, ProseProxyError, specHashProjection, contentHash, EXTRACTOR_VERSION,
  type SpecHashProjection,
} from '@spec-layer/extractor';
```

`specContentHash` was imported here only for the drift check; confirm with `grep -n specContentHash packages/plugin/src/ui/ui-vnext.ts` that no other use remains after Step 3. If one does, keep `specContentHash` in the import too.

Find the import from `'./viewModel/library'` (search for `buildLibraryModel`) and add `resolveLibraryChanges` and `type LibraryChangeResult` to it.

After the line `const libraryExtractorVersion = new Map<string, string | undefined>();` add:

```ts
// docId → the live SpecHashProjection computed during this pass's drift check,
// kept for every component row (not only drifted ones) so a row that drifts
// on the next refresh needs no second round trip. A few kilobytes per row.
const libraryLiveProjection = new Map<string, SpecHashProjection>();
// docId → change result for the current refresh pass. Cleared with the other
// library maps; a new pass starts every expansion from `pending` again.
const libraryChanges = new Map<string, LibraryChangeResult>();
```

- [ ] **Step 2: Pass the results into the model**

In `currentLibraryModel()` add `changes: libraryChanges,` to the options object:

```ts
  return buildLibraryModel(libraryEntries, {
    drift: libraryDrift,
    filter: libraryFilter,
    expandedDocId: libraryExpandedDocId,
    changes: libraryChanges,
  });
```

- [ ] **Step 3: Clear on refresh, record the live projection on drift**

In `startLibraryDriftChecks()`, after `libraryExtractorVersion.clear();` add:

```ts
  libraryLiveProjection.clear();
  libraryChanges.clear();
```

In `refreshLibrary()`, after `libraryExpandedDocId = null;` add:

```ts
  libraryChanges.clear();
```

In the `case 'driftSource':` handler replace the `try` block body:

```ts
          const spec = extract(msg.node, { figmaFile: msg.fileKey, ...(msg.fileName ? { figmaFileName: msg.fileName } : {}) });
          libraryDrift.set(
            msg.docId,
            specContentHash(spec) === baseline ? 'inSync' : 'drifted',
          );
```

with:

```ts
          const spec = extract(msg.node, { figmaFile: msg.fileKey, ...(msg.fileName ? { figmaFileName: msg.fileName } : {}) });
          // One projection serves both the hash and the later diff, so the
          // live side of "Review detected changes" is the object that decided
          // the badge.
          const projection = specHashProjection(spec);
          libraryLiveProjection.set(msg.docId, projection);
          libraryDrift.set(
            msg.docId,
            contentHash(projection) === baseline ? 'inSync' : 'drifted',
          );
```

- [ ] **Step 4: One toggle for both expansion paths**

Add near `closeLibraryMenu`:

```ts
/**
 * Expand or collapse a row's change panel. Opening a row the pass has not
 * compared yet marks it pending and asks main for the stored baseline; the
 * `docBaseline` reply resolves it. Collapsing keeps the cached result.
 */
function toggleLibraryReview(docId: string): void {
  const opening = libraryExpandedDocId !== docId;
  libraryExpandedDocId = opening ? docId : null;
  if (opening && !libraryChanges.has(docId)) {
    libraryChanges.set(docId, { state: 'pending' });
    send({ type: 'requestDocBaseline', docId });
  }
}
```

In the click handler, replace the disclosure branch body line
`libraryExpandedDocId = libraryExpandedDocId === docId ? null : docId;` (around line 1479) with `toggleLibraryReview(docId);`, and in the `case 'review':` branch (around line 1521) replace the same line with `toggleLibraryReview(docId);`.

- [ ] **Step 5: Handle the reply and the removals**

Add a new case to the `MainToUi` message switch, directly after the `case 'driftError':` block:

```ts
    case 'docBaseline': {
      // Only a reply this pass asked for and is still waiting on; a reply that
      // outlived a refresh would otherwise revive a cleared row.
      const waiting = libraryChanges.get(msg.docId);
      if (!waiting || waiting.state !== 'pending') return;
      libraryChanges.set(msg.docId, resolveLibraryChanges({
        baseline: msg.baseline,
        live: msg.live,
        liveProjection: libraryLiveProjection.get(msg.docId),
      }));
      if (view === 'library') paint();
      return;
    }
```

In the `case 'docDetached': case 'docRemoved':` block, after `libraryExtractorVersion.delete(msg.docId);` add:

```ts
      libraryLiveProjection.delete(msg.docId);
      libraryChanges.delete(msg.docId);
```

- [ ] **Step 6: Typecheck, build, sandbox scan, full gate**

Run: `grep -n "specContentHash" packages/plugin/src/ui/ui-vnext.ts`
Expected: no output (or only in comments). Remove it from the import if unused.

Run: `npm run check`
Expected: exit 0 for every stage: lint, typecheck, NUL scan, tests, plugin build, CLI build, sandbox scan, proxy dry run. Read the exit status directly; do not pipe it.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/ui-vnext.ts
git commit -m "feat(plugin): review detected changes lists what moved the hash"
```

---

### Task 10: Documentation and the manual matrix rows

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `ARCHITECTURE.md` (the paragraph beginning "Foundation Sections join the same doc registry", line 74)
- Modify: `docs/plugin-knowledge-map.md` (after the paragraph ending "filling any section the doc does not render.", line 99)
- Modify: `docs/reviews/2026-09-05-major-review.md` (finding 8 at line 73, U2 at line 307, X4 at line 368, order item 14 at line 503)
- Modify: `packages/plugin/TESTING.md` (Library section, after item 11)
- Modify: `docs/superpowers/specs/2026-09-06-library-semantic-diff-design.md` (status line)

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]` → `### Added`, add as the first entry:

```markdown
- **Review detected changes** in the Library now lists what changed. Every
  generated Section stores the exact object its drift hash was computed over,
  under its own plugin data key (`specLayerBaseline`, 90 kB budget, dropped
  whole when over). Expanding a row marked Update available diffs that
  baseline against the live projection and shows added, removed and changed
  items with before and after values, grouped as Name, Properties, Variants,
  Anatomy, States, Tokens, Unbound values, Layout and Related for components,
  and Tokens, Descriptions, Modes and Part for Foundation docs. The diff input
  is the hash input, so a list can never disagree with the badge. Docs
  generated before this release show "Update this doc once to enable change
  lists." until their next Update. No hash, `EXTRACTOR_VERSION`, schema, or
  artifact changed. The keyed-list core (`diffKeyed`) is the piece the planned
  `spec-layer diff` command will reuse.
```

- [ ] **Step 2: ARCHITECTURE**

Append to the paragraph at line 74 of `ARCHITECTURE.md` (after "...reads as out of date rather than as missing."):

```markdown
 Beside each link, under `DOC_BASELINE_KEY`, the Section stores the exact object its content hash was computed over: `specHashProjection(spec)` for a component, `unitContent(spec, scope)` for a foundation unit. The rule is that the diff input is the hash input. "Review detected changes" diffs that stored projection against the live one (`packages/extractor/src/diff.ts`), so a change list can never disagree with the badge in either direction; comparing the v5 artifact instead was rejected for exactly that reason. The baseline is written in the same commit as the link, has its own 90 kB budget, is dropped whole rather than truncated, and is rejected on read unless its kind and `contentHash` match the link. It never participates in a hash.
```

- [ ] **Step 3: Knowledge map**

After the paragraph ending "`DOC_PROSE_KEY` blob filling any section the doc does not render." in `docs/plugin-knowledge-map.md`, add:

```markdown
"Review detected changes" on an Update available row asks the main thread for
the doc's stored baseline (`DOC_BASELINE_KEY` in `docLink.ts`, written beside
the link on every create and Update) and diffs it in the UI against the live
projection with `componentChangeGroups` or `foundationChangeGroups` from the
extractor's `diff.ts`. The baseline is the hash projection itself, so the
list and the badge cannot disagree. A doc without a baseline shows "Update
this doc once to enable change lists." Nothing about this rides the
`library` message.
```

- [ ] **Step 4: Review document**

In `docs/reviews/2026-09-05-major-review.md`:

At the end of finding 8 (the paragraph starting `8. **The Library's "Review detected changes" always lands on a fallback**`), append the sentence:

```markdown
   Addressed 2026-09-06: `docs/superpowers/specs/2026-09-06-library-semantic-diff-design.md`.
```

At the end of the **U2** paragraph, append:

```markdown
Addressed 2026-09-06 by the library semantic diff (spec
`docs/superpowers/specs/2026-09-06-library-semantic-diff-design.md`): the
stored baseline is the hash projection, and `diffKeyed` is the core the
`diff` command will reuse.
```

Change the **X4** line to:

```markdown
**X4. Review that cannot review (U2).** Addressed 2026-09-06, see U2.
```

Change order-of-work item 14 to:

```markdown
14. ~~Semantic diff for Library review, shared with the planned `diff` command (U2).~~ Shipped 2026-09-06.
```

- [ ] **Step 5: TESTING.md rows**

In `packages/plugin/TESTING.md`, in the `## Library` section after item 11, add:

```markdown
12. **Review detected changes** lists what changed. Generate a component doc
    and a Foundation doc. In the source component, change one bound token
    (rebind a fill to a different variable), one unbound value (a hardcoded
    padding number), and one variant value (rename an option). In the
    Foundation source, change one variable value in one mode. Refresh
    Library. Each row reads **Update available**. Open **Review detected
    changes** on each: the panel says "Comparing…" briefly, then lists each
    edit exactly once with its before and after value, spelled "changed to",
    under the right group (Tokens, Unbound values, Variants for the
    component; Tokens for the Foundation). No item names anything you did
    not change. Run **Update documentation** and confirm the row returns to
    **In sync** and the panel is no longer offered.
13. A doc generated before this build (or one whose baseline was cleared by
    **Detach**, then reconnected by a fresh Create) shows "Source changed"
    with "Update this doc once to enable change lists." Run **Update
    documentation**, change the source again, refresh, and confirm the list
    now appears.
```

- [ ] **Step 6: Spec status line**

In `docs/superpowers/specs/2026-09-06-library-semantic-diff-design.md`, change
`**Status:** Approved design, not yet implemented.` to
`**Status:** Implemented 2026-09-06 (plan: docs/superpowers/plans/2026-09-06-library-semantic-diff.md). Manual matrix rows 12 and 13 in packages/plugin/TESTING.md pending.`

- [ ] **Step 7: NUL check and full gate**

Run: `npm run check:nul && npm run check`
Expected: exit 0. `check:nul` does not cover `docs/`, so also run:

```bash
grep -rlP '\x00' docs/ ARCHITECTURE.md CHANGELOG.md packages/plugin/TESTING.md || echo "no NUL bytes"
```

Expected: `no NUL bytes`.

- [ ] **Step 8: Commit**

```bash
git add CHANGELOG.md ARCHITECTURE.md docs/plugin-knowledge-map.md docs/reviews/2026-09-05-major-review.md packages/plugin/TESTING.md docs/superpowers/specs/2026-09-06-library-semantic-diff-design.md
git commit -m "docs: record the library semantic diff as shipped"
```

---

## Self-review against the spec

**Spec coverage.**
- §3 storage: key, types, budget, `serializeBaseline`/`parseBaseline`/`baselineFor`, three write points, detach clear → Tasks 5, 6.
- §4 wire protocol: `renderDocFrame.baseline`, `requestDocBaseline`, `docBaseline` with `live` for foundation only, lazy reads, `libraryLiveProjection` for every component row → Tasks 6, 9.
- §5.1 `diffKeyed` with canonical equality, duplicate tolerance, output order → Task 2.
- §5.2 both group builders, fixed group order, identity-only case, changed-type row, cell itemization → Tasks 3, 4.
- §5.3 formatters → Task 3.
- §6 four change states, panel bodies, three fallback lines, menu unchanged → Tasks 7, 8, 9.
- §7 every failure resolves to `unavailable` → `resolveLibraryChanges` try/catch (Task 7), main handler try/catch (Task 6), stale-reply guard (Task 9).
- §8 tests: `diff.test.ts`, `specHash.test.ts`, `docLink.test.ts`, `libraryViewModel.test.ts`, `libraryScreen.test.ts`, TESTING.md rows → Tasks 1 to 8, 10.
- §10 documents → Task 10.

**Known deviation, stated.** The `staleVersion` change-unavailable reason was removed in the final-review fix wave as unreachable tested dead code: a `rebuildNeeded` row is never `updateAvailable`, so it never expands.

**Type consistency.** `SpecHashProjection` (hash.ts) is used by diff.ts, docLink.ts, messages.ts, viewModel/library.ts, ui-vnext.ts under that exact name. `ChangeGroup` is defined once in diff.ts and re-exported through contracts.ts. `LibraryChangeResult`, `LibraryChangeState`, `LibraryChangeUnavailableReason`, `resolveLibraryChanges` are defined in viewModel/library.ts and consumed by screens/library.ts and ui-vnext.ts. `DocBaseline` is defined in docLink.ts and consumed by messages.ts, main.ts, viewModel/library.ts.
