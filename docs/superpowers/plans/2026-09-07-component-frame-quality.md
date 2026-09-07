# Component Frame Quality Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Configuration section with a Properties table that maps each property to the parts it drives, trim the Anatomy legend, fix two extractor defects behind fixtures, bump the extractor version with a locale-safe canvas hash, and ship a debug timing build plus a canvas checklist.

**Architecture:** The plugin serializer (`packages/plugin/src/serialize.ts`) gains two reads: per-node component property references and the resolved name of an instance-swap default. The Figma-free extractor (`packages/extractor`) turns those into `affects` and `defaultLabel` on `ComponentProp`, and fixes the radius gap check and the anatomy wrapper descent. The UI doc model (`packages/plugin/src/ui/docModel.ts`) builds the Properties table and the trimmed legend; `docFrame.ts` renders them. A compile-time flag in `build.mjs` enables timing code on the main thread that is removed from the shipped bundle.

**Tech Stack:** TypeScript, Vitest, esbuild, npm workspaces, Node >= 22. No framework.

**Spec:** `docs/superpowers/specs/2026-09-06-component-frame-quality-design.md`.

## Global Constraints

- The extractor is Figma-free. Nothing under `packages/extractor` may reference `figma`.
- The main thread has no browser globals. `npm run check:sandbox` scans `dist/main.js`. `Date.now()` is allowed; `performance` is not.
- `EXTRACTOR_VERSION` becomes `'3'` in this plan. Nothing else may bump it.
- Do not use `localeCompare` under `src/v5` or, after Task 1, in `hash.ts`. Use `compareCodeUnits` from `packages/extractor/src/v5/diagnostics.ts`.
- Never fabricate. Unknown is absent, `null`, or a dash. The Affects cell and the instance-swap default show a dash when Figma states nothing.
- Plugin UI copy: sentence case, no em dashes, no hype words. The section label is `Properties`, the empty state is `No properties`, the legend line begins `Controlled by: `.
- The section id `configuration` is kept. Only its label changes. `KNOWN_SECTION_IDS` must still contain `configuration`.
- The v5 artifact and the brief must not change. `apiOf` in `brief.ts` projects explicit fields, so `affects` and `defaultLabel` must not be added there.
- Single-line conventional commits, lowercase, scoped. Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on its own line.
- Fixtures are synthetic. Never commit a customer file.
- `npm run check:nul` guards `packages/`. Do not write NUL bytes anywhere; separators are spaces.
- The debug build's timing code must compile away under the normal build. `npm run check:sandbox` must pass on both bundles.

## File map

| File | Change |
|---|---|
| `packages/extractor/src/version.ts` | `EXTRACTOR_VERSION = '3'` |
| `packages/extractor/src/hash.ts` | `canonical` sorts with `compareCodeUnits` |
| `packages/extractor/src/tokens.ts` | radius gap uses all five radius bindings |
| `packages/extractor/src/rawValues.ts` | shares `RADIUS_BINDINGS` from a new `bindingSets.ts` |
| `packages/extractor/src/bindingSets.ts` | new: `RADIUS_BINDINGS`, `PADDING_BINDINGS` |
| `packages/extractor/src/anatomy.ts` | multi-wrapper descent, bounded at three |
| `packages/extractor/src/tree.ts` | `SerializedNode.propertyRefs`, `PropertyDefinition.defaultLabel` |
| `packages/extractor/src/props.ts` | `ComponentProp.affects`, `ComponentProp.defaultLabel`, `propertiesByPart` |
| `packages/extractor/test/fixtures/radius-partial.json` | new fixture |
| `packages/extractor/test/fixtures/double-wrapper.json` | new fixture |
| `packages/extractor/test/fixtures/properties.json` | new fixture |
| `packages/plugin/src/serialize.ts` | `NodeResolver.componentName`, `propertyRefs`, `defaultLabel` |
| `packages/plugin/src/resolverMemo.ts` | memoize `componentName` |
| `packages/plugin/src/main.ts` | `componentName` resolver, timing hooks |
| `packages/plugin/src/ui/docModel.ts` | Properties block, trimmed anatomy block |
| `packages/plugin/src/docFrame.ts` | legend Controlled by line, table view without tokens, timing hooks |
| `packages/plugin/src/timing.ts` | new: main-thread timing recorder behind the flag |
| `packages/plugin/src/messages.ts` | `timingSummary` message |
| `packages/plugin/src/ui/ui-vnext.ts` | show the timing summary when it arrives |
| `packages/plugin/build.mjs` | `--debug-timing` flag and `__SPEC_LAYER_TIMING__` define |
| `package.json` | `build:plugin:debug`, `check:sandbox:debug` scripts |
| `docs/manual-tests/2026-09-07-component-frame-quality.md` | new checklist |
| `packages/plugin/TESTING.md`, `CHANGELOG.md`, `docs/plugin-knowledge-map.md`, `docs/reviews/2026-09-05-major-review.md`, `CLAUDE.md` | documentation |

---

### Task 1: Extractor version 3 and the code-unit canvas hash

**Files:**
- Modify: `packages/extractor/src/version.ts:21`
- Modify: `packages/extractor/src/hash.ts:8-19`
- Test: `packages/extractor/test/specHash.test.ts`
- Modify: `CHANGELOG.md` (Unreleased, Changed)

**Interfaces:**
- Consumes: `compareCodeUnits(a: string, b: string): number` from `packages/extractor/src/v5/diagnostics.ts`.
- Produces: `EXTRACTOR_VERSION === '3'`. `canonical()` in `hash.ts` sorts object keys by UTF-16 code units. Every later task that pins a hash golden pins the value produced after this task.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/specHash.test.ts`:

```ts
import { EXTRACTOR_VERSION } from '../src/version';

import { sha256 } from 'js-sha256';

describe('canonical ordering', () => {
  it('sorts object keys by code units, not by locale', () => {
    // By code units 'B' (0x42) precedes 'a' (0x61); every ICU collation puts a
    // before B. The canonical string is what contentHash hashes, so the hash
    // of {a, B} must equal the SHA-256 of the B-first serialization.
    expect(contentHash({ a: 1, B: 2 })).toBe(sha256('{"B":2,"a":1}'));
    expect(canonicalEqual({ a: 1, B: 2 }, { B: 2, a: 1 })).toBe(true);
  });

  it('is independent of the process locale', () => {
    const original = String.prototype.localeCompare;
    // Simulate a collation that reverses ASCII order. If canonical() still
    // used localeCompare, the hash would move.
    String.prototype.localeCompare = function (this: string, other: string) {
      return this < other ? 1 : this > other ? -1 : 0;
    } as typeof String.prototype.localeCompare;
    try {
      const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
      expect(specContentHash(extract(node, { figmaFile: 'FILE1' }))).toBe(BUTTON_HASH);
    } finally {
      String.prototype.localeCompare = original;
    }
  });
});

describe('EXTRACTOR_VERSION', () => {
  it('is 3 after the properties and hash ordering change', () => {
    expect(EXTRACTOR_VERSION).toBe('3');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/specHash.test.ts`
Expected: FAIL. The version test fails with `'2'`, and the locale test fails because `canonical` still calls `localeCompare`.

- [ ] **Step 3: Switch the canonicalizer and bump the version**

In `packages/extractor/src/hash.ts` replace the import block and the sort:

```ts
import { sha256 } from 'js-sha256';
import type { IntermediateSpec, VariantInstance } from './extract';
import type { ComponentProp, VariantAxis } from './props';
import type { GapIssue } from './tokens';
import { unitContent, type FoundationSpec, type FoundationScope } from './foundation';
import { compareCodeUnits } from './v5/diagnostics';

/** Canonical JSON: object keys sorted recursively by UTF-16 code units, then
 *  SHA-256. Code units, not `localeCompare`: this runs in the UI iframe, which
 *  has full ICU, so a locale-aware sort would make two collaborators on
 *  different OS locales disagree on the same component's hash. Switched at
 *  EXTRACTOR_VERSION 3, which already asked every document to rebuild. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareCodeUnits(a, b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
```

In `packages/extractor/src/version.ts` change the last line to:

```ts
export const EXTRACTOR_VERSION = '3';
```

and add to the doc comment above it, before the closing `*/`:

```
 * History: '2' → '3' on 2026-09-07. Component properties gained `affects` and
 * `defaultLabel` (new serializer reads), anatomy descends through stacked
 * wrappers, the radius gap check covers every corner binding, and the canvas
 * hash switched from localeCompare to code-unit key ordering.
```

- [ ] **Step 4: Run the hash suite and re-cut any moved pins**

Run: `npx vitest run packages/extractor/test/specHash.test.ts packages/extractor/test/diff.test.ts packages/extractor/test/layout.test.ts packages/plugin/test/fromSource.test.ts packages/plugin/test/serialize.test.ts packages/plugin/test/docLink.test.ts`

If `BUTTON_HASH` or `CHIP_HASH` changed (both fixtures use ASCII keys where collation and code units agree, so they are expected to stay), update the constant and add this sentence to its doc comment: `Re-cut on 2026-09-07 by the EXTRACTOR_VERSION 3 change: canonical() switched to code-unit ordering.` Any other pinned hash that moved is re-cut the same way, with the same sentence. Do not re-cut a pin without recording why.

Expected after edits: PASS.

- [ ] **Step 5: Check the extractor for any other localeCompare**

Run: `grep -rn "localeCompare" packages/extractor/src`
Expected: matches only inside comments in `v5/canonical.ts` and `v5/diagnostics.ts`. No call sites.

- [ ] **Step 6: Add the changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md`, add a `### Changed` heading if none exists and this entry:

```markdown
- `EXTRACTOR_VERSION` is `3`. Every existing component and Foundation document
  reads "Rebuild needed" once; Update rebuilds it and keeps editorial text.
  The canvas hash now orders object keys by code units instead of the machine
  locale, so collaborators on different OS locales compute the same hash.
```

- [ ] **Step 7: Run the full gate and commit**

Run: `npm run check`
Expected: exit 0.

```bash
git add packages/extractor/src/hash.ts packages/extractor/src/version.ts packages/extractor/test/specHash.test.ts CHANGELOG.md
git commit -m "feat(extractor): version 3 with code-unit canvas hash ordering

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Radius gap check covers every corner binding

**Files:**
- Create: `packages/extractor/src/bindingSets.ts`
- Modify: `packages/extractor/src/tokens.ts:634-636, 695-697`
- Modify: `packages/extractor/src/rawValues.ts:7-13`
- Create: `packages/extractor/test/fixtures/radius-partial.json`
- Test: `packages/extractor/test/tokens.test.ts`, `packages/extractor/test/rawValues.test.ts`, `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Produces: `RADIUS_BINDINGS: ReadonlySet<string>` and `PADDING_BINDINGS: ReadonlySet<string>` exported from `bindingSets.ts`, consumed by `tokens.ts` and `rawValues.ts`.

- [ ] **Step 1: Write the fixture**

Create `packages/extractor/test/fixtures/radius-partial.json`:

```json
{
  "id": "3:100",
  "name": "Tag",
  "type": "COMPONENT",
  "visible": true,
  "key": "syn-tag",
  "children": [
    {
      "id": "3:101",
      "name": "container",
      "type": "FRAME",
      "visible": true,
      "bindings": [
        { "property": "topRightRadius", "id": "VariableID:20", "name": "shape.corner.small", "kind": "variable", "remote": false, "collectionId": "VariableCollectionId:1" }
      ],
      "layout": { "mode": "HORIZONTAL", "paddingTop": 4, "paddingRight": 8, "paddingBottom": 4, "paddingLeft": 8, "cornerRadius": 4 },
      "children": [
        { "id": "3:102", "name": "label", "type": "TEXT", "visible": true,
          "bindings": [
            { "property": "fills", "id": "VariableID:21", "name": "color.on-surface", "kind": "variable", "remote": false, "collectionId": "VariableCollectionId:1" },
            { "property": "textStyleId", "id": "S:1", "name": "label/small", "kind": "text-style", "remote": false }
          ] }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/extractor/test/tokens.test.ts`:

```ts
import radiusPartial from './fixtures/radius-partial.json';

describe('extractGaps radius with one corner bound', () => {
  it('does not report a hardcoded radius when only topRightRadius is bound', () => {
    const gaps = extractGaps(radiusPartial as SerializedNode);
    expect(gaps).not.toContainEqual(expect.objectContaining({ property: 'border-radius' }));
  });

  it('still emits the bound corner as a token rule', () => {
    const rules = extractTokens(radiusPartial as SerializedNode, variantAxisModel(radiusPartial as SerializedNode));
    expect(rules.some((r) => r.name === 'shape.corner.small')).toBe(true);
  });
});
```

Append to `packages/extractor/test/rawValues.test.ts`:

```ts
import radiusPartial from './fixtures/radius-partial.json';

it('does not report a raw radius when any corner is bound', () => {
  const raw = extractRawValues(radiusPartial as SerializedNode);
  expect(raw).not.toContainEqual(expect.objectContaining({ property: 'border-radius' }));
});
```

Check the existing imports at the top of both test files and add `extractTokens`, `variantAxisModel`, `extractGaps`, `extractRawValues`, and `SerializedNode` if they are not already imported.

- [ ] **Step 3: Run the tests to verify the gap test fails**

Run: `npx vitest run packages/extractor/test/tokens.test.ts packages/extractor/test/rawValues.test.ts`
Expected: the `extractGaps` test FAILS with a `border-radius` gap present. The `rawValues` test passes already; it stays as a regression guard.

- [ ] **Step 4: Share the binding sets and fix the gap check**

Create `packages/extractor/src/bindingSets.ts`:

```ts
/**
 * Bound-variable property names that cover one measured property. Shared by
 * the gap scan (tokens.ts) and the raw-value scan (rawValues.ts) so the two
 * can never disagree about what "bound" means for a radius or a padding.
 *
 * A radius is bound when ANY corner is bound: a node with only
 * `topRightRadius` bound is partially on-system, not hardcoded, and reporting
 * it as a gap tells a developer to fix something that is already a token.
 */
export const RADIUS_BINDINGS: ReadonlySet<string> = new Set([
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
]);

export const PADDING_BINDINGS: ReadonlySet<string> = new Set([
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'verticalPadding', 'horizontalPadding',
]);
```

In `packages/extractor/src/rawValues.ts` delete the two local `const PADDING_BINDINGS` and `const RADIUS_BINDINGS` declarations (lines 7 to 13) and add:

```ts
import { PADDING_BINDINGS, RADIUS_BINDINGS } from './bindingSets';
```

In `packages/extractor/src/tokens.ts` add the import at the top:

```ts
import { RADIUS_BINDINGS, PADDING_BINDINGS } from './bindingSets';
```

Delete the local `const PADDING_PROPS = [...]` at line 636 and replace its two uses in `extractGaps` (`!PADDING_PROPS.some((p) => bound.has(p))`) with `![...PADDING_BINDINGS].some((p) => bound.has(p))`. Replace the radius condition:

```ts
    if (l.cornerRadius !== undefined && ![...RADIUS_BINDINGS].some((p) => bound.has(p))) {
      pushGap(part, path, simpleProperty('cornerRadius'), 'hardcoded-value', l.cornerRadius);
    }
```

If `PADDING_PROPS` is referenced anywhere else in `tokens.ts` (run `grep -n PADDING_PROPS packages/extractor/src/tokens.ts`), replace those uses the same way.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/tokens.test.ts packages/extractor/test/rawValues.test.ts`
Expected: PASS.

- [ ] **Step 6: Pin the fixture's hash projection**

Append to `packages/extractor/test/specHash.test.ts`:

```ts
describe('extractor version 3 goldens', () => {
  it('radius-partial: hash is stable and carries no radius gap', () => {
    const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/radius-partial.json', 'utf8'));
    const spec = extract(node, { figmaFile: 'FILE1' });
    expect(spec.gaps.some((g) => g.property === 'border-radius')).toBe(false);
    expect(specContentHash(spec)).toMatch(/^[0-9a-f]{64}$/);
    expect(specContentHash(spec)).toBe(RADIUS_PARTIAL_HASH);
  });
});
```

Run the test once with `const RADIUS_PARTIAL_HASH = '';` declared above the describe, copy the actual value from the failure output into the constant, and add this comment above it:

```ts
/** Cut on 2026-09-07 at EXTRACTOR_VERSION 3. Pins the radius fix: a partially
 *  bound radius is neither a gap nor a raw row. Only a task that says it
 *  re-cuts the baseline may change it. */
```

Run: `npx vitest run packages/extractor/test/specHash.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor/src/bindingSets.ts packages/extractor/src/tokens.ts packages/extractor/src/rawValues.ts packages/extractor/test/fixtures/radius-partial.json packages/extractor/test/tokens.test.ts packages/extractor/test/rawValues.test.ts packages/extractor/test/specHash.test.ts
git commit -m "fix(extractor): a radius bound on any corner is not a hardcoded gap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Anatomy descends through stacked wrappers

**Files:**
- Modify: `packages/extractor/src/anatomy.ts:21, 86-100`
- Create: `packages/extractor/test/fixtures/double-wrapper.json`
- Test: `packages/extractor/test/anatomy.test.ts`, `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Produces: `extractAnatomy` skips up to `MAX_WRAPPERS = 3` consecutive sole FRAME/GROUP wrappers. Part paths still match `walkParts` paths from `tokens.ts`.

- [ ] **Step 1: Write the fixture**

Create `packages/extractor/test/fixtures/double-wrapper.json`. The default variant's only visible child is `Outer`, whose only visible child is `Inner`, whose children are the real parts. A fourth nesting level (`Third`) under a second variant proves the bound.

```json
{
  "id": "4:100",
  "name": "Badge",
  "type": "COMPONENT_SET",
  "visible": true,
  "key": "syn-badge",
  "propertyDefinitions": {
    "Depth": { "type": "VARIANT", "defaultValue": "Two", "variantOptions": ["Two", "Four"] }
  },
  "children": [
    {
      "id": "4:101", "name": "Depth=Two", "type": "COMPONENT", "visible": true,
      "children": [
        { "id": "4:102", "name": "Outer", "type": "FRAME", "visible": true,
          "children": [
            { "id": "4:103", "name": "Inner", "type": "FRAME", "visible": true,
              "children": [
                { "id": "4:104", "name": "label", "type": "TEXT", "visible": true,
                  "bindings": [
                    { "property": "fills", "id": "VariableID:30", "name": "color.on-surface", "kind": "variable", "remote": false, "collectionId": "VariableCollectionId:1" }
                  ] },
                { "id": "4:105", "name": "icon", "type": "INSTANCE", "visible": true,
                  "mainComponent": { "name": "Icon", "key": "syn-icon" } }
              ] }
          ] }
      ]
    },
    {
      "id": "4:201", "name": "Depth=Four", "type": "COMPONENT", "visible": true,
      "children": [
        { "id": "4:202", "name": "W1", "type": "FRAME", "visible": true,
          "children": [
            { "id": "4:203", "name": "W2", "type": "FRAME", "visible": true,
              "children": [
                { "id": "4:204", "name": "W3", "type": "FRAME", "visible": true,
                  "children": [
                    { "id": "4:205", "name": "W4", "type": "FRAME", "visible": true,
                      "children": [
                        { "id": "4:206", "name": "label", "type": "TEXT", "visible": true }
                      ] }
                  ] }
              ] }
          ] }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/extractor/test/anatomy.test.ts`:

```ts
import doubleWrapper from './fixtures/double-wrapper.json';
import { extractTokens, variantAxisModel } from '../src/tokens';

describe('extractAnatomy — stacked wrapper descent', () => {
  const result = extractAnatomy(doubleWrapper as SerializedNode);

  it('lists the real parts, not the second wrapper', () => {
    expect(result.parts.map((p) => p.name)).toEqual(['label', 'icon']);
    expect(result.parts.every((p) => p.depth === 0)).toBe(true);
  });

  it('keeps part paths identical to the token walk paths', () => {
    const rules = extractTokens(doubleWrapper as SerializedNode, variantAxisModel(doubleWrapper as SerializedNode));
    const labelRule = rules.find((r) => r.name === 'color.on-surface');
    const labelPart = result.parts.find((p) => p.name === 'label');
    expect(labelRule?.path).toBe(labelPart?.path);
    expect(labelPart?.path).toBe('Container/Outer/Inner/label');
  });

  it('stops after three wrappers and surfaces the fourth as the part', () => {
    // Force the Depth=Four variant to be the default by rewriting the declared default.
    const four = JSON.parse(JSON.stringify(doubleWrapper)) as SerializedNode;
    four.propertyDefinitions!.Depth.defaultValue = 'Four';
    const deep = extractAnatomy(four);
    expect(deep.parts.map((p) => p.name)).toEqual(['W4']);
    expect(deep.parts[0].path).toBe('Container/W1/W2/W3/W4');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/anatomy.test.ts`
Expected: FAIL. The first test lists `['Inner']`; the third lists `['W2']`.

- [ ] **Step 4: Bound the descent loop**

In `packages/extractor/src/anatomy.ts` add below `const MAX_DEPTH = 3;`:

```ts
/** How many consecutive sole FRAME/GROUP wrappers anatomy descends through
 *  before listing parts. One wrapper is the common auto-layout container; a
 *  second appears when a designer wraps that in a sizing frame. Three is the
 *  bound so a pathological nesting still surfaces something rather than
 *  recursing to a leaf. Each skipped wrapper keeps its level in the shared path
 *  namespace, so token and gap paths still line up. */
const MAX_WRAPPERS = 3;
```

Replace the `while` loop (the block starting `let siblingSet = def.children ?? [];` through the closing `}` of the loop) with:

```ts
  let siblingSet = def.children ?? [];
  let children = siblingSet.filter((c) => c.visible);
  let parentPath = rootPath;
  let skipped = 0;
  while (
    skipped < MAX_WRAPPERS &&
    children.length === 1 &&
    (children[0].type === 'FRAME' || children[0].type === 'GROUP') &&
    (children[0].children ?? []).filter((c) => c.visible).length > 0
  ) {
    const names = siblingPartNames(siblingSet);
    parentPath = joinPath(parentPath, names.get(children[0])!);
    siblingSet = children[0].children ?? [];
    children = siblingSet.filter((c) => c.visible);
    skipped += 1;
  }
```

Update the doc comment paragraph that begins `Single-wrapper descent:` to read:

```
 * Wrapper descent: when the default variant has exactly ONE visible child
 * whose type is FRAME or GROUP (the common "everything in one auto-layout
 * wrapper" pattern), anatomy descends into that child's children before
 * listing parts, and repeats up to MAX_WRAPPERS times for stacked wrappers,
 * so no wrapper is surfaced as the sole anatomy element.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/anatomy.test.ts packages/extractor/test/tokens.test.ts packages/extractor/test/extract.test.ts`
Expected: PASS, including the existing chip single-wrapper tests.

- [ ] **Step 6: Pin the fixture's hash projection**

Add to the `extractor version 3 goldens` describe in `packages/extractor/test/specHash.test.ts`:

```ts
  it('double-wrapper: hash is stable and anatomy lists the real parts', () => {
    const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/double-wrapper.json', 'utf8'));
    const spec = extract(node, { figmaFile: 'FILE1' });
    expect(spec.anatomy.filter((p) => p.depth === 0).map((p) => p.name)).toEqual(['label', 'icon']);
    expect(specContentHash(spec)).toBe(DOUBLE_WRAPPER_HASH);
  });
```

Cut `DOUBLE_WRAPPER_HASH` the same way as Task 2 step 6, with the comment `Cut on 2026-09-07 at EXTRACTOR_VERSION 3. Pins stacked-wrapper descent.`

Run: `npx vitest run packages/extractor/test/specHash.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor/src/anatomy.ts packages/extractor/test/fixtures/double-wrapper.json packages/extractor/test/anatomy.test.ts packages/extractor/test/specHash.test.ts
git commit -m "fix(extractor): anatomy descends through up to three stacked wrappers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Serializer reads property references and the instance-swap default name

**Files:**
- Modify: `packages/extractor/src/tree.ts:8-10, 46-50`
- Modify: `packages/plugin/src/serialize.ts:70-74, 96-121, 285-301, 329-350`
- Modify: `packages/plugin/src/resolverMemo.ts`
- Modify: `packages/plugin/src/main.ts:52-100`
- Test: `packages/plugin/test/serialize.test.ts`, `packages/plugin/test/resolverMemo.test.ts`

**Interfaces:**
- Produces on `SerializedNode`: `propertyRefs?: { visible?: string; characters?: string; mainComponent?: string }`. Produces on `PropertyDefinition`: `defaultLabel?: string`. Produces on `NodeResolver`: `componentName(id: string): Promise<string | null>`. Task 5 consumes `propertyRefs` and `defaultLabel`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/serialize.test.ts`:

```ts
describe('serializeNode component property references', () => {
  const refResolver = {
    ...resolver,
    componentName: async (id: string) => (id === 'C:9' ? 'Arrow right' : null),
  };

  it('carries componentPropertyReferences as propertyRefs, raw names kept', async () => {
    const node = {
      id: '5:1', name: 'icon', type: 'INSTANCE', visible: true,
      componentPropertyReferences: { visible: 'Show icon#1:5', mainComponent: 'Icon#1:7' },
    };
    const out = await serializeNode(node as never, refResolver);
    expect(out.propertyRefs).toEqual({ visible: 'Show icon#1:5', mainComponent: 'Icon#1:7' });
  });

  it('omits propertyRefs when Figma states none', async () => {
    const out = await serializeNode({ ...mockRect, componentPropertyReferences: null } as never, refResolver);
    expect(out.propertyRefs).toBeUndefined();
    const empty = await serializeNode({ ...mockRect, componentPropertyReferences: {} } as never, refResolver);
    expect(empty.propertyRefs).toBeUndefined();
  });

  it('resolves an instance-swap default id to a component name as defaultLabel', async () => {
    const set = {
      id: '5:10', name: 'Button', type: 'COMPONENT_SET', visible: true,
      componentPropertyDefinitions: {
        'Icon#1:7': { type: 'INSTANCE_SWAP', defaultValue: 'C:9' },
        'Label#1:6': { type: 'TEXT', defaultValue: 'Button' },
      },
    };
    const out = await serializeNode(set as never, refResolver);
    expect(out.propertyDefinitions?.['Icon#1:7']).toEqual({ type: 'INSTANCE_SWAP', defaultValue: 'C:9', defaultLabel: 'Arrow right' });
    expect(out.propertyDefinitions?.['Label#1:6']).toEqual({ type: 'TEXT', defaultValue: 'Button' });
  });

  it('omits defaultLabel when the swap default cannot be resolved', async () => {
    const set = {
      id: '5:11', name: 'Button', type: 'COMPONENT_SET', visible: true,
      componentPropertyDefinitions: { 'Icon#1:7': { type: 'INSTANCE_SWAP', defaultValue: 'C:404' } },
    };
    const out = await serializeNode(set as never, refResolver);
    expect(out.propertyDefinitions?.['Icon#1:7']).toEqual({ type: 'INSTANCE_SWAP', defaultValue: 'C:404' });
  });
});
```

Append to `packages/plugin/test/resolverMemo.test.ts` (match the file's existing import of `memoizedResolver` and its fake base resolver pattern):

```ts
it('memoizes componentName by id', async () => {
  let calls = 0;
  const base = {
    variable: async () => null,
    style: async () => null,
    mainComponent: async () => null,
    componentName: async (id: string) => { calls += 1; return `name-${id}`; },
  };
  const memo = memoizedResolver(base);
  expect(await memo.componentName('C:1')).toBe('name-C:1');
  expect(await memo.componentName('C:1')).toBe('name-C:1');
  expect(await memo.componentName('C:2')).toBe('name-C:2');
  expect(calls).toBe(2);
});
```

The existing `resolver` constant in `serialize.test.ts` (and every other test object typed as `NodeResolver`) needs a `componentName: async (_id: string) => null` member once the interface gains it. Run `grep -rn "mainComponent: async" packages/plugin/test` and add the member beside each match.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/serialize.test.ts packages/plugin/test/resolverMemo.test.ts`
Expected: FAIL. `propertyRefs` is undefined on the first test; `defaultLabel` is absent; `componentName` does not exist on the memoized resolver.

- [ ] **Step 3: Extend the extractor types**

In `packages/extractor/src/tree.ts` add to `SerializedNode` after `propertyDefinitions`:

```ts
  /** Which component properties drive this node, as Figma states them on
   *  `componentPropertyReferences`. Keys are the driven node property; values
   *  are RAW property names including the `#id` suffix. The extractor cleans
   *  them with `cleanPropName`. Omitted when Figma states none. */
  propertyRefs?: { visible?: string; characters?: string; mainComponent?: string };
```

Add to `PropertyDefinition`:

```ts
  /** INSTANCE_SWAP only: the default component's name, resolved from the id
   *  in `defaultValue`. Omitted when the lookup failed, so a reader never
   *  shows a raw id as a default. `defaultValue` itself is unchanged. */
  defaultLabel?: string;
```

- [ ] **Step 4: Extend the serializer**

In `packages/plugin/src/serialize.ts` extend `NodeResolver`:

```ts
export interface NodeResolver {
  variable(id: string): Promise<ResolvedVariable | null>;
  style(id: string): Promise<ResolvedStyle | null>;
  mainComponent(node: unknown): Promise<{ name: string; key: string } | null>;
  /** Name of the COMPONENT or COMPONENT_SET with this node id, or null. Used
   *  for instance-swap defaults, which Figma states as ids. */
  componentName(id: string): Promise<string | null>;
}
```

Add to `RawNode`:

```ts
  componentPropertyReferences?: { visible?: string; characters?: string; mainComponent?: string } | null;
```

Replace the property-definitions block (from `let propertyDefinitions` through its `catch`) with:

```ts
  let propertyDefinitions: Record<string, PropertyDefinition> | undefined;
  try {
    if (node.componentPropertyDefinitions) {
      const defs: Record<string, PropertyDefinition> = {};
      for (const [k, v] of Object.entries(node.componentPropertyDefinitions)) {
        const def: PropertyDefinition = {
          type: v.type as PropertyDefinition['type'],
          ...(v.defaultValue !== undefined ? { defaultValue: v.defaultValue } : {}),
          ...(v.variantOptions ? { variantOptions: v.variantOptions } : {}),
        };
        // An instance-swap default is a component id. Resolve it to a name so
        // the Properties table never prints an id; when the lookup fails the
        // label is simply absent and the table shows a dash.
        if (v.type === 'INSTANCE_SWAP' && typeof v.defaultValue === 'string') {
          const label = await resolver.componentName(v.defaultValue);
          if (label) def.defaultLabel = label;
        }
        defs[k] = def;
      }
      if (Object.keys(defs).length > 0) propertyDefinitions = defs;
    }
  } catch {
    // Figma throws on variant children — silently skip.
  }

  // --- componentPropertyReferences ---
  // Which properties drive this node's visibility, text, or swapped component.
  // Read raw; the extractor cleans the `#id` suffix with the same function it
  // uses for definitions, so the two sides agree by construction.
  let propertyRefs: SerializedNode['propertyRefs'];
  try {
    const refs = node.componentPropertyReferences;
    if (refs && typeof refs === 'object') {
      const picked: NonNullable<SerializedNode['propertyRefs']> = {};
      if (typeof refs.visible === 'string') picked.visible = refs.visible;
      if (typeof refs.characters === 'string') picked.characters = refs.characters;
      if (typeof refs.mainComponent === 'string') picked.mainComponent = refs.mainComponent;
      if (Object.keys(picked).length > 0) propertyRefs = picked;
    }
  } catch {
    // Reading the property on a node Figma no longer backs can throw; an
    // absent reference is the honest result.
  }
```

In the `result` object add, after `propertyDefinitions`:

```ts
    ...(propertyRefs ? { propertyRefs } : {}),
```

- [ ] **Step 5: Memoize and implement the resolver**

In `packages/plugin/src/resolverMemo.ts` add a third map and method:

```ts
  const componentNames = new Map<string, ReturnType<NodeResolver['componentName']>>();
```

```ts
    componentName(id) {
      let pending = componentNames.get(id);
      if (!pending) {
        pending = base.componentName(id);
        componentNames.set(id, pending);
      }
      return pending;
    },
```

Update the file's doc comment sentence `mainComponent is keyed by a node object, not an id, so it passes through.` to `mainComponent is keyed by a node object, not an id, so it passes through; componentName is keyed by id and memoized like variables and styles.`

In `packages/plugin/src/main.ts`, add to the `resolver` object after `mainComponent`:

```ts
  async componentName(id) {
    try {
      const n = await figma.getNodeByIdAsync(id);
      if (!n) return null;
      if (n.type !== 'COMPONENT' && n.type !== 'COMPONENT_SET') return null;
      // A variant's own name is "Axis=Value"; the set carries the real name.
      if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') return n.parent.name;
      return n.name;
    } catch {
      return null;
    }
  },
```

Search the plugin for other objects typed `NodeResolver` (`grep -rn "NodeResolver = {" packages/plugin/src`) and add a `componentName` member to each; a foundation-only resolver may return `null` unconditionally with a comment saying it never sees instance-swap defaults.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run packages/plugin/test/serialize.test.ts packages/plugin/test/resolverMemo.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor/src/tree.ts packages/plugin/src/serialize.ts packages/plugin/src/resolverMemo.ts packages/plugin/src/main.ts packages/plugin/test/serialize.test.ts packages/plugin/test/resolverMemo.test.ts
git commit -m "feat(plugin): serialize component property references and swap default names

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Extractor fills `affects` and `defaultLabel`, and inverts them per part

**Files:**
- Modify: `packages/extractor/src/props.ts`
- Create: `packages/extractor/test/fixtures/properties.json`
- Test: `packages/extractor/test/props.test.ts`, `packages/extractor/test/specHash.test.ts`, `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `SerializedNode.propertyRefs`, `PropertyDefinition.defaultLabel` (Task 4), `defaultVariant` from `anatomy.ts`, `walkParts` and `cleanPropName` from `naming.ts`, `compareCodeUnits` from `v5/diagnostics.ts`.
- Produces: `ComponentProp.affects?: string[]`, `ComponentProp.defaultLabel?: string`, and `propertiesByPart(props: ComponentProp[]): Map<string, string[]>` (part name to sorted property names). Tasks 7 and 8 consume all three.

- [ ] **Step 1: Write the fixture**

Create `packages/extractor/test/fixtures/properties.json`. It exercises: a boolean driving two parts, a text driving one, an instance swap with a resolved label, a swap with no label, a referencing node below the anatomy depth cap, and a variant axis.

```json
{
  "id": "6:100",
  "name": "Chip",
  "type": "COMPONENT_SET",
  "visible": true,
  "key": "syn-chip-props",
  "propertyDefinitions": {
    "Size": { "type": "VARIANT", "defaultValue": "Medium", "variantOptions": ["Small", "Medium"] },
    "Show icon#2:1": { "type": "BOOLEAN", "defaultValue": true },
    "Label#2:2": { "type": "TEXT", "defaultValue": "Chip" },
    "Leading icon#2:3": { "type": "INSTANCE_SWAP", "defaultValue": "C:9", "defaultLabel": "Arrow right" },
    "Trailing icon#2:4": { "type": "INSTANCE_SWAP", "defaultValue": "C:404" },
    "Unused#2:5": { "type": "BOOLEAN", "defaultValue": false }
  },
  "children": [
    {
      "id": "6:101", "name": "Size=Medium", "type": "COMPONENT", "visible": true,
      "children": [
        { "id": "6:102", "name": "leading icon", "type": "INSTANCE", "visible": true,
          "mainComponent": { "name": "Icon", "key": "syn-icon" },
          "propertyRefs": { "visible": "Show icon#2:1", "mainComponent": "Leading icon#2:3" } },
        { "id": "6:103", "name": "label", "type": "TEXT", "visible": true,
          "propertyRefs": { "characters": "Label#2:2" } },
        { "id": "6:104", "name": "trailing", "type": "FRAME", "visible": true,
          "children": [
            { "id": "6:105", "name": "slot", "type": "FRAME", "visible": true,
              "children": [
                { "id": "6:106", "name": "deep", "type": "FRAME", "visible": true,
                  "children": [
                    { "id": "6:107", "name": "trailing icon", "type": "INSTANCE", "visible": true,
                      "mainComponent": { "name": "Icon", "key": "syn-icon" },
                      "propertyRefs": { "visible": "Show icon#2:1", "mainComponent": "Trailing icon#2:4" } }
                  ] }
              ] }
          ] }
      ]
    },
    {
      "id": "6:201", "name": "Size=Small", "type": "COMPONENT", "visible": true,
      "children": [
        { "id": "6:202", "name": "label", "type": "TEXT", "visible": true,
          "propertyRefs": { "characters": "Label#2:2" } }
      ]
    }
  ]
}
```

Note `trailing icon` sits at depth 3 (`trailing` 0, `slot` 1, `deep` 2, `trailing icon` 3), below the anatomy cap, so it is reported by its own cleaned layer name.

- [ ] **Step 2: Write the failing tests**

Append to `packages/extractor/test/props.test.ts`:

```ts
import properties from './fixtures/properties.json';
import { propertiesByPart } from '../src/props';

describe('extractProps affects and defaultLabel', () => {
  const props = extractProps(properties as SerializedNode);
  const byName = new Map(props.map((p) => [p.name, p]));

  it('lists the cleaned part names a boolean drives, sorted by code units, including below-cap nodes', () => {
    expect(byName.get('Show icon')?.affects).toEqual(['leading icon', 'trailing icon']);
  });

  it('lists the text part a text property fills', () => {
    expect(byName.get('Label')?.affects).toEqual(['label']);
  });

  it('lists the swapped part and carries the resolved default label', () => {
    expect(byName.get('Leading icon')?.affects).toEqual(['leading icon']);
    expect(byName.get('Leading icon')?.defaultLabel).toBe('Arrow right');
  });

  it('omits defaultLabel when the serializer could not resolve one', () => {
    expect(byName.get('Trailing icon')?.affects).toEqual(['trailing icon']);
    expect(byName.get('Trailing icon')?.defaultLabel).toBeUndefined();
  });

  it('omits affects when no node references the property, and on variant axes', () => {
    expect(byName.get('Unused')?.affects).toBeUndefined();
    expect(byName.get('Size')?.affects).toBeUndefined();
  });

  it('reads references from the default variant only', () => {
    // Size=Small also references Label, on a different node id; it must not
    // add a second entry or change the order.
    expect(byName.get('Label')?.affects).toEqual(['label']);
  });

  it('collapses duplicate part names', () => {
    const dup = JSON.parse(JSON.stringify(properties)) as SerializedNode;
    dup.children![0].children!.push({
      id: '6:999', name: 'label', type: 'TEXT', visible: true,
      propertyRefs: { characters: 'Label#2:2' },
    } as SerializedNode);
    // Two siblings named label become "label" and "label (2)": two parts, two names.
    expect(new Map(extractProps(dup).map((p) => [p.name, p])).get('Label')?.affects).toEqual(['label', 'label (2)']);
  });
});

describe('propertiesByPart', () => {
  it('inverts affects into part -> sorted property names', () => {
    const map = propertiesByPart(extractProps(properties as SerializedNode));
    expect(map.get('leading icon')).toEqual(['Leading icon', 'Show icon']);
    expect(map.get('label')).toEqual(['Label']);
    expect(map.get('trailing icon')).toEqual(['Show icon', 'Trailing icon']);
    expect(map.has('trailing')).toBe(false);
  });
});
```

Add to `packages/extractor/test/brief.test.ts` (find the describe that covers `api`; if none, add a new one at the bottom):

```ts
import propertiesFixture from './fixtures/properties.json';
import { componentBrief } from '../src/brief';
import { extract } from '../src/extract';

it('api never carries affects or defaultLabel', () => {
  const spec = extract(propertiesFixture as SerializedNode, { figmaFile: 'F' });
  const text = JSON.stringify(componentBrief(spec, { generatedAt: '2026-09-07T00:00:00Z', prose: null }));
  expect(text).not.toContain('affects');
  expect(text).not.toContain('defaultLabel');
});
```

Check the `componentBrief` options type in `brief.ts` (`ComponentBriefOptions`) and match its required fields exactly in the test call.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/props.test.ts packages/extractor/test/brief.test.ts`
Expected: FAIL. `affects` is undefined everywhere; `propertiesByPart` is not exported. The brief test passes already.

- [ ] **Step 4: Implement**

Replace `packages/extractor/src/props.ts` from the imports through `extractVariants` with:

```ts
import type { SerializedNode } from './tree';
import { detectStateMatrix } from './statesMatrix';
import { cleanPropName, cleanPartName, walkParts } from './naming';
import { defaultVariant } from './anatomy';
import { compareCodeUnits } from './v5/diagnostics';

export type PropKind = 'variant' | 'boolean' | 'text' | 'instanceSwap';

export interface ComponentProp {
  name: string;
  kind: PropKind;
  options?: string[];
  default?: string | boolean;
  /** INSTANCE_SWAP only: the default component's name when the serializer
   *  could resolve it. Renderers show this, never the raw id in `default`. */
  defaultLabel?: string;
  /** Cleaned part names this property drives (visibility, text, or swapped
   *  component), read from the default variant's property references, sorted
   *  by code units. A referencing node below the anatomy depth cap still
   *  appears under its own cleaned layer name. Absent when no node references
   *  the property, and never present on a variant axis. Never inferred. */
  affects?: string[];
}

export interface VariantAxis {
  prop: string;
  values: string[];
}

const KIND_MAP: Record<string, PropKind> = {
  VARIANT: 'variant',
  BOOLEAN: 'boolean',
  TEXT: 'text',
  INSTANCE_SWAP: 'instanceSwap',
};

/** Cleaned property name -> set of cleaned part names that reference it, from
 *  the default variant. Part names are the sibling-disambiguated names
 *  `walkParts` assigns, so they match anatomy entries exactly. */
function referencedParts(root: SerializedNode): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const def = defaultVariant(root);
  const isInSet = root.type === 'COMPONENT_SET';
  walkParts(def, isInSet ? 'Container' : cleanPartName(def.name), (n, part) => {
    const refs = n.propertyRefs;
    if (!refs) return;
    for (const raw of [refs.visible, refs.characters, refs.mainComponent]) {
      if (typeof raw !== 'string') continue;
      const prop = cleanPropName(raw);
      let parts = out.get(prop);
      if (!parts) { parts = new Set(); out.set(prop, parts); }
      parts.add(part);
    }
  });
  return out;
}

export function extractProps(root: SerializedNode): ComponentProp[] {
  const refs = referencedParts(root);
  return Object.entries(root.propertyDefinitions ?? {}).map(([raw, def]) => {
    const name = cleanPropName(raw);
    const kind = KIND_MAP[def.type];
    const affected = kind === 'variant' ? undefined : refs.get(name);
    return {
      name,
      kind,
      ...(def.variantOptions !== undefined ? { options: def.variantOptions } : {}),
      default: def.defaultValue,
      ...(def.defaultLabel !== undefined ? { defaultLabel: def.defaultLabel } : {}),
      ...(affected && affected.size > 0 ? { affects: [...affected].sort(compareCodeUnits) } : {}),
    };
  });
}

/** Inverse of `affects`: part name -> property names that drive it, sorted by
 *  code units. The Anatomy legend's "Controlled by" line reads this so it can
 *  never disagree with the Properties table. */
export function propertiesByPart(props: ComponentProp[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of props) {
    for (const part of p.affects ?? []) {
      const list = out.get(part) ?? [];
      list.push(p.name);
      out.set(part, list);
    }
  }
  for (const [part, list] of out) out.set(part, [...list].sort(compareCodeUnits));
  return out;
}

export function extractVariants(root: SerializedNode): VariantAxis[] {
  return extractProps(root)
    .filter((p) => p.kind === 'variant')
    .map((p) => ({ prop: p.name, values: p.options ?? [] }));
}
```

Keep `extractStates` unchanged below.

Check `walkParts`'s `skipInvisible` default: it is `false`, which is what we want here (a hidden part driven by a boolean whose default is `false` is still driven by it).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/props.test.ts packages/extractor/test/brief.test.ts packages/extractor/test/extract.test.ts packages/extractor/test/v5`
Expected: PASS. The v5 component golden must be unchanged; if `componentGolden.test.ts` fails, `apiOf` leaked a field and Step 4 is wrong, not the golden.

- [ ] **Step 6: Pin the hash behavior**

Add to the `extractor version 3 goldens` describe in `packages/extractor/test/specHash.test.ts`:

```ts
  it('properties: affects enters the canvas hash', () => {
    const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/properties.json', 'utf8'));
    const spec = extract(node, { figmaFile: 'FILE1' });
    expect(specHashProjection(spec).props.find((p) => p.name === 'Show icon')?.affects).toEqual(['leading icon', 'trailing icon']);
    const without = { ...spec, props: spec.props.map(({ affects: _a, ...rest }) => rest) };
    expect(specContentHash(without as typeof spec)).not.toBe(specContentHash(spec));
    expect(specContentHash(spec)).toBe(PROPERTIES_HASH);
  });
```

Cut `PROPERTIES_HASH` as in Task 2 step 6 with the comment `Cut on 2026-09-07 at EXTRACTOR_VERSION 3. Pins affects and defaultLabel inside the canvas hash.`

Run: `npx vitest run packages/extractor/test/specHash.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor/src/props.ts packages/extractor/test/fixtures/properties.json packages/extractor/test/props.test.ts packages/extractor/test/brief.test.ts packages/extractor/test/specHash.test.ts
git commit -m "feat(extractor): component properties carry the parts they affect and swap default labels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The Properties section in the doc model

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts:14-27, 378-398`
- Test: `packages/plugin/test/docModel.test.ts`, `packages/plugin/test/docLink.test.ts`

**Interfaces:**
- Consumes: `ComponentProp.affects`, `ComponentProp.defaultLabel` (Task 5).
- Produces: the `configuration` section block is `kind: 'table'` with columns `['Name', 'Kind', 'Options', 'Default', 'Affects']`, or `kind: 'bullets'` with one item `No properties`. `ALL_SECTIONS` label for `configuration` is `Properties`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/docModel.test.ts`:

```ts
describe('Properties section', () => {
  const build = (partial: Partial<IntermediateSpec>) =>
    buildDocModel({ ...spec, ...partial } as unknown as IntermediateSpec, null, new Set<SectionId>(['configuration'])).sections[0];

  it('is labeled Properties and keeps the configuration id', () => {
    expect(ALL_SECTIONS.find((s) => s.id === 'configuration')?.label).toBe('Properties');
    expect(KNOWN_SECTION_IDS.has('configuration')).toBe(true);
  });

  it('lists variant axes first, then the other properties, with an Affects column', () => {
    const block = build({
      variants: [{ prop: 'Size', values: ['Small', 'Medium'] }],
      props: [
        { name: 'Label', kind: 'text', default: 'Chip', affects: ['label'] },
        { name: 'Size', kind: 'variant', options: ['Small', 'Medium'], default: 'Medium' },
        { name: 'Show icon', kind: 'boolean', default: true, affects: ['leading icon', 'trailing icon'] },
        { name: 'Leading icon', kind: 'instanceSwap', default: 'C:9', defaultLabel: 'Arrow right', affects: ['leading icon'] },
        { name: 'Trailing icon', kind: 'instanceSwap', default: 'C:404' },
      ],
    });
    expect(block.kind).toBe('table');
    if (block.kind !== 'table') return;
    expect(block.columns).toEqual(['Name', 'Kind', 'Options', 'Default', 'Affects']);
    expect(block.rows).toEqual([
      ['Size', 'variant', 'Small · Medium', 'Medium', '—'],
      ['Label', 'text', '—', 'Chip', 'label'],
      ['Show icon', 'boolean', 'true / false', 'true', 'leading icon · trailing icon'],
      ['Leading icon', 'instanceSwap', '—', 'Arrow right', 'leading icon'],
      ['Trailing icon', 'instanceSwap', '—', '—', '—'],
    ]);
  });

  it('shows a dash when the axis declares no default', () => {
    const block = build({
      variants: [{ prop: 'Style', values: ['Filled', 'Text'] }],
      props: [{ name: 'Style', kind: 'variant', options: ['Filled', 'Text'] }],
    });
    if (block.kind !== 'table') throw new Error('expected table');
    expect(block.rows[0]).toEqual(['Style', 'variant', 'Filled · Text', '—', '—']);
  });

  it('renders a one-line notice when there are no axes and no properties', () => {
    const block = build({ variants: [], props: [] });
    expect(block.kind).toBe('bullets');
    if (block.kind === 'bullets') expect(block.items.map((i) => i.text)).toEqual(['No properties']);
  });
});
```

Add to `packages/plugin/test/docLink.test.ts` inside `describe('docLink data')`:

```ts
  it('keeps the configuration section id so stored configs still render Properties', () => {
    const stored: DocLinkData = { ...DATA, config: { ...DATA.config, sections: ['configuration', 'anatomy'] } };
    const parsed = parseDocLink(serializeDocLink(stored)) as ComponentDocLink;
    expect(parsed.config.sections).toEqual(['configuration', 'anatomy']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/docModel.test.ts packages/plugin/test/docLink.test.ts`
Expected: the Properties tests FAIL (label is `Configuration`, four columns, empty table). The docLink test passes already.

- [ ] **Step 3: Relabel and rebuild the section**

In `packages/plugin/src/ui/docModel.ts` change the `ALL_SECTIONS` entry:

```ts
  { id: 'configuration', label: 'Properties',    ai: false, group: 'specs' },
```

Add above the entry a comment:

```ts
  // The id stays `configuration` for every stored DocConfig that names it;
  // parseDocLink filters ids through KNOWN_SECTION_IDS and would silently drop
  // a renamed one on Update. Only the label changed when the section grew an
  // Affects column and started listing variant axes (2026-09-07).
```

Replace `case 'configuration'` with:

```ts
    case 'configuration': {
      // Every component property, variant axes first (declaration order), then
      // boolean, text and instance-swap properties (declaration order). Affects
      // names the anatomy parts a property drives, as Figma states them; a dash
      // means Figma states no reference, never a guess.
      const DASH = '—';
      const columns = ['Name', 'Kind', 'Options', 'Default', 'Affects'];
      const defaultOf = (p: { default?: string | boolean }): string =>
        p.default === undefined || p.default === null || p.default === '' ? DASH : String(p.default);
      const affectsOf = (p: { affects?: string[] }): string =>
        p.affects && p.affects.length ? p.affects.join(' · ') : DASH;

      const axisRows = spec.variants.map((axis) => {
        const declared = spec.props.find((p) => p.kind === 'variant' && p.name === axis.prop);
        return [axis.prop, 'variant', axis.values.join(' · '), declared ? defaultOf(declared) : DASH, DASH];
      });
      const otherRows = spec.props
        .filter((p) => p.kind !== 'variant')
        .map((p) => {
          const options =
            p.kind === 'boolean' ? 'true / false'
            : p.kind === 'text' ? DASH
            : p.kind === 'instanceSwap' ? DASH
            : p.options?.length ? p.options.join(' · ') : DASH;
          // An instance-swap default is a component id; only a resolved name
          // is shown. `defaultLabel` is absent when the lookup failed.
          const def = p.kind === 'instanceSwap' ? (p.defaultLabel ?? DASH) : defaultOf(p);
          return [p.name, p.kind, options, def, affectsOf(p)];
        });
      const rows = [...axisRows, ...otherRows];
      if (!rows.length) {
        return { id, heading: label, kind: 'bullets', items: [makeBullet('No properties')] };
      }
      return { id, heading: label, kind: 'table', columns, rows };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docModel.test.ts packages/plugin/test/docLink.test.ts packages/plugin/test/componentScreen.test.ts packages/plugin/test/docFrameProse.test.ts`
Expected: PASS. If a componentScreen test asserts the label `Configuration`, update that assertion to `Properties`; it is UI copy, not a contract.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/test/docModel.test.ts packages/plugin/test/docLink.test.ts packages/plugin/test/componentScreen.test.ts
git commit -m "feat(plugin): properties section lists every property with the parts it affects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Trim the Anatomy legend and add Controlled by

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts:96-112, 330-350`
- Modify: `packages/plugin/src/docFrame.ts:632-655, 918-930`
- Test: `packages/plugin/test/docModel.test.ts`, `packages/plugin/test/docFrameProse.test.ts`

**Interfaces:**
- Consumes: `propertiesByPart` from `@spec-layer/extractor` (Task 5).
- Produces: `AnatomyPartBlock` loses `tokens: string[]` and gains `controlledBy?: string[]`. The legend row text is `name: description` or `name  ·  component`, followed on a second line by `Controlled by: A · B` when present.

- [ ] **Step 1: Update and add the model tests**

In `packages/plugin/test/docModel.test.ts`, in the test `shapes anatomy as a numbered diagram block carrying part + component ids`, change the expected parts to:

```ts
      expect(block.parts).toEqual([
        { n: 1, name: 'Container', nested: false, id: 'p:1', depth: 0, component: undefined, type: 'FRAME' },
        { n: 2, name: 'Icon', nested: true, id: 'p:2', depth: 1, component: 'Icon', type: 'INSTANCE' },
      ]);
```

Rename the test `anatomy block carries depth and tokens and always uses the diagram view` to `anatomy block carries depth and always uses the diagram view` and delete the line `expect(block.parts[0].tokens).toContain('color/label');`.

Append:

```ts
describe('anatomy Controlled by', () => {
  it('lists the properties that drive each part, and omits the field otherwise', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [
        { id: 'p:1', name: 'leading icon', type: 'INSTANCE', nested: true, depth: 0, component: 'Icon' },
        { id: 'p:2', name: 'label', type: 'TEXT', nested: false, depth: 0 },
        { id: 'p:3', name: 'container', type: 'FRAME', nested: false, depth: 0 },
      ],
      props: [
        { name: 'Show icon', kind: 'boolean', default: true, affects: ['leading icon'] },
        { name: 'Leading icon', kind: 'instanceSwap', default: 'C:9', affects: ['leading icon'] },
        { name: 'Label', kind: 'text', default: 'Chip', affects: ['label'] },
      ],
    } as unknown as IntermediateSpec;
    const block = buildDocModel(specA, null, new Set<SectionId>(['anatomy'])).sections[0];
    if (block.kind !== 'anatomy') throw new Error('expected anatomy');
    expect(block.parts[0].controlledBy).toEqual(['Leading icon', 'Show icon']);
    expect(block.parts[1].controlledBy).toEqual(['Label']);
    expect(block.parts[2].controlledBy).toBeUndefined();
    expect('tokens' in block.parts[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Add the renderer test**

Append to `packages/plugin/test/docFrameProse.test.ts` (it already installs the fake Figma and builds frames):

```ts
describe('anatomy legend rendering', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  const collectText = (node: unknown, out: string[] = []): string[] => {
    const n = node as { type?: string; characters?: string; children?: unknown[] };
    if (n.type === 'TEXT' && typeof n.characters === 'string') out.push(n.characters);
    for (const c of n.children ?? []) collectText(c, out);
    return out;
  };

  it('writes a Controlled by line and no token list', async () => {
    const specA = {
      ...spec,
      props: [{ name: 'Show icon', kind: 'boolean', default: true, affects: ['Icon'] }],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    const section = await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null);
    const texts = collectText(section);
    expect(texts.some((t) => t.startsWith('Controlled by: Show icon'))).toBe(true);
    expect(texts.some((t) => t.includes('color/text'))).toBe(false);
  });
});
```

Check how the other tests in that file call `resolveTheme` and `buildDocFrames` and match their exact signatures.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/docModel.test.ts packages/plugin/test/docFrameProse.test.ts`
Expected: FAIL. `tokens` is still present, `controlledBy` is undefined, and the legend has no Controlled by line.

- [ ] **Step 4: Change the model**

In `packages/plugin/src/ui/docModel.ts`:

Add `propertiesByPart` to the import from `@spec-layer/extractor`.

Replace the `AnatomyPartBlock` interface and its comment:

```ts
/** One anatomy part placed on the diagram: its 1-based number, label, whether
 *  it is a nested component, and the Figma node id used to resolve its position
 *  (and screenshot) live in the frame builder. `depth` is the nesting level
 *  (0 = direct part); `component` names the main component when nested;
 *  `controlledBy` lists the component properties that drive this part, from
 *  the same source as the Properties table; `type` is the raw Figma node type
 *  (e.g. "FRAME"), shown lowercased in the table view. The per-part token list
 *  was dropped on 2026-09-07: Tokens used carries it per variant. */
export interface AnatomyPartBlock {
  n: number;
  name: string;
  nested: boolean;
  id: string;
  depth: number;
  component?: string;
  controlledBy?: string[];
  type: string;
  description?: string; // AI-supplied role text, matched by part name (optional)
}
```

In `case 'anatomy'`, replace the `parts` mapping:

```ts
        const controlled = propertiesByPart(spec.props);
        const parts = spec.anatomy.map((a, i) => {
          const by = controlled.get(a.name);
          return {
            n: i + 1,
            name: a.name,
            nested: a.nested,
            id: a.id,
            depth: a.depth,
            component: a.component,
            type: a.type,
            description: descByName.get(a.name.trim().toLowerCase()),
            ...(by && by.length ? { controlledBy: by } : {}),
          };
        });
```

- [ ] **Step 5: Change the renderer**

In `packages/plugin/src/docFrame.ts`, `anatomyLegendRow`: replace the body after the badge append with a vertical text column so the Controlled by line sits under the name line:

```ts
  const column = vstack(4);
  column.counterAxisAlignItems = 'MIN';
  row.appendChild(column);
  column.layoutSizingHorizontal = 'FILL';

  const desc = part.description?.trim();
  const nestedNote = part.nested ? `  ·  ${part.component ?? 'component'}` : '';
  const chars = desc ? `${part.name}: ${desc}` : `${part.name}${nestedNote}`;
  const text = makeText(chars, 'Regular', 15, palette.body, 150);
  column.appendChild(text);
  text.layoutSizingHorizontal = 'FILL';
  text.textAutoResize = 'HEIGHT';
  // Bold the part name only (the leading run before the colon / nested note).
  text.setRangeFontName(0, part.name.length, font('Bold'));

  // Which component properties drive this part. Same source as the Properties
  // table's Affects column, so the two cannot disagree. Omitted when none.
  if (part.controlledBy && part.controlledBy.length) {
    const by = makeText(`Controlled by: ${part.controlledBy.join(' · ')}`, 'Regular', 13, palette.muted, 150);
    column.appendChild(by);
    by.layoutSizingHorizontal = 'FILL';
    by.textAutoResize = 'HEIGHT';
  }
  return row;
```

Confirm `vstack` and `palette.muted` exist in this file (`grep -n "function vstack\|muted" packages/plugin/src/docFrame.ts packages/plugin/src/frameKit.ts`); they are used elsewhere in the same file.

In the `'table'` view branch, replace the rows and columns:

```ts
      const rows = section.parts.map((p) => [
        String(p.n),
        `${'    '.repeat(p.depth)}${p.name}`,
        p.type.toLowerCase(),
        p.component ?? '—',
        p.controlledBy?.length ? p.controlledBy.join(' · ') : '—',
      ]);
      const table = buildTable(['#', 'Part', 'Type', 'Component', 'Controlled by'], rows);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: PASS, exit 0. If `canvasProse` read-back tests fail because the legend row now holds two text nodes, read `packages/plugin/src/canvasProse.ts`'s `anatomyPart` slot reader: it must read the FIRST text node of the row (the description line), and the Controlled by line must not be tagged as editorial. Fix by tagging only the first text node if the reader tags the row's text children generically.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/src/docFrame.ts packages/plugin/test/docModel.test.ts packages/plugin/test/docFrameProse.test.ts
git commit -m "feat(plugin): anatomy legend drops token lists and names the properties that control each part

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Debug timing build

**Files:**
- Create: `packages/plugin/src/timing.ts`
- Modify: `packages/plugin/build.mjs`
- Modify: `package.json` scripts
- Modify: `packages/plugin/src/main.ts:33, 200-206, 588-700`
- Modify: `packages/plugin/src/docFrame.ts:1158-1300`
- Modify: `packages/plugin/src/messages.ts:92`
- Modify: `packages/plugin/src/ui/ui-vnext.ts:2173-2195`
- Test: `packages/plugin/test/timing.test.ts`, `packages/plugin/test/sandboxScan.test.ts`

**Interfaces:**
- Produces: `declare const __SPEC_LAYER_TIMING__: boolean;` defined by esbuild. `packages/plugin/src/timing.ts` exports `startTiming(label: string): Recorder`, `Recorder.phase<T>(name: string, run: () => Promise<T>): Promise<T>`, `Recorder.count(bucket: string): void`, `Recorder.summary(): TimingSummary`. `TimingSummary = { label: string; totalMs: number; phases: { name: string; ms: number; calls: number }[] }`. New `MainToUi` message `{ type: 'timingSummary'; summary: TimingSummary }`.

- [ ] **Step 1: Write the failing recorder test**

Create `packages/plugin/test/timing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { startTiming, type TimingSummary } from '../src/timing';

describe('timing recorder', () => {
  it('records phases in order with their call counts', async () => {
    let now = 1000;
    const rec = startTiming('create', () => now);
    await rec.phase('serialize', async () => { now += 12; rec.count('serialize'); rec.count('serialize'); });
    await rec.phase('section:anatomy', async () => { now += 30; rec.count('section:anatomy'); });
    const s: TimingSummary = rec.summary();
    expect(s.label).toBe('create');
    expect(s.totalMs).toBe(42);
    expect(s.phases).toEqual([
      { name: 'serialize', ms: 12, calls: 2 },
      { name: 'section:anatomy', ms: 30, calls: 1 },
    ]);
  });

  it('counts a call outside any phase under "other"', () => {
    const rec = startTiming('create', () => 0);
    rec.count('getNodeByIdAsync');
    expect(rec.summary().phases).toEqual([{ name: 'other', ms: 0, calls: 1 }]);
  });

  it('propagates a phase error and still closes the phase', async () => {
    let now = 0;
    const rec = startTiming('create', () => now);
    await expect(rec.phase('fonts', async () => { now += 5; throw new Error('boom'); })).rejects.toThrow('boom');
    expect(rec.summary().phases).toEqual([{ name: 'fonts', ms: 5, calls: 0 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/timing.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the recorder**

Create `packages/plugin/src/timing.ts`:

```ts
/**
 * Wall-clock phase timing for one create, on the plugin main thread.
 *
 * The Figma sandbox has no `performance` global, so the clock is `Date.now()`
 * injected as a function (tests pass a fake). This module has no Figma
 * dependency and no browser globals; it is pure bookkeeping. The build flag
 * `__SPEC_LAYER_TIMING__` decides whether main.ts and docFrame.ts call it at
 * all; under the normal build those calls compile away.
 */
export interface TimingPhase { name: string; ms: number; calls: number }
export interface TimingSummary { label: string; totalMs: number; phases: TimingPhase[] }

export interface Recorder {
  /** Time an async step. Nested phases are not supported: the innermost open
   *  phase owns every count until it closes. */
  phase<T>(name: string, run: () => Promise<T>): Promise<T>;
  /** Count one Figma async call (or any unit) against the open phase, or
   *  against "other" when no phase is open. `bucket` is informational. */
  count(bucket: string): void;
  summary(): TimingSummary;
}

export function startTiming(label: string, now: () => number = Date.now): Recorder {
  const phases: TimingPhase[] = [];
  const start = now();
  let open: TimingPhase | null = null;
  const other = (): TimingPhase => {
    let p = phases.find((x) => x.name === 'other');
    if (!p) { p = { name: 'other', ms: 0, calls: 0 }; phases.push(p); }
    return p;
  };
  return {
    async phase(name, run) {
      const p: TimingPhase = { name, ms: 0, calls: 0 };
      phases.push(p);
      open = p;
      const t0 = now();
      try {
        return await run();
      } finally {
        p.ms = now() - t0;
        open = null;
      }
    },
    count() {
      (open ?? other()).calls += 1;
    },
    summary() {
      return { label, totalMs: now() - start, phases: phases.map((p) => ({ ...p })) };
    },
  };
}

/** A recorder that does nothing, for the normal build and for call sites that
 *  run when no create is in progress. */
export const NOOP_RECORDER: Recorder = {
  async phase(_name, run) { return run(); },
  count() {},
  summary() { return { label: '', totalMs: 0, phases: [] }; },
};
```

Run: `npx vitest run packages/plugin/test/timing.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the build flag**

In `packages/plugin/build.mjs` replace the `define` block:

```js
// `--debug-timing` (npm run build:plugin:debug) turns on per-phase timing in
// the main thread. Under the normal build the constant is `false` and esbuild
// removes every branch behind it, so the shipped bundle carries no timing code.
const debugTiming = process.argv.includes('--debug-timing');
const define = {
  __PLUGIN_VERSION__: JSON.stringify(pkg.version),
  __SPEC_LAYER_TIMING__: JSON.stringify(debugTiming),
};
```

After `console.log('Built dist/main.js');` add:

```js
if (debugTiming) console.log('  with per-phase timing (debug build, do not ship)');
```

In the root `package.json` scripts add:

```json
    "build:plugin:debug": "node packages/plugin/build.mjs --debug-timing",
    "check:sandbox:debug": "npm run build:plugin:debug && node scripts/check-main-sandbox.mjs && npm run build:plugin",
```

The second script rebuilds the normal bundle afterwards so `dist/` never stays in the debug state.

In `packages/plugin/src/main.ts` after `declare const __PLUGIN_VERSION__: string;` add:

```ts
declare const __SPEC_LAYER_TIMING__: boolean;
```

Add the same declaration at the top of `packages/plugin/src/docFrame.ts` after its imports.

- [ ] **Step 5: Add the message and thread the recorder**

In `packages/plugin/src/messages.ts` import the type and add a member to `MainToUi` beside `docFrameDone`:

```ts
import type { TimingSummary } from './timing';
```

```ts
  | { type: 'timingSummary'; summary: TimingSummary }
```

In `packages/plugin/src/docFrame.ts` import:

```ts
import { NOOP_RECORDER, type Recorder } from './timing';
```

Change `buildDocFrames`'s signature to accept an optional recorder:

```ts
export async function buildDocFrames(
  model: DocFrameModel,
  theme: ReturnType<typeof resolveTheme>,
  logoBase64?: string | null,
  timing: Recorder = NOOP_RECORDER,
): Promise<SectionNode> {
```

Wrap the font/theme step: replace `await applyThemeToKit(theme);` with `await timing.phase('fonts', () => applyThemeToKit(theme));`.

Change `buildGroupFrame` to take `timing: Recorder` as its last parameter, pass `timing` from the loop in `buildDocFrames`, and inside it wrap the section loop:

```ts
    for (const section of group.sections) {
      const built = await timing.phase(`section:${section.id}`, () => buildSection(section));
      content.appendChild(built);
      built.layoutSizingHorizontal = 'FILL';
    }
```

Wrap the header build: `const header = await timing.phase(`group:${group.id}`, () => buildHeader(componentName, subtitle, group.label, logoBase64));`

Wrap the section creation and layout in `buildDocFrames` (from `section = figma.createSection();` through the resize that follows the frame loop) in `await timing.phase('append', async () => { ... });`, declaring `section` outside so the function still returns it.

In `packages/plugin/src/main.ts`:

Import `startTiming, NOOP_RECORDER, type Recorder` from `./timing`. Add a module-level `let createTiming: Recorder = NOOP_RECORDER;` and, in the selection handler where `serializeNode` is awaited (around line 203):

```ts
    if (__SPEC_LAYER_TIMING__) createTiming = startTiming('create');
    const node = await createTiming.phase('serialize', () =>
      serializeNode(component as any, countingResolver(memoizedResolver(resolver), createTiming)));
```

Add near the resolver definition:

```ts
/** Counts every resolver call against the open timing phase. Identity under
 *  the normal build: the wrapper is only created when the flag is on. */
function countingResolver(base: NodeResolver, timing: Recorder): NodeResolver {
  if (!__SPEC_LAYER_TIMING__) return base;
  return {
    variable(id) { timing.count('variable'); return base.variable(id); },
    style(id) { timing.count('style'); return base.style(id); },
    mainComponent(node) { timing.count('mainComponent'); return base.mainComponent(node); },
    componentName(id) { timing.count('componentName'); return base.componentName(id); },
  };
}
```

The `awaitRender` phase spans the gap between the end of serialization and the arrival of the render request, which is where the prose call lives. It is opened in the selection handler and closed by the render handler, so the release function lives at module level. Add near `createTiming`:

```ts
/** Closes the open `awaitRender` phase when the render request arrives. Null
 *  when no create is in flight. A selection that never renders leaves the
 *  promise pending; the next startTiming replaces the recorder, and the
 *  abandoned promise holds nothing. */
let releaseAwaitRender: (() => void) | null = null;
```

In the selection handler, directly after the `serialize` phase completes:

```ts
    if (__SPEC_LAYER_TIMING__) {
      void createTiming.phase('awaitRender', () => new Promise<void>((resolve) => { releaseAwaitRender = resolve; }));
    }
```

In the `renderDocFrame` handler:

- Directly after the `docFrameRendering` guard, close the phase:

```ts
      if (__SPEC_LAYER_TIMING__ && releaseAwaitRender) { releaseAwaitRender(); releaseAwaitRender = null; }
```

- Replace `section = await buildDocFrames(msg.model, resolveTheme(brandTheme), brandLogo);` with `section = await buildDocFrames(msg.model, resolveTheme(brandTheme), brandLogo, createTiming);`

- After the `docFrameDone` post, add:

```ts
        if (__SPEC_LAYER_TIMING__) {
          const summary = createTiming.summary();
          console.log('[Spec Layer timing]', JSON.stringify(summary));
          figma.ui.postMessage({ type: 'timingSummary', summary } as MainToUi);
          createTiming = NOOP_RECORDER;
        }
```

Also wrap `figma.getNodeByIdAsync` calls inside `docFrame.ts`'s `buildAnatomyDiagram` and `buildSlot` with a count: add `timing.count('getNodeByIdAsync')` before each `await figma.getNodeByIdAsync(...)` in functions that receive the recorder. To keep the change small, store the active recorder in a module-level `let activeTiming: Recorder = NOOP_RECORDER;` set at the top of `buildDocFrames` and reset to `NOOP_RECORDER` in a `finally`, and call `activeTiming.count('getNodeByIdAsync')` at those sites and `activeTiming.count('resolveToken')` at the top of `makeTokenCell`.

- [ ] **Step 6: Show the summary in the UI**

In `packages/plugin/src/ui/ui-vnext.ts`, in the `MainToUi` switch, add a case beside `docFrameDone`:

```ts
    case 'timingSummary': {
      // Debug builds only: the main thread never sends this under the normal
      // build. Shown as a copyable block so the manual checklist can record it.
      const lines = msg.summary.phases.map((p) => `${p.name}\t${p.ms} ms\t${p.calls} calls`);
      const text = [`${msg.summary.label}\t${msg.summary.totalMs} ms total`, ...lines].join('\n');
      console.log(text);
      nativeNotify(`Timing: ${msg.summary.totalMs} ms. Details in the console.`, { timeout: 8000 });
      break;
    }
```

`nativeNotify` is the existing helper this switch already uses. The console line is the copyable artifact for the checklist; the plugin console is open during a development build.

- [ ] **Step 7: Verify both bundles**

Run: `npm run typecheck && npx vitest run packages/plugin/test && npm run build:plugin && npm run check:sandbox && npm run check:sandbox:debug`
Expected: all exit 0. Then confirm the flag compiled away:

Run: `grep -c "Spec Layer timing" packages/plugin/dist/main.js`
Expected: `0` (the normal build was rebuilt last by `check:sandbox:debug`).

Run: `npm run build:plugin:debug && grep -c "Spec Layer timing" packages/plugin/dist/main.js && npm run build:plugin`
Expected: `1`, then a normal rebuild.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin/src/timing.ts packages/plugin/test/timing.test.ts packages/plugin/build.mjs package.json packages/plugin/src/main.ts packages/plugin/src/docFrame.ts packages/plugin/src/messages.ts packages/plugin/src/ui/ui-vnext.ts
git commit -m "chore(plugin): debug build with per-phase create timing behind a compile-time flag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Canvas checklist and manual matrix rows

**Files:**
- Create: `docs/manual-tests/2026-09-07-component-frame-quality.md`
- Modify: `packages/plugin/TESTING.md` (Generate component docs, Doc frame content, Library sections)

**Interfaces:**
- Consumes: the `timingSummary` console line format from Task 8 (`label<TAB>total ms total`, then `name<TAB>ms<TAB>calls` per phase).

- [ ] **Step 1: Write the checklist**

Create `docs/manual-tests/2026-09-07-component-frame-quality.md`:

```markdown
# Component frame quality checklist (run once)

Run against a debug build: `npm run build:plugin:debug`, then import
`packages/plugin/manifest.json` in Figma desktop. Rebuild with
`npm run build:plugin` afterwards. Open the plugin console (Plugins >
Development > Open console) before creating anything; the timing line prints
there.

This checklist produces two things: timing summaries for the create speed
spec, and canvas defects for the canvas fixes spec. Record both in the
sections at the bottom. Screenshots go in `docs/reviews/<date>-frame-quality/`
and must come from a synthetic file or one whose output may be shared.

## Components to build or pick

1. **Button.** One enum axis (Style: Filled, Outlined), one state axis
   (State: Enabled, Hovered, Disabled), a boolean `Show icon` driving a
   nested Icon instance, a text `Label`.
2. **Selector.** Three or more axes (for example Size, Emphasis, Shape),
   so the Variants matrix caps rows and shows the held-axis note.
3. **Card.** Slot-heavy, with nested instances two levels deep (an Avatar
   inside a header frame, a Button in a footer frame), an instance-swap
   property with a default, and at least one hardcoded padding.

For each component: create documentation with every section on and every
variant selected, then answer the checks below.

## Timing

Paste the console line for each create:

| Component | Variants | total ms | serialize | awaitRender | fonts | slowest section (name, ms, calls) | append |
|---|---|---|---|---|---|---|---|
| Button | | | | | | | |
| Selector | | | | | | | |
| Card | | | | | | | |

## Properties section

- [ ] Variant axes appear first, then booleans, text and swaps, in declaration order.
- [ ] `Show icon` lists the icon part under Affects; `Label` lists the label part.
- [ ] The instance-swap default shows a component name, never an id.
- [ ] An axis default matches the variant Figma marks as default.
- [ ] A component with no axes and no properties shows "No properties" on one line.
- [ ] A long Affects cell wraps inside the table; the table does not overflow the frame.

## Anatomy legend

- [ ] No token names appear in the legend.
- [ ] Parts driven by a property show "Controlled by: ..." under the name line.
- [ ] Parts with no property reference show no Controlled by line.
- [ ] The line wraps cleanly beside the number badge for a long property list.
- [ ] Card: the stacked wrapper frames are not listed as parts.

## Layout checks (record any failure as a defect)

- [ ] Tokens used: token column does not clip; cards in one row have equal height.
- [ ] Group frames fit the viewport at 100% zoom without scrolling more than one screen.
- [ ] Variants and States grids: previews are not scaled below legibility.
- [ ] Properties table width holds with the longest Affects cell.
- [ ] Nothing overlaps at the bottom of any group frame.

## Measurement checks

- [ ] Size labels point at the right edge of the right part.
- [ ] Padding labels appear only where padding exists; none on a zero-padding component.
- [ ] Spacing labels do not overlap each other or the instance.
- [ ] A bound padding shows its token; a hardcoded one shows the raw value un-decorated.
- [ ] A lens that has nothing to show for the component renders its fallback, not an empty diagram.

## Rebuild path

- [ ] A document created before this build shows "Rebuild needed" in the Library.
- [ ] Update on it produces Properties in place of Configuration and keeps hand-edited prose.

## Defects found

| # | Component | Section | What is wrong | Screenshot |
|---|---|---|---|---|
| | | | | |

## Timing notes

Anything the numbers make obvious: a section that dominates, a call count
that scales with variants, a phase that surprised you.
```

- [ ] **Step 2: Add matrix rows**

In `packages/plugin/TESTING.md`, in the `## Doc frame content` section (find it with `grep -n "^## Doc frame content" packages/plugin/TESTING.md`), add these numbered steps at the end of its list, continuing the numbering:

```markdown
N. **Properties** lists variant axes first, then boolean, text and
   instance-swap properties, with an Affects column naming the parts each one
   drives. An instance-swap default shows a component name, never an id. A
   component with no axes and no properties shows "No properties".
N+1. **Anatomy legend** shows no token names. A part driven by a property
   shows "Controlled by: ..." under its name; a part with no reference shows
   no such line.
```

In the `## Library` section add:

```markdown
N. A document created by a build with `EXTRACTOR_VERSION` `2` shows
   **Rebuild needed**, never "Update available". **Update** rebuilds it with
   Properties in place of Configuration and keeps editorial prose.
```

Replace `N` with the next numbers in each list.

- [ ] **Step 3: Check for NUL bytes and commit**

Run: `npm run check:nul && tr -d -c '\000' < docs/manual-tests/2026-09-07-component-frame-quality.md | wc -c`
Expected: exit 0 and `0`.

```bash
git add docs/manual-tests/2026-09-07-component-frame-quality.md packages/plugin/TESTING.md
git commit -m "docs: component frame quality checklist and matrix rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Documentation and the full gate

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/plugin-knowledge-map.md` (Canvas rendering)
- Modify: `docs/reviews/2026-09-05-major-review.md` (E5, E6, S6)
- Modify: `CLAUDE.md` (Invariants)
- Modify: `docs/superpowers/specs/2026-09-06-component-frame-quality-design.md` (status line)

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` in `CHANGELOG.md`, add to `### Added`:

```markdown
- **Properties section** replaces Configuration in component documents. It
  lists every component property, variant axes included, with an Affects
  column naming the parts each property drives, read from Figma's own
  property references. An instance-swap default shows the component's name.
  A component without properties shows "No properties".
- **Controlled by** in the Anatomy legend: each part lists the properties that
  drive it, from the same source as the Properties table. The legend no longer
  repeats token names, which Tokens used carries per variant.
- `npm run build:plugin:debug` builds the plugin with per-phase create timing
  printed to the plugin console. The normal build carries none of it.
```

Add to `### Fixed`:

```markdown
- A corner radius bound on any single corner is no longer reported as a
  hardcoded radius gap.
- Anatomy descends through up to three stacked wrapper frames instead of
  listing the second wrapper as the only part.
```

- [ ] **Step 2: Knowledge map**

In `docs/plugin-knowledge-map.md`, `## Canvas rendering`, add after the paragraph that starts `Component content is assembled by`:

```markdown
Component property references are read once by the serializer and reach two
sections through `extractProps`: the Properties table's Affects column and the
Anatomy legend's Controlled by line, via `propertiesByPart`. Neither section
may derive the link on its own.
```

- [ ] **Step 3: Review document**

In `docs/reviews/2026-09-05-major-review.md`, append to finding **E5**: `Addressed 2026-09-07 (component frame quality round 1): the gap scan and the raw-value scan share one radius binding set.` Append to **E6**: `Addressed 2026-09-07: canonical() sorts by code units as of EXTRACTOR_VERSION 3.` Append to **S6**: `Addressed 2026-09-07: npm run build:plugin:debug records per-phase timings; docs/manual-tests/2026-09-07-component-frame-quality.md collects them.` In section 9, strike items 16 and 17's first sentence as done where they match (16 is done; 17 remains open since no new layout facts were added).

- [ ] **Step 4: CLAUDE.md**

In `CLAUDE.md`, change the `EXTRACTOR_VERSION` invariant's last sentence to `It is currently \`'3'\`.` Change the `localeCompare` invariant to:

```markdown
**Do not use `localeCompare` under `src/v5` or in `hash.ts`.** Use
`compareCodeUnits`. Locale ordering makes hashes machine-dependent.
```

In the `Where things stand` block, add under "Shipped and merged" one bullet: `Component frame quality round 1 (2026-09-07): Properties section, trimmed Anatomy legend, radius and wrapper fixes, extractor version 3, debug timing build. Checklist in docs/manual-tests/2026-09-07-component-frame-quality.md not yet run.`

- [ ] **Step 5: Spec status**

In `docs/superpowers/specs/2026-09-06-component-frame-quality-design.md`, change the status line to `**Status:** Implemented 2026-09-07 (plan docs/superpowers/plans/2026-09-07-component-frame-quality.md). Checklist run pending.`

- [ ] **Step 6: Full gate**

Run: `npm run check`
Expected: exit 0. Read the exit status directly; do not pipe.

Run: `npm run check:sandbox:debug`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add CHANGELOG.md docs/plugin-knowledge-map.md docs/reviews/2026-09-05-major-review.md CLAUDE.md docs/superpowers/specs/2026-09-06-component-frame-quality-design.md
git commit -m "docs: record component frame quality round 1 across changelog, knowledge map, review and invariants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Not in this plan

- Any speed optimization (spec B, after the checklist's timing numbers).
- Any canvas layout or measurement label fix (spec C, after the checklist's defects).
- Nested-instance attribution, composition, the boundary setting (the patterns spec, `2026-09-06-patterns-and-nested-components-design.md`).
- Carrying `affects` into the v5 artifact.
