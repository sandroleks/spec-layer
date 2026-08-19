# Copy for AI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two Copy for AI briefs small enough to paste and correct enough to trust — cut a 36-variant component brief from roughly 2,700 lines to 400-500, give every part one identity, stop `unbound` contradicting `tokens`, carry the generated foundation prose that is currently dropped, and move contrast from components to foundation colours.

**Architecture:** All extraction logic is pure TypeScript in `packages/extractor`, tested under vitest with no Figma. The plugin (`packages/plugin`) consumes it and renders frames. Contrast becomes a new pure module (`colorContrast.ts`) that classifies foundation colour variables by role and measures within-collection pairs per mode; the component-side contrast walk is deleted. Part identity becomes a slash-joined path produced by one walk and carried on `TokenRule`, `Gap` and `AnatomyPart`.

**Tech Stack:** TypeScript, vitest, npm workspaces. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-copy-for-ai-v2-design.md`

**Scope:** The whole v2 design, in one resequenced track. The spec separates a
correctness half from a format half; this plan interleaves them, because they are not
independent and because the size reduction is the most valuable single change.

**Order, and why.** The size win lands at Tasks 4 and 5, not at Task 13. Three dependencies
force the shape:

- Condition-based bindings need a part identity, so path identity (Task 3) comes first.
  Keying bindings on `part` and migrating later would mean writing them twice.
- The `validation` block needs gaps to carry a property and stable ids (Task 8) and
  values to know their mode (Task 9), so it follows both.
- Removing per-component contrast (Tasks 1-2) precedes the format rewrite, because both
  edit the same regions of `brief.ts` and removal deletes code the rewrite would
  otherwise carry forward.

Foundation contrast (Tasks 14-19) has no dependency on the format work, so it sits last.
Removing the broken per-component contrast still happens at Task 1, so the misleading
`measured: 0` block goes away immediately either way.

## Global Constraints

- **No new runtime dependency in the plugin bundle.** Nothing added to `packages/plugin` dependencies.
- **The Figma sandbox has no browser globals.** The main-thread bundle must not reference `TextEncoder`, `window`, `document`, `fetch`, `atob` or `btoa`. `npm run check:sandbox` scans `dist/main.js` and the build fails on a violation. Node tests pass regardless, so the check is the only guard.
- **Never write a raw NUL byte into any file.** Where a separator is needed, use a space or another printable delimiter. If the character must be referenced in source, write the escape sequence `\u0000`, never the byte itself. This has bitten this repo three times: a raw NUL evades lint, tests, `check:ci` and `git diff`. `npm run check:nul` guards `packages/` but NOT `docs/`, so a plan document is exactly where it slips through.
- **Plugin UI copy: never use em dashes or en dashes.** Plain, honest, peer tone. Rules in `docs/plugin-voice-and-copy.md`.
- **`specContentHash` and `foundationContentHash` must not change value except where a task says so explicitly.** Every task touching a hashed type adds a projection and a test proving the hash held.
- **Baseline:** `npm test` is green at 76 files / 1271 tests before starting. Run it after every task.
- **Two authoring bugs recur in this plan's own code samples. Fix them silently when you
  hit one; they are not behaviour changes.**
  1. **`{ key: undefined }` does not remove a key in JavaScript.** Several samples build a
     result object with undefined-valued keys, relying on the YAML emitter to drop them —
     but the same task's tests often assert `'key' in obj` on the RAW object, where the key
     is present with value `undefined`. Build such objects with conditional key adds
     (`...(v !== undefined ? { key: v } : {})`) so the raw object matches what the tests
     and the emitted YAML both claim. This has already bitten Tasks 4 and 6.
  2. **A group defined by an allow-list silently drops what it does not list.** Prefer
     defining a bucket by exclusion, so a value the author did not anticipate surfaces
     rather than vanishing. `api.slots` exists because a three-group allow-list dropped
     every `text` and `instanceSwap` prop, and both fixtures had one.

- **Commit after every task.** Conventional commits, with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` as the last line.

---

## File Structure

**Created:**
- `packages/extractor/src/colorContrast.ts` — role classification and within-collection pair measurement. Pure. Owns `colorRole`, `barsCleared`, `colorContrast`.
- `packages/extractor/test/colorContrast.test.ts` — its tests.
- `packages/plugin/src/foundationContrast.ts` — the matrix block. Kept out of `foundationFrame.ts` (686 lines already) so the matrix owns one file.
- `packages/plugin/test/foundationContrast.test.ts` — its tests.
- `packages/extractor/src/validate.ts` — deterministic findings about one component. Pure.
- `packages/extractor/test/validate.test.ts` — its tests.
- `packages/extractor/test/briefGolden.test.ts` — size assertion, golden-file diff, and the generated-content boundary scan.
- `packages/extractor/test/fixtures/button-brief.yaml` — the reviewed golden payload.

**Modified:**
- `packages/extractor/src/contrast.ts` — keep the pure WCAG maths, delete the component-side half, export `concreteColor`.
- `packages/extractor/src/extract.ts` — drop the `contrast` field and the `foundation` option.
- `packages/extractor/src/hash.ts` — project `tokens` and `gaps` to legacy shapes.
- `packages/extractor/src/naming.ts` — path-aware walk.
- `packages/extractor/src/tokens.ts` — `TokenRule.path`, `Gap.path`, `Gap.property`.
- `packages/extractor/src/anatomy.ts` — `AnatomyPart.path`.
- `packages/extractor/src/brief.ts` — the largest surface: token definitions and condition-based bindings, the `api` split, typography, `validation`, `source` split, `mode` on values, `unbound` reconciliation, and both foundation blocks.
- `packages/extractor/src/statesMatrix.ts` — export `isStateLike` so the ambiguity finding matches the matrix the frames render.
- `packages/plugin/src/ui/docModel.ts` — remove the `contrast` section.
- `packages/plugin/src/docLink.ts` — validate stored section ids, add `includeContrast`.
- `packages/plugin/src/foundationFrame.ts` — call the new matrix block.
- `packages/plugin/src/ui/actions.ts` — drop `foundation` from `extract()` calls, pass prose and contrast to the foundation brief.

**Deliberately unchanged:** `FoundationUnitContent` in `packages/extractor/src/foundation.ts`. Contrast is derived from colours already inside its `rows`, so adding it there would hash a value that cannot change without the hash already moving, and would flip every existing foundation doc to "update available".

**Deleted:**
- `packages/extractor/test/extractContrast.test.ts` — tests only the deleted component walk.

---

### Task 1: Remove the Contrast section from the component doc model
A reviewer can accept this UI-side removal independently of the type-level removal in Task 2.

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts:9-27` (SectionId union, ALL_SECTIONS), `:313-345` (the `contrast` case)
- Modify: `packages/plugin/src/docLink.ts:274` (section id validation)
- Test: `packages/plugin/test/docModel.test.ts`, `packages/plugin/test/docLink.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SectionId` no longer includes `'contrast'`. `KNOWN_SECTION_IDS: ReadonlySet<string>` exported from `docModel.ts`.

- [ ] **Step 1: Write the failing tests**

In `packages/plugin/test/docModel.test.ts`:

```ts
import { ALL_SECTIONS, KNOWN_SECTION_IDS } from '../src/ui/docModel';

describe('contrast is not a component section', () => {
  it('is absent from ALL_SECTIONS', () => {
    expect(ALL_SECTIONS.map((s) => s.id)).not.toContain('contrast');
  });
  it('is absent from the known id set', () => {
    expect(KNOWN_SECTION_IDS.has('contrast')).toBe(false);
  });
  it('still offers the other three a11y sections', () => {
    const a11y = ALL_SECTIONS.filter((s) => s.group === 'a11y').map((s) => s.id);
    expect(a11y).toEqual(['interactions', 'contentConsiderations', 'accessibility']);
  });
});
```

In `packages/plugin/test/docLink.test.ts`:

```ts
import { parseDocLink } from '../src/docLink';

it('drops a stored section id that no longer exists', () => {
  const blob = JSON.stringify({
    v: 1, kind: 'component', sourceNodeId: '1:2', contentHash: 'h', selfHash: 's',
    generatedAt: 0, pluginVersion: '2.0.0',
    config: { sections: ['definition', 'contrast', 'tokens'], variantIds: [], aiEnabled: false,
              anatomyView: 'diagram', measureViews: [] },
  });
  const parsed = parseDocLink(blob);
  expect(parsed).not.toBeNull();
  expect(parsed!.config.sections).toEqual(['definition', 'tokens']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/docModel.test.ts packages/plugin/test/docLink.test.ts`

Expected: FAIL. `KNOWN_SECTION_IDS` is not exported, and `sections` still contains `'contrast'`.

- [ ] **Step 3: Remove the section from `docModel.ts`**

Delete `'contrast'` from the `SectionId` union (line 10), delete the `{ id: 'contrast', ... }` entry from `ALL_SECTIONS` (line 25), and delete the entire `case 'contrast': { ... }` block (lines 313-345). Then check whether the helpers it used are now dead:

```bash
grep -n "CONTRAST_UNCHECKED_REASON\|makeBullet\|count(" packages/plugin/src/ui/docModel.ts
```

Delete `CONTRAST_UNCHECKED_REASON` if nothing else references it. Keep `makeBullet` and `count` if other sections still call them.

Add, next to `ALL_SECTIONS`:

```ts
/** Every section id the current build knows how to render. A stored config can
 *  name a section that has since been removed (Contrast was one), and rendering
 *  an unknown id would fall through the section switch and silently produce
 *  nothing, so parsing filters against this set instead of trusting the list. */
export const KNOWN_SECTION_IDS: ReadonlySet<string> = new Set(ALL_SECTIONS.map((s) => s.id));
```

- [ ] **Step 4: Filter stored ids in `docLink.ts`**

Add the import at the top of `packages/plugin/src/docLink.ts`:

```ts
import { KNOWN_SECTION_IDS } from './ui/docModel';
```

Replace the `sections` line inside the config parse:

```ts
    sections: (c.sections ?? []).filter((x): x is SectionId =>
      typeof x === 'string' && KNOWN_SECTION_IDS.has(x)),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docModel.test.ts packages/plugin/test/docLink.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the full suite and the type check**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS. If `tsc` reports an unused import or an unreachable branch elsewhere, fix it rather than suppressing it.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/src/docLink.ts packages/plugin/test/docModel.test.ts packages/plugin/test/docLink.test.ts
git commit -m "feat(plugin)!: remove Contrast as a component doc section" -m "A contrast ratio is a fact about two colour values, not about a component. Stored configs naming the removed id are filtered on parse rather than left to fall through the section switch and render nothing." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 2: Remove contrast from IntermediateSpec, extract() and the component brief
**Files:**
- Modify: `packages/extractor/src/extract.ts:20-99`
- Modify: `packages/extractor/src/contrast.ts` (delete from line 64 onward except `resolveTokenColor` and a new `concreteColor`)
- Modify: `packages/extractor/src/hash.ts:42-50`
- Modify: `packages/extractor/src/brief.ts:325-341` (the `contrast` block in `componentBrief`)
- Modify: `packages/extractor/src/index.ts`
- Modify: `packages/plugin/src/ui/actions.ts:119,519,590`, `packages/plugin/src/ui/ui.ts:1192`, `packages/plugin/src/ui/ui-vnext.ts:2101`
- Delete: `packages/extractor/test/extractContrast.test.ts`
- Test: `packages/extractor/test/specHash.test.ts`, `packages/extractor/test/contrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `extract(root: SerializedNode, meta: { figmaFile: string }): IntermediateSpec` — the `foundation` option is gone. `IntermediateSpec` has no `contrast` field. `concreteColor(v: FoundationValue): { hex: string; alpha: number } | null` exported from `contrast.ts`.

- [ ] **Step 1: Capture the current hash baseline before changing anything**

This must happen first. The baseline can only be trusted if it is measured on unmodified code.

```bash
npx tsx -e "const {readFileSync}=require('fs');const {extract,specContentHash}=require('./packages/extractor/src/index.ts');const n=JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json','utf8'));console.log(specContentHash(extract(n,{figmaFile:'FILE1',foundation:undefined})));"
```

- [ ] **Step 2: Write the hash-stability test using that value**

Append to `packages/extractor/test/specHash.test.ts`, pasting the printed value:

```ts
import { readFileSync } from 'node:fs';

/** Measured on 2026-08-18 against v1, before contrast left IntermediateSpec.
 *  Every component doc on canvas stores a baseline computed this way, so a change
 *  to this constant means every one of them reports drift. Only a task that says
 *  it re-cuts the baseline may change it. */
const BUTTON_HASH_V1 = 'PASTE_THE_VALUE_FROM_STEP_1';

it('is unchanged by removing the contrast field', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  expect(specContentHash(spec)).toBe(BUTTON_HASH_V1);
});
```

- [ ] **Step 3: Run it to confirm the baseline is right before it guards anything**

Run: `npx vitest run packages/extractor/test/specHash.test.ts`

Expected: PASS. (It compiles because `extract` currently accepts the extra key as optional.) A FAIL here means the value was pasted wrong; fix it before continuing.

- [ ] **Step 4: Delete the component-side half of `contrast.ts`**

Keep `relativeLuminance`, `contrastRatio`, `blend`, `requiredRatio`, `resolveTokenColor`, and the private `rgb` / `toHex` / `clamp255` helpers.

Delete `ContrastFinding`, `ContrastReport`, `emptyContrastReport`, `TextMetrics`, `VariantTextMetrics`, `collectTextMetrics`, `isDisabled`, `AncestorFill`, `nearestPaintedAncestor`, `checkContrast`, and the now-unused imports of `IntermediateSpec`, `VariantAxisModel`, `cleanPartName`, `walkParts` and `resolveTokensForVariant`.

Promote the private `concrete` to an export, because `colorContrast.ts` needs it in Task 16:

```ts
/** Follow an alias chain to the concrete colour it stands for. Exported because
 *  foundation contrast resolves variable values exactly the same way. */
export function concreteColor(v: FoundationValue): { hex: string; alpha: number } | null {
  if (v.kind === 'color') return { hex: v.hex, alpha: v.alpha };
  if (v.kind === 'alias' && v.resolved) return concreteColor(v.resolved);
  return null;
}
```

- [ ] **Step 5: Drop the field and the option from `extract.ts`**

Remove `contrast: ContrastReport;` from `IntermediateSpec` along with its comment block, and rewrite the function:

```ts
export function extract(
  root: SerializedNode,
  meta: { figmaFile: string },
): IntermediateSpec {
  const { parts, related, componentId } = extractAnatomy(root);
  const model = variantAxisModel(root);
  return {
    name: root.name,
    figmaKey: root.key ?? '',
    figmaFile: meta.figmaFile,
    figmaNode: root.id,
    anatomy: parts,
    anatomyComponentId: componentId,
    props: extractProps(root),
    variants: extractVariants(root),
    variantInstances: toVariantInstances(model),
    states: extractStates(root),
    tokens: extractTokens(root, model),
    related,
    gaps: extractGaps(root),
    layout: extractLayout(root),
    rawValues: extractRawValues(root),
  };
}
```

Delete the `checkContrast`, `collectTextMetrics` and `emptyContrastReport` imports, and the trailing comment block explaining the foundation-conditional return.

- [ ] **Step 6: Update `hash.ts`**

`contrast` no longer exists, so the destructure must stop naming it:

```ts
export function specContentHash(spec: IntermediateSpec): string {
  const { rawValues: _rawValues, ...rest } = spec;
  const hashable = {
    ...rest,
    anatomy: spec.anatomy
      .filter((p) => p.depth === 0)
      .map(({ id, name, type, nested }) => ({ id, name, type, nested })),
  };
  return contentHash(hashable);
}
```

Delete the two paragraphs of its doc comment that explain why `contrast` is excluded. There is no longer a `contrast` to exclude, and a comment describing an absent field is how comments go stale.

- [ ] **Step 7: Drop the brief block and update every call site**

In `brief.ts`, delete the whole `contrast: { ... }` property from `componentBrief`'s return, with its comment.

In `packages/plugin/src/ui/actions.ts`, lines 119, 519 and 590 lose the foundation spread:

```ts
  const spec = extract(src.node, { figmaFile: src.fileKey });
```

`componentBrief` still takes `foundation` for token resolution, so leave the `toYaml(componentBrief(spec, { ... foundation ... }))` calls alone. Then confirm nothing still passes a foundation to `extract`:

```bash
grep -rn "extract(" packages/plugin/src packages/extractor/test | grep -i foundation
```

In `packages/extractor/src/index.ts`, remove `checkContrast`, `emptyContrastReport`, `collectTextMetrics`, `ContrastReport` and `ContrastFinding` from the exports, and add `concreteColor`.

- [ ] **Step 8: Delete the dead test file and trim the contrast test**

```bash
git rm packages/extractor/test/extractContrast.test.ts
```

In `packages/extractor/test/contrast.test.ts`, delete the `checkContrast` describe blocks and the now-unused imports (`checkContrast`, `ContrastFinding`, `IntermediateSpec`). Keep every `relativeLuminance`, `contrastRatio`, `blend`, `requiredRatio` and `resolveTokenColor` test exactly as it is: those are the functions foundation contrast will reuse, so their coverage still matters.

- [ ] **Step 9: Assert the field is actually gone**

Append to `packages/extractor/test/extract.test.ts`:

```ts
it('carries no contrast field', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  // `tsc` catches this at the type level, but a stored spec deserialized from
  // pluginData is plain JSON with no type, so the runtime shape matters too.
  expect('contrast' in spec).toBe(false);
});
```

- [ ] **Step 10: Run the full suite and the type check**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS, including the Step 2 test, which now proves the removal did not move the hash.

- [ ] **Step 11: Commit**

```bash
git add -A packages/extractor packages/plugin/src/ui
git commit -m "refactor(extractor)!: drop per-component contrast" -m "Removes IntermediateSpec.contrast, the brief block, and the component-side half of contrast.ts. The pure WCAG maths stays and is reused by foundation contrast." -m "extract() no longer takes a foundation: that option existed only to feed contrast, so removing it also retires the drift-path asymmetry that comments in three files existed to explain." -m "A hash test captures the v1 baseline first and proves removal does not move it." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 3: Give every part one identity
**Files:**
- Modify: `packages/extractor/src/naming.ts:52-63` (`walkParts`)
- Modify: `packages/extractor/src/tokens.ts:12-20` (`TokenRule`, `Gap`), and the walks at `:230` and `:523`
- Modify: `packages/extractor/src/anatomy.ts:4-13` (`AnatomyPart`), `:89-104` (`addParts`)
- Modify: `packages/extractor/src/hash.ts:42-50`
- Test: `packages/extractor/test/naming.test.ts`, `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `joinPath(parentPath: string, part: string): string`. `walkParts(root, rootName, visit: (n: SerializedNode, part: string, path: string) => void, skipInvisible?: boolean, parentPath?: string): void` — the visitor gains a third argument. `TokenRule`, `Gap` and `AnatomyPart` each gain `path: string`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/naming.test.ts`:

```ts
import { walkParts, joinPath } from '../src/naming';

describe('joinPath', () => {
  it('joins segments with a slash', () => {
    expect(joinPath('Container', 'Label')).toBe('Container/Label');
  });
  it('escapes a literal slash so the path stays unambiguous', () => {
    // A layer really can be called "icon/left". Unescaped, its path is
    // indistinguishable from a layer "left" nested inside a layer "icon".
    expect(joinPath('Container', 'icon/left')).toBe('Container/icon\\/left');
  });
  it('returns the segment unchanged when there is no parent', () => {
    expect(joinPath('', 'Container')).toBe('Container');
  });
});

describe('walkParts paths', () => {
  const node = (name: string, children: unknown[] = []) =>
    ({ id: name, name, type: 'FRAME', visible: true, children } as never);

  it('hands each node its full path', () => {
    const seen: string[] = [];
    walkParts(
      node('Container', [node('iconLeft'), node('ButtonLabel', [node('Label')])]),
      'Container',
      (_n, _part, path) => seen.push(path),
    );
    expect(seen).toEqual([
      'Container', 'Container/iconLeft', 'Container/ButtonLabel', 'Container/ButtonLabel/Label',
    ]);
  });

  it('disambiguates same-named siblings inside the path', () => {
    const seen: string[] = [];
    walkParts(node('Container', [node('icon'), node('icon')]), 'Container',
      (_n, _part, path) => seen.push(path));
    expect(seen).toEqual(['Container', 'Container/icon', 'Container/icon (2)']);
  });

  it('distinguishes the same leaf name in two subtrees', () => {
    const seen: string[] = [];
    walkParts(
      node('Root', [node('header', [node('label')]), node('footer', [node('label')])]),
      'Root',
      (_n, _part, path) => seen.push(path),
    );
    expect(seen).toContain('Root/header/label');
    expect(seen).toContain('Root/footer/label');
  });
});
```

Append to `packages/extractor/test/specHash.test.ts`:

```ts
it('is unchanged by adding paths to tokens and gaps', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  expect(spec.tokens[0].path).toBeTruthy();            // the field exists
  expect(specContentHash(spec)).toBe(BUTTON_HASH_V1);  // and does not enter the hash
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/naming.test.ts packages/extractor/test/specHash.test.ts`

Expected: FAIL. `joinPath` is not exported, the visitor takes two arguments, and `spec.tokens[0].path` is undefined.

- [ ] **Step 3: Add `joinPath` and thread the path through `walkParts`**

In `packages/extractor/src/naming.ts`:

```ts
/**
 * Join a parent path and a child part name into a path identity.
 *
 * A layer name can itself contain a slash, which would make a joined path
 * ambiguous: "Container/icon/left" could be a layer called "icon/left" inside
 * Container, or a layer "left" inside a layer "icon". Escaping the literal at
 * construction keeps the identity a single readable string, which it has to be if
 * a reader is to match a token binding against an anatomy entry by eye.
 */
export function joinPath(parentPath: string, part: string): string {
  const escaped = part.replace(/\//g, '\\/');
  return parentPath ? `${parentPath}/${escaped}` : escaped;
}

export function walkParts(
  root: SerializedNode,
  rootName: string,
  visit: (n: SerializedNode, part: string, path: string) => void,
  skipInvisible = false,
  parentPath = '',
): void {
  if (skipInvisible && root.visible === false) return;
  const path = joinPath(parentPath, rootName);
  visit(root, rootName, path);
  const kids = root.children ?? [];
  const names = siblingPartNames(kids);
  for (const child of kids) {
    walkParts(child, names.get(child)!, visit, skipInvisible, path);
  }
}
```

- [ ] **Step 4: Carry the path on the three types**

In `packages/extractor/src/tokens.ts`:

```ts
export interface TokenRule {
  part: string;
  /** Path identity from the component root. The join key every consumer uses;
   *  `part` is the leaf name and is for display only. */
  path: string;
  property: string;
  conditions: Record<string, string[]>;
  token: string;
}

export interface Gap { part: string; path: string; issue: string }
```

Update every `walkParts` callback in `extractTokens` and `extractGaps` to take the third argument and set `path`. In `anatomy.ts`, add `path: string` to `AnatomyPart`, thread a `parentPath` argument through `addParts`, and set `path: joinPath(parentPath, names.get(child)!)`.

- [ ] **Step 5: Protect the hash**

In `packages/extractor/src/hash.ts`:

```ts
export function specContentHash(spec: IntermediateSpec): string {
  const { rawValues: _rawValues, ...rest } = spec;
  const hashable = {
    ...rest,
    anatomy: spec.anatomy
      .filter((p) => p.depth === 0)
      .map(({ id, name, type, nested }) => ({ id, name, type, nested })),
    // `path` is a new identity for data already hashed under `part`, so it must
    // not enter the hash: every committed doc compares against a baseline
    // computed without it, and including it would flip all of them to "update
    // available" for a change that alters no rendered output. Same reasoning, and
    // same shape, as the anatomy reduction above.
    tokens: spec.tokens.map(({ part, property, conditions, token }) =>
      ({ part, property, conditions, token })),
    gaps: spec.gaps.map(({ part, issue }) => ({ part, issue })),
  };
  return contentHash(hashable);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/naming.test.ts packages/extractor/test/specHash.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS. Tests asserting exact `TokenRule` or `Gap` objects need `path` added to their expected values. Add the real expected path; do not weaken the assertion to `objectContaining` to avoid the work, because the path is the thing this task exists to get right.

- [ ] **Step 8: Commit**

```bash
git add packages/extractor/src packages/extractor/test
git commit -m "feat(extractor): give every part one path identity" -m "TokenRule, Gap and AnatomyPart now carry a slash-joined path from the component root, produced by one walk. Nothing could previously join anatomy (ButtonLabel) to bindings (Label), because they name parts from different walks." -m "A literal slash in a layer name is escaped at construction, or a path could not be told apart from one more level of nesting." -m "specContentHash projects tokens and gaps back to their pre-path shapes: path is a new identity for already-hashed data, and including it would flip every committed doc to update-available without changing any rendered output." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 4: Emit token definitions once and bindings by condition
This is the task the reorder exists for. The `tokens` block is roughly 2,400 of the
sample brief's 2,700 lines, because `by_variant` expands the full 36-way cross
product and repeats every geometry and colour binding in each entry.

The minimal conditions are already computed and already on `TokenRule.conditions`;
v1 threw them away and re-resolved per variant. Emitting them instead removes the
duplication without asking the reader to evaluate anything: a `when` map is a
lookup, not a boolean expression.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (replace `tokensOf`, `bindingOf`, `bindingKey`, `dedupeByKey`)
- Test: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `TokenRule.path` (Task 3); `lookupToken` (existing, gains `mode` in Task 9).
- Produces: `tokens` is `{ used: Record<string, TokenDefinition>, bindings: Binding[] }` where
  `TokenDefinition` is `{ alias?, resolved?, code? }` and `Binding` is
  `{ path, property, token, when? }`. `base` and `by_variant` no longer exist.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists each token once under used, in first-use order', () => {
  const spec = { ...baseSpec(), tokens: [
    { part: 'Container', path: 'Container', property: 'fill',
      conditions: { type: ['Primary'] }, token: 'color/surface/primary/default' },
    { part: 'Container', path: 'Container', property: 'fill',
      conditions: { type: ['Outline'] }, token: 'color/surface/primary/default' },
    { part: 'Container', path: 'Container', property: 'height',
      conditions: { size: ['Large'] }, token: 'button/lg-height' },
  ] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(Object.keys(brief.tokens.used)).toEqual([
    'color/surface/primary/default', 'button/lg-height',
  ]);
});

it('emits one binding per rule, carrying only the axes it depends on', () => {
  const spec = { ...baseSpec(), tokens: [
    { part: 'Container', path: 'Container', property: 'height',
      conditions: { size: ['Large'] }, token: 'button/lg-height' },
  ] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(brief.tokens.bindings).toEqual([
    { path: 'Container', property: 'height', token: 'button/lg-height',
      when: { size: ['Large'] } },
  ]);
});

it('omits when entirely for a binding that holds in every variant', () => {
  const spec = { ...baseSpec(), tokens: [
    { part: 'Container', path: 'Container', property: 'border-radius',
      conditions: {}, token: 'rd-sm' },
  ] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(brief.tokens.bindings[0]).toEqual(
    { path: 'Container', property: 'border-radius', token: 'rd-sm' });
  expect('when' in brief.tokens.bindings[0]).toBe(false);
});

it('no longer emits base or by_variant', () => {
  const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as Record<string, any>;
  expect('base' in brief.tokens).toBe(false);
  expect('by_variant' in brief.tokens).toBe(false);
});

it('dedupes rules identical in path, property, token and conditions', () => {
  // tokens.ts documents that a part name is unique only among siblings, so two
  // nodes in different subtrees can minimize into identical rules. Paths make
  // most of those distinct, but a genuine duplicate must still collapse to one.
  const rule = { part: 'Label', path: 'Container/Label', property: 'fill',
                 conditions: { type: ['Primary'] }, token: 'color/text/default' };
  const spec = { ...baseSpec(), tokens: [rule, { ...rule }] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(brief.tokens.bindings).toHaveLength(1);
});

it('keeps two rules that differ only in conditions', () => {
  const spec = { ...baseSpec(), tokens: [
    { part: 'Container', path: 'Container', property: 'fill',
      conditions: { size: ['Large'] }, token: 'a' },
    { part: 'Container', path: 'Container', property: 'fill',
      conditions: { size: ['Small'] }, token: 'a' },
  ] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(brief.tokens.bindings).toHaveLength(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t tokens`

Expected: FAIL. `brief.tokens` still has `base` and `by_variant`.

- [ ] **Step 3: Replace the token projection**

In `packages/extractor/src/brief.ts`, delete `bindingKey`, `dedupeByKey`, `tokensOf` and the
`resolveTokensForVariant` import, and write:

```ts
/**
 * Identity of a RULE, not of a resolved binding: two rules differing only in
 * `conditions` are two real rules and must both survive. Conditions are
 * canonicalized through JSON.stringify over sorted axis names, so key order in
 * the object cannot make one rule look like two.
 *
 * The separator is a space. An earlier version of this file used a NUL byte,
 * which is invisible in a diff and evades every check in the repo.
 */
function ruleKey(t: TokenRule): string {
  const axes = Object.keys(t.conditions).sort();
  const canon = JSON.stringify(axes.map((a) => [a, t.conditions[a]]));
  return `${t.path} ${t.property} ${t.token} ${canon}`;
}

/**
 * Token definitions once, bindings by condition.
 *
 * v1 resolved every rule against every variant instance and factored the result
 * into `base` plus a `by_variant` entry per variant. The argument was that a
 * consuming model should never have to evaluate a condition; the cost was that a
 * 36-variant component repeated its geometry and colour bindings 36 times, which
 * made `tokens` roughly 2,400 of a 2,700-line brief.
 *
 * `conditions` is already minimal: the minimizer in tokens.ts collapsed each rule
 * to the smallest set of axes it actually depends on. Emitting that is not asking
 * the reader to evaluate a boolean expression, because it is not one: it is a map
 * from axis name to the values the binding holds for. An absent `when` means
 * every variant.
 */
function tokensOf(spec: IntermediateSpec, foundation: FoundationSpec | undefined): YamlValue {
  const seen = new Set<string>();
  const rules: TokenRule[] = [];
  for (const t of spec.tokens) {
    const key = ruleKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(t);
  }

  // First-use order, so reading top to bottom introduces a token before the
  // bindings that reference it.
  const used: Record<string, YamlValue> = {};
  for (const r of rules) {
    if (r.token in used) continue;
    used[r.token] = lookupToken(foundation, r.token) as YamlValue;
  }

  return {
    used,
    bindings: rules.map((r) => ({
      path: r.path,
      property: r.property,
      token: r.token,
      when: Object.keys(r.conditions).length > 0 ? r.conditions : undefined,
    })),
  };
}
```

Import `TokenRule` as a type at the top of the file if it is not already imported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/brief.test.ts`

Expected: PASS. Existing tests asserting `base` or `by_variant` must be rewritten to the
new shape, not deleted: each was covering a real case, and the case still exists.

- [ ] **Step 5: Measure the invariant, not the line count**

Be aware of a trap here. The repo's `button.json` fixture has only **3 variants and 6
token rules**, so it renders in about 104 lines either way. The ~2,700-line payload that
motivates this task comes from a real 36-variant component in Figma, which no fixture
reproduces. Measuring lines on the fixture would therefore "prove" a win the measurement
cannot actually see.

Measure the property being fixed instead: **emitted bindings track distinct RULES, never
the variant matrix.**

```bash
npx tsx -e "const {readFileSync}=require('fs');const {extract,componentBrief}=require('./packages/extractor/src/index.ts');const n=JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json','utf8'));const s=extract(n,{figmaFile:'F'});const b=componentBrief(s,{generatedAt:'T'});console.log('variants',s.variantInstances.length,'rules',s.tokens.length,'bindings',b.tokens.bindings.length,'used',Object.keys(b.tokens.used).length);"
```

Expected: `bindings` is at most `rules`, and is nowhere near `variants * rules`. Record all
four numbers in the commit message. The real-world line reduction is confirmed by a human
in Task 20 against an actual Figma component; do not claim it from this fixture.

- [ ] **Step 6: Run the full suite and the type check**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS. `specContentHash` is untouched, because this changes the brief projection
and not `IntermediateSpec`.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts
git commit -m "feat(extractor)!: token definitions once, bindings by condition" -m "v1 resolved every rule against every variant and factored into base plus one by_variant entry per variant, which repeated every geometry and colour binding 36 times and made tokens roughly 2400 of a 2700-line brief." -m "conditions is already minimal, so emitting it is not asking a reader to evaluate a boolean expression: it is a map from axis to the values a binding holds for. Absent when means every variant." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Emit short scalar collections in flow style

Task 4 removed the 36-way duplication, but the payload is still far larger than the
design's 400-500 line target, and the reason is the emitter rather than the projection.

`yaml.ts` states its own limit at the top of the file: block style only, no flow maps.
So a binding's condition renders as

```yaml
      when:
        Style:
          - Filled
        State:
          - Enabled
```

five lines for two facts. On a real component with roughly 250 bindings averaging two
axes, `when` alone costs well over a thousand lines. The design's example shape,
`when: { type: [Primary], size: [Small] }`, is not currently expressible.

This task teaches the emitter flow style for short, scalar-only collections. It is a
change to how the same data is rendered; no projection changes.

**Files:**
- Modify: `packages/extractor/src/yaml.ts`
- Test: `packages/extractor/test/yaml.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no API change. `toYaml` keeps its signature; only its output narrows.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/yaml.test.ts`:

```ts
describe('flow style for short scalar collections', () => {
  it('renders a short all-scalar sequence inline', () => {
    expect(toYaml({ values: ['Primary', 'Outline', 'Ghost'] }))
      .toBe('values: [Primary, Outline, Ghost]\n');
  });

  it('renders a short all-scalar map inline', () => {
    expect(toYaml({ size: { value: 8, unit: 'px' } }))
      .toBe('size: { value: 8, unit: px }\n');
  });

  it('renders a map of short sequences inline at both levels', () => {
    expect(toYaml({ when: { type: ['Primary'], size: ['Large'] } }))
      .toBe('when: { type: [Primary], size: [Large] }\n');
  });

  it('stays block when any member is itself a collection that is not short', () => {
    const long = Array.from({ length: 12 }, (_, i) => `value-number-${i}`);
    const out = toYaml({ options: long });
    expect(out).toContain('\n  - value-number-0');
    expect(out).not.toContain('[value-number-0');
  });

  it('stays block when the rendered flow form would exceed the width budget', () => {
    const out = toYaml({ note: { a: 'x'.repeat(60), b: 'y'.repeat(60) } });
    expect(out).toContain('\n  a: ');
    expect(out).not.toContain('{ a: ');
  });

  it('stays block for a string that cannot be inline', () => {
    // A multi-line string is already handled by the block scalar path and must
    // not be dragged into a flow collection.
    const out = toYaml({ wrap: { text: 'line one\nline two' } });
    expect(out).not.toContain('{ text:');
  });

  it('quotes inside flow style exactly as it does in block style', () => {
    // A value needing quotes must still get them, and a comma or brace in a
    // scalar must not be able to break out of the flow collection.
    expect(toYaml({ a: ['yes', 'no'] })).toBe('a: ["yes", "no"]\n');
    expect(toYaml({ a: ['x, y'] })).toBe('a: ["x, y"]\n');
    expect(toYaml({ a: ['{ z }'] })).toBe('a: ["{ z }"]\n');
  });

  it('renders an empty collection as it did before', () => {
    expect(toYaml({ a: [], b: {} })).toBe('a: []\nb: {}\n');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/yaml.test.ts -t "flow style"`

Expected: FAIL. Everything currently renders in block style.

- [ ] **Step 3: Implement flow style**

In `packages/extractor/src/yaml.ts`, first correct the file header, which currently
claims block style only and would otherwise become a lie:

```
 * Emits YAML 1.2. Block style by default; short, scalar-only collections render
 * in flow style (see flowText) because the brief is read in a chat window and a
 * two-fact condition costing five lines is the difference between a payload that
 * pastes and one that does not.
```

Then add the flow renderer. Keep the existing `needsQuote` / `doubleQuote` /
`inlineScalar` helpers as the single source of quoting truth, so a scalar is escaped
identically in both styles:

```ts
/** Width budget for a flow collection, measured on the rendered text excluding
 *  indentation. Past this, block style is more readable than a long line, which is
 *  the only reason flow style is worth having. */
const FLOW_MAX = 72;

/**
 * A collection is flow-eligible when every member is an inline scalar, or is itself
 * a flow-eligible collection. Nesting is allowed because `when: { type: [Primary] }`
 * is exactly that shape and is the case this exists for.
 *
 * Depth is bounded: two levels is enough for every shape the brief emits, and an
 * unbounded rule would let a deeply nested object collapse into an unreadable line.
 */
function flowEligible(value: YamlValue, depth = 0): boolean {
  if (isInline(value)) return true;
  if (depth >= 2) return false;
  const members = Array.isArray(value) ? value : Object.values(value).filter((v) => v !== undefined);
  if (members.length === 0) return true;
  return members.every((m) => flowEligible(m as YamlValue, depth + 1));
}

/** Render a flow-eligible collection. Scalars go through inlineText, so quoting,
 *  escaping and special-value handling are shared with block style rather than
 *  reimplemented here. */
function flowText(value: YamlValue): string {
  if (isInline(value)) return inlineText(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => flowText(v)).join(', ')}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{ ${entries.map(([k, v]) => `${inlineScalar(k)}: ${flowText(v as YamlValue)}`).join(', ')} }`;
}

/** Flow style only when it is eligible AND the result actually fits. */
function asFlow(value: YamlValue): string | null {
  if (isInline(value)) return null;
  if (!flowEligible(value)) return null;
  const text = flowText(value);
  return text.length <= FLOW_MAX ? text : null;
}
```

Then, at each point where the existing emitter is about to descend into a nested
collection under a key or a sequence dash, try `asFlow` first and fall back to the
current block path when it returns null. Do not change the empty-collection handling
that already renders `[]` and `{}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/yaml.test.ts`

Expected: PASS, including every pre-existing test in the file. Several of those assert
block output for structures that are now flow-eligible; each such change is a real
output change, so read the failure, confirm the new form is correct YAML carrying the
same data, and update the expectation. If a pre-existing test asserts something that
flow style genuinely breaks, stop and report it.

- [ ] **Step 5: Prove the round trip still holds**

`yaml.test.ts` already round-trips output through `js-yaml`. That property is what
makes flow style safe: if `js-yaml` parses the flow output back to the same object,
the change is a rendering difference and nothing more. Confirm the existing
round-trip tests still pass, and add one for a nested flow map:

```ts
it('round-trips a nested flow map through js-yaml', () => {
  const value = { bindings: [{ path: 'Container', when: { type: ['Primary'] } }] };
  expect(load(toYaml(value))).toEqual(value);
});
```

- [ ] **Step 6: Measure the effect on a real payload shape**

```bash
npx tsx -e "const {readFileSync}=require('fs');const {extract,componentBrief,toYaml}=require('./packages/extractor/src/index.ts');const n=JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json','utf8'));const y=toYaml(componentBrief(extract(n,{figmaFile:'F'}),{generatedAt:'T'}));console.log(y.split('\n').length+' lines');console.log(y.slice(y.indexOf('bindings:'), y.indexOf('bindings:')+260));"
```

Record the before and after line counts in the commit message. The fixture is small
(3 variants, 6 rules), so expect a modest absolute drop; what matters is that each
`when` now occupies one line instead of five, which is what scales.

- [ ] **Step 7: Run the full suite and the type check**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS, with the tsc error count unchanged at 10. Note that the plugin's
foundation and component briefs both flow through this emitter, so plugin tests
asserting on emitted YAML may also need their expectations updated.

- [ ] **Step 8: Commit**

```bash
git add packages/extractor/src/yaml.ts packages/extractor/test/yaml.test.ts
git commit -m "feat(extractor): emit short scalar collections in flow style" -m "Task 4 removed the 36-way duplication, but block style still spent five lines on a two-fact condition, so a real component's bindings cost well over a thousand lines for when clauses alone and the 400-500 line target was unreachable." -m "Flow style applies only to collections whose members are all inline scalars or themselves flow-eligible, bounded to two levels and a 72-character budget, and scalars still go through the existing quoting helpers so escaping is identical in both styles. The js-yaml round-trip tests are what make this safe: the data is unchanged, only its rendering." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Split the API into variants, states and booleans
v1 emitted the same information three times, as `api`, `axes` and `states`, and its
`axes` block listed five boolean state props as independent axes, implying
3 x 2^5 = 384 combinations against 36 real variants.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (`api`, remove `axes` and `states`)
- Test: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `detectStateMatrix`, `stateAxisProps` from `statesMatrix.ts` (both already exported).
- Produces: `api` is `{ variants?, states?, booleans?, slots? }` where `variants` is `Record<string, { options, default? }>`, `states` is `string[]`, `booleans` is `Record<string, { default? }>`, and `slots` is `Record<string, { type: 'text' | 'instanceSwap', default?, options? }>`. Top-level `axes` and `states` are gone.

**`slots` is not optional polish.** `ComponentProp.kind` has five values, and v1's flat
`api` emitted all of them. A three-group split covering only variant and boolean kinds
silently DROPS every `text` and `instanceSwap` property — and both fixtures in this repo
have a `text:Label` prop, so the loss is immediate and real, not hypothetical. A text
property is the component's label slot and an instanceSwap property is its icon slot;
those are the two things an implementer most needs to know a component exposes. Any prop
whose kind is neither variant nor boolean belongs here, so a future sixth kind surfaces
rather than disappearing.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps a real Default value under the enum encoding', () => {
  // An enum state axis declaring Default has that state for real, unlike the flags
  // path where detectStateMatrix invents the baseline column.
  const spec = { ...baseSpec(),
    variants: [{ prop: 'States', values: ['Default', 'Hovered', 'Pressed'] }],
    props: [{ name: 'States', kind: 'variant' as const,
              options: ['Default', 'Hovered', 'Pressed'], default: 'Default' }] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(brief.api.states).toEqual(['Default', 'Hovered', 'Pressed']);
});

it('separates configurable variants from interaction states', () => {
  const spec = {
    ...baseSpec(),
    variants: [
      { prop: 'type', values: ['Primary', 'Outline', 'Ghost'] },
      { prop: 'size', values: ['Large', 'Small'] },
      { prop: 'hover', values: ['False', 'True'] },
      { prop: 'disabled', values: ['False', 'True'] },
    ],
    props: [
      { name: 'type', kind: 'variant' as const,
        options: ['Primary', 'Outline', 'Ghost'], default: 'Primary' },
      { name: 'size', kind: 'variant' as const, options: ['Large', 'Small'], default: 'Large' },
      { name: 'hover', kind: 'variant' as const, options: ['False', 'True'], default: 'False' },
      { name: 'disabled', kind: 'variant' as const, options: ['False', 'True'], default: 'False' },
      { name: 'iconLeft', kind: 'boolean' as const, default: true },
    ],
  };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(Object.keys(brief.api.variants)).toEqual(['type', 'size']);
  expect(brief.api.variants.type).toEqual(
    { options: ['Primary', 'Outline', 'Ghost'], default: 'Primary' });
  expect(brief.api.states).toContain('hover');
  expect(brief.api.states).toContain('disabled');
  expect(brief.api.states).not.toContain('Default');
  expect(brief.api.booleans).toEqual({ iconLeft: { default: true } });
});

it('no longer emits a top-level axes or states block', () => {
  const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as Record<string, any>;
  expect('axes' in brief).toBe(false);
  expect('states' in brief).toBe(false);
});

it('omits states when the component has none', () => {
  const spec = { ...baseSpec(), variants: [{ prop: 'size', values: ['Large', 'Small'] }],
    props: [{ name: 'size', kind: 'variant' as const,
              options: ['Large', 'Small'], default: 'Large' }] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect('states' in brief.api).toBe(false);
  expect(Object.keys(brief.api.variants)).toEqual(['size']);
});

it('omits the whole api block for a component with no props', () => {
  const spec = { ...baseSpec(), variants: [], props: [] };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect('api' in brief).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t api`

Expected: FAIL. `api` is still a flat array and `axes` is still emitted.

- [ ] **Step 3: Write the implementation**

In `packages/extractor/src/brief.ts`, add the import and replace the `api`, `axes` and
`states` properties with one `api` block:

```ts
import { detectStateMatrix, stateAxisProps } from './statesMatrix';
```

```ts
/**
 * The component's API, with configurable variants separated from interaction
 * states.
 *
 * v1 emitted this three times over: `api` as a flat prop list, `axes` as the same
 * props again, and `states` as a third view. Worse, `axes` listed each boolean
 * state prop as an independent axis, so a Button with three types, two sizes and
 * five state flags advertised 3 x 2^5 = 384 combinations against 36 real variants.
 *
 * The split is not a judgement call: `stateAxisProps` already computes exactly
 * which variant props the States matrix consumes, and the canvas frames have
 * relied on it for both the Variants and the States sections.
 */
function apiOf(spec: IntermediateSpec): YamlValue | undefined {
  const stateProps = stateAxisProps(spec.variants);
  const matrix = detectStateMatrix(spec.variants);

  const variants: Record<string, YamlValue> = {};
  for (const axis of spec.variants) {
    if (stateProps.has(axis.prop)) continue;
    const declared = spec.props.find((p) => p.name === axis.prop);
    variants[axis.prop] = { options: axis.values, default: declared?.default };
  }

  const booleans: Record<string, YamlValue> = {};
  for (const p of spec.props) {
    if (p.kind !== 'boolean' || stateProps.has(p.name)) continue;
    booleans[p.name] = { default: p.default };
  }

  // Dropping 'Default' is correct for the FLAGS encoding only, where the baseline
  // column is synthetic: detectStateMatrix invents it so the matrix has something to
  // compare the flags against, and the component has no such state.
  //
  // Under the ENUM encoding, 'Default' can be a real declared value of a real axis
  // (chip.json has exactly that). Dropping it there loses a value the component
  // genuinely has, and worse, a token binding may condition on `States: [Default]`,
  // which would leave `bindings` referencing a state `api.states` says does not
  // exist. Same class of silent loss as the allow-list that dropped every text prop.
  const columns = matrix?.columns ?? [];
  const states = matrix?.encoding === 'flags'
    ? columns.map((c) => c.label).filter((label) => label.toLowerCase() !== 'default')
    : columns.map((c) => c.label);

  const result = {
    variants: Object.keys(variants).length > 0 ? variants : undefined,
    states: states.length > 0 ? states : undefined,
    booleans: Object.keys(booleans).length > 0 ? booleans : undefined,
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}
```

Then in `componentBrief`, replace the three properties with `api: apiOf(spec),` and delete
the `axes:` and `states:` properties entirely.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/brief.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS. `IntermediateSpec.states` and `.variants` stay as they are: the canvas
frames read them, and this task changes only the brief projection.

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts
git commit -m "feat(extractor)!: split the brief API into variants, states and booleans" -m "v1 emitted the same props three times as api, axes and states, and listed five boolean state props as independent axes, advertising 384 combinations against 36 real variants." -m "The split reuses stateAxisProps, which the canvas frames already rely on, so it is not a new judgement call." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Carry the generated group descriptions in the foundation brief
This fixes step 1 of the intended workflow. The foundation frame renders AI-written
per-group descriptions, persisted on the doc link as
`FoundationDocLink.groupDescriptions`, but `foundationBrief` emits only `collections`
and `text_styles`. Copying the foundation to establish a vocabulary currently hands
over a bare token table with none of the meaning the plugin already generated.

Small and independent of the format work, which is why it sits here rather than at
the end.

**Files:**
- Modify: `packages/extractor/src/brief.ts:66-95` (`foundationBrief`)
- Modify: `packages/plugin/src/ui/actions.ts:671-692` (`copyFoundationBrief`)
- Test: `packages/extractor/test/brief.test.ts`, `packages/plugin/test/actions.test.ts`

**Interfaces:**
- Consumes: `FoundationDocLink.groupDescriptions` (existing).
- Produces: `foundationBrief(f: FoundationSpec, opts: FoundationBriefOptions): YamlValue` where
  `FoundationBriefOptions` is `{ generatedAt: string; groupDescriptions?: Record<string, Record<string, string>> }`.
  Task 19 adds a `contrast` field to the same options object.

- [ ] **Step 1: Write the failing tests**

Add a fixture helper beside the existing foundation brief tests, returning a
`FoundationSpec` with one single-mode collection holding one COLOR variable:

```ts
function oneCollection(): FoundationSpec {
  return {
    fileKey: 'FILE1', extractedAt: 'T', textStyles: [],
    collections: [{
      id: 'c1', name: 'Primitives', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Value' }],
      variables: [{
        name: 'color/surface/default', group: 'color', resolvedType: 'COLOR',
        description: '', codeSyntax: {},
        valuesByMode: { m1: { kind: 'color', hex: '#ffffff', alpha: 1 } },
      }],
    }],
  };
}
```

```ts
it('carries group descriptions nested under their collection', () => {
  const brief = foundationBrief(oneCollection(), {
    generatedAt: 'T',
    groupDescriptions: { Primitives: { 'color/surface': 'Surfaces you paint panels with.' } },
  }) as Record<string, any>;
  expect(brief.guidelines.origin).toBe('generated');
  expect(brief.guidelines.group_descriptions).toEqual({
    Primitives: { 'color/surface': 'Surfaces you paint panels with.' },
  });
});

it('nests by collection so two collections can share a folder name', () => {
  const brief = foundationBrief(oneCollection(), {
    generatedAt: 'T',
    groupDescriptions: { A: { color: 'From A.' }, B: { color: 'From B.' } },
  }) as Record<string, any>;
  expect(brief.guidelines.group_descriptions.A.color).toBe('From A.');
  expect(brief.guidelines.group_descriptions.B.color).toBe('From B.');
});

it('omits the guidelines block entirely when there are no descriptions', () => {
  const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as Record<string, any>;
  expect('guidelines' in brief).toBe(false);
});

it('omits the block when a description map is present but empty', () => {
  const brief = foundationBrief(oneCollection(), {
    generatedAt: 'T', groupDescriptions: { Primitives: {} },
  }) as Record<string, any>;
  expect('guidelines' in brief).toBe(false);
});

it('still emits collections and text styles unchanged', () => {
  const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as Record<string, any>;
  expect(brief.collections[0].name).toBe('Primitives');
  expect(brief.collections[0].tokens[0].name).toBe('color/surface/default');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t foundationBrief`

Expected: FAIL, `foundationBrief` takes a string as its second argument.

- [ ] **Step 3: Change the signature and add the block**

Keep the existing `collections` and `text_styles` mapping expressions exactly as they
are; copy them across verbatim. Only the signature and the new block change. The two
angle-bracket markers below are instructions to copy code, NOT literals to type.

```ts
export interface FoundationBriefOptions {
  generatedAt: string;
  /**
   * AI-written group descriptions, read from the foundation doc links on canvas
   * and keyed collection name, then folder path. Nested rather than flat because
   * two collections can each hold a folder of the same name, which a flat map
   * would silently collapse into one entry.
   *
   * Partial by nature: copyFoundationBrief deliberately covers the whole file
   * while a foundation doc may cover one scope, and a file may have no foundation
   * doc at all. Never generated here, only passed through from storage.
   */
  groupDescriptions?: Record<string, Record<string, string>>;
}

export function foundationBrief(
  foundation: FoundationSpec,
  opts: FoundationBriefOptions,
): YamlValue {
  // A collection whose map is present but empty contributes nothing, and letting
  // it through would emit a guidelines block containing an empty object.
  const descriptions = Object.fromEntries(
    Object.entries(opts.groupDescriptions ?? {})
      .filter(([, folders]) => Object.keys(folders).length > 0),
  );
  return {
    spec_layer: envelope('foundation', opts.generatedAt),
    source: { file_key: foundation.fileKey || undefined },
    // KEEP THE TWO EXISTING EXPRESSIONS EXACTLY AS THEY ARE. Do not retype them
    // and do not substitute a placeholder: `collections` maps every collection
    // through tokenOf() with its stale-mode guard, and `text_styles` maps every
    // text style. Copy both from the current implementation verbatim. This task
    // changes the signature and adds `guidelines`, nothing else.
    collections: <the existing collections expression, copied verbatim>,
    text_styles: <the existing text_styles expression, copied verbatim>,
    guidelines: Object.keys(descriptions).length > 0
      ? { origin: 'generated', group_descriptions: descriptions }
      : undefined,
  };
}
```

- [ ] **Step 4: Gather the descriptions at the copy site**

In `copyFoundationBrief`, collect the stored descriptions from the foundation doc links
on canvas before building the YAML. Find how links are enumerated:

```bash
grep -rn "parseDocLink\|isFoundationLink" packages/plugin/src/ui/actions.ts packages/plugin/src/main.ts | head
```

Merge each foundation link's `groupDescriptions` under its scope's `collectionName`. A
`textStyles`-target scope has no collection name, so skip it. Then:

```ts
    const yaml = toYaml(foundationBrief(spec, {
      generatedAt: new Date().toISOString(),
      groupDescriptions,
    }));
```

Add a test to `packages/plugin/test/actions.test.ts` asserting the copied YAML contains
`group_descriptions` when a foundation doc with descriptions exists on canvas, and omits
it when none do.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/brief.test.ts packages/plugin/test/actions.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the full suite and the type check**

Run: `npm test && npm run check:sandbox && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor packages/plugin/src/ui/actions.ts packages/plugin/test
git commit -m "feat(extractor,plugin): carry generated group descriptions in the foundation brief" -m "The foundation frame renders AI-written group descriptions, but foundationBrief emitted only collections and text_styles. Copying the foundation to establish a vocabulary handed over a bare token table with none of the meaning the plugin had already generated." -m "Read from the stored doc links, never regenerated, and nested under their collection because two collections can share a folder name." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Stop `unbound` contradicting `tokens`
**Files:**
- Modify: `packages/extractor/src/tokens.ts:20` (`Gap`), `:523-560` (`extractGaps`)
- Modify: `packages/extractor/src/brief.ts` (the `unbound` mapping in `componentBrief`)
- Modify: `packages/extractor/src/hash.ts` (the `gaps` projection)
- Test: `packages/extractor/test/tokens.test.ts`, `packages/extractor/test/brief.test.ts`, `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Consumes: `Gap.path` and `TokenRule.path` (Task 3).
- Produces: `Gap` becomes `{ part: string; path: string; property: string; issue: GapIssue; value?: number | string }` with `export type GapIssue = 'hardcoded-value' | 'hardcoded-color' | 'missing-token-binding'`. Brief `unbound` entries are `{ path, property, issue, value? }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/brief.test.ts`:

```ts
it('drops an unbound entry whose path and property are already bound', () => {
  const spec = {
    ...baseSpec(),
    tokens: [{ part: 'Label', path: 'Container/Label', property: 'fill',
               conditions: {}, token: 'color/text/default' }],
    gaps: [
      { part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color' as const },
      { part: 'Label', path: 'Container/Label', property: 'itemSpacing',
        issue: 'hardcoded-value' as const, value: 8 },
    ],
  };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  // The fill gap contradicted a real binding, so it goes. The spacing gap stays.
  expect(brief.unbound).toEqual([
    { path: 'Container/Label', property: 'itemSpacing', issue: 'hardcoded-value', value: 8 },
  ]);
});

it('omits unbound entirely when every gap was contradicted', () => {
  const spec = {
    ...baseSpec(),
    tokens: [{ part: 'Label', path: 'Container/Label', property: 'fill',
               conditions: {}, token: 'color/text/default' }],
    gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill',
             issue: 'hardcoded-color' as const }],
  };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect('unbound' in brief).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t unbound`

Expected: FAIL. `Gap` has no `property`, and both entries are emitted.

- [ ] **Step 3: Record a property and a stable issue id on every gap**

In `packages/extractor/src/tokens.ts`:

```ts
/** Stable ids, not prose. A free-form sentence cannot drive UI, a test, or a
 *  comparison against a binding, and the measured number belongs in its own
 *  field rather than embedded in text. */
export type GapIssue = 'hardcoded-value' | 'hardcoded-color' | 'missing-token-binding';

export interface Gap {
  part: string;
  path: string;
  property: string;
  issue: GapIssue;
  /** The hardcoded value itself, where there is one to report. */
  value?: number | string;
}
```

Rewrite `pushGap`. Note the separator is a SPACE, not a NUL byte: a NUL in source has bitten this repo repeatedly and evades lint, tests and `git diff`.

```ts
  const pushGap = (part: string, path: string, property: string,
                   issue: GapIssue, value?: number | string) => {
    const key = `${path} ${property} ${issue}`;
    if (seenGaps.has(key)) return;
    seenGaps.add(key);
    out.push({ part, path, property, issue, ...(value !== undefined ? { value } : {}) });
  };
```

Map each existing call to a property and an id:

| existing issue text | property | issue | value |
|---|---|---|---|
| `hardcoded itemSpacing (Npx)` | `itemSpacing` | `hardcoded-value` | the number |
| `hardcoded color (no variable or style)` | `fill` | `hardcoded-color` | the hex |
| `hardcoded padding (...)` | `padding` | `hardcoded-value` | the number |
| `hardcoded corner radius (...)` | `border-radius` | `hardcoded-value` | the number |

Then confirm no prose issue strings survive:

```bash
grep -n "pushGap(" packages/extractor/src/tokens.ts
```

- [ ] **Step 4: Reconcile in the brief**

In `brief.ts`, replace the `unbound` mapping:

```ts
    // A gap and a binding can name the same path and property: gap detection
    // walks hidden subtrees that token extraction prunes, and a part can be
    // hardcoded in one variant while bound in another. Emitting both makes the
    // brief contradict itself, which is exactly what v1 did when `unbound`
    // reported ButtonLabel as having a hardcoded colour while `tokens` showed
    // the token bound on the same node. A binding is the stronger evidence, so
    // it wins.
    unbound: (() => {
      const bound = new Set(spec.tokens.map((t) => `${t.path} ${t.property}`));
      const rows = spec.gaps
        .filter((g) => !bound.has(`${g.path} ${g.property}`))
        .map((g) => ({
          path: g.path, property: g.property, issue: g.issue,
          ...(g.value !== undefined ? { value: g.value } : {}),
        }));
      return rows.length > 0 ? rows : undefined;
    })(),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/brief.test.ts packages/extractor/test/tokens.test.ts`

Expected: PASS.

- [ ] **Step 6: Re-cut the hash baseline deliberately**

Gap issue strings changed from prose to ids, and `issue` survives the `gaps` projection, so the hash legitimately moves. This is the one task permitted to change it.

Run: `npx vitest run packages/extractor/test/specHash.test.ts`

Expected: FAIL on `BUTTON_HASH_V1`. Print the new value:

```bash
npx tsx -e "const {readFileSync}=require('fs');const {extract,specContentHash}=require('./packages/extractor/src/index.ts');const n=JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json','utf8'));console.log(specContentHash(extract(n,{figmaFile:'FILE1'})));"
```

Rename the constant and record why:

```ts
/** Re-cut on 2026-08-18 by Task 7: gap issue strings became stable ids, which
 *  is a real content change, so every existing component doc legitimately shows
 *  "update available" once. It must settle after a single Update. */
const BUTTON_HASH_V2 = 'PASTE_THE_NEW_VALUE';
```

Update both hash assertions to `BUTTON_HASH_V2`.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/extractor/src packages/extractor/test
git commit -m "fix(extractor): stop unbound contradicting tokens" -m "Gaps now carry the property they are about, so a gap naming a path and property that tokens already bind is dropped. v1 reported ButtonLabel as having a hardcoded colour while tokens showed the token bound on the same node." -m "Gap issue strings become stable ids and the measured number moves to its own field. That is a real content change, so the spec hash baseline is deliberately re-cut: existing docs show update-available once." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 9: State which mode a resolved value came from
Task 4 already put `resolved` inside `tokens.used`, one entry per token. This adds the
mode that value was read at.

A full per-mode map is the eventual destination, but it needs mode pairing across
collections to be meaningful for anything but a single collection, which is unsolved.
Naming the single mode is the honest intermediate: it makes the radius contradiction
legible without claiming coverage that does not exist.

**Files:**
- Modify: `packages/extractor/src/brief.ts:215-247` (`lookupToken`, `bindingOf`)
- Test: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `lookupToken` returns `{ value?: YamlValue; code?: YamlValue; mode?: string }`, and `bindingOf` spreads all three.

- [ ] **Step 1: Write the failing test**

```ts
it('names the mode a resolved value was read at', () => {
  const foundation: FoundationSpec = {
    fileKey: 'F', extractedAt: 'T', textStyles: [],
    collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 'm2',
      modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
      variables: [{
        name: 'color/surface/default', group: '', resolvedType: 'COLOR',
        description: '', codeSyntax: {},
        valuesByMode: {
          m1: { kind: 'color', hex: '#ffffff', alpha: 1 },
          m2: { kind: 'color', hex: '#111111', alpha: 1 },
        },
      }],
    }],
  };
  const spec = { ...baseSpec(), tokens: [{ part: 'Container', path: 'Container',
    property: 'fill', conditions: {}, token: 'color/surface/default' }] };
  const brief = componentBrief(spec, { generatedAt: 'T', foundation }) as Record<string, any>;
  const binding = brief.tokens.base[0];
  // The collection's own default mode is m2, so the value is the Dark one, and
  // the brief says so instead of leaving a reader to assume Light.
  expect(binding.value).toBe('#111111');
  expect(binding.mode).toBe('Dark');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t "names the mode"`

Expected: FAIL, `binding.mode` is undefined.

- [ ] **Step 3: Write the implementation**

```ts
function lookupToken(
  foundation: FoundationSpec | undefined,
  token: string,
): { value?: YamlValue; code?: YamlValue; mode?: string } {
  if (!foundation) return {};
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      if (variable.name !== token) continue;
      const raw = variable.valuesByMode[collection.defaultModeId];
      const code = Object.keys(variable.codeSyntax).length > 0 ? variable.codeSyntax : undefined;
      // Which mode this value belongs to is not decoration. `layout` reports the
      // geometry the frame renders, under whatever mode is applied on canvas,
      // while this reads the owning collection's DEFAULT mode. On a themed file
      // those differ, and v1 emitted both numbers with nothing saying they were
      // read under different conditions: the sample Button claimed radius 4 in
      // `layout` and rd-sm resolving to 8 in `tokens`, at the same time.
      const mode = collection.modes.find((m) => m.modeId === collection.defaultModeId)?.name;
      return { value: raw ? valueOf(raw) : undefined, code: code as YamlValue, mode };
    }
  }
  return {};
}
```

`bindingOf` already spreads the result, so it needs no change. Confirm:

```bash
grep -n "lookupToken(foundation" packages/extractor/src/brief.ts
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/brief.test.ts`

Expected: PASS. Existing brief tests asserting exact binding objects need `mode` added to their expected values.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS. The hash is untouched: `lookupToken` runs in the brief projection, not in `IntermediateSpec`.

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts
git commit -m "feat(extractor): name the mode a resolved value was read at" -m "layout reports what the frame renders; token values are read at the owning collection default mode. On a themed file those differ, and v1 emitted both numbers with nothing saying they were read under different conditions, which is how the sample Button claimed radius 4 and rd-sm equal to 8 at once." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 10: Resolve typography structurally
v1 emitted typography as a display string, `"Button/L : 14px Medium"`, with no
`value` and no `code`. Nothing downstream could act on it, including `requiredRatio`,
which needs a size and a weight to pick a WCAG threshold.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (add a `typography` block)
- Test: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `FoundationSpec.textStyles` (`FoundationTextStyle extends RawTextStyle`, so each carries `name`, `fontFamily`, `fontStyle`, `fontSize`, `lineHeight`, `letterSpacing`); `TokenRule` entries whose `property` is `typography`.
- Produces: a top-level `typography` block keyed by the style name.

- [ ] **Step 1: Write the failing tests**

```ts
it('resolves a bound text style to real metrics', () => {
  const foundation: FoundationSpec = {
    fileKey: 'F', extractedAt: 'T', collections: [],
    textStyles: [{
      name: 'Button/L : 14px Medium', group: 'Button', description: '',
      fontFamily: 'Inter', fontStyle: 'Medium', fontSize: 14,
      lineHeight: { unit: 'PIXELS', value: 20 },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL',
      textDecoration: 'NONE',
    }],
  };
  const spec = { ...baseSpec(), tokens: [{
    part: 'Label', path: 'Container/Label', property: 'typography',
    conditions: { size: ['Large'] }, token: 'Button/L : 14px Medium' }] };
  const brief = componentBrief(spec, { generatedAt: 'T', foundation }) as Record<string, any>;
  expect(brief.typography['Button/L : 14px Medium']).toEqual({
    source_name: 'Button/L : 14px Medium',
    font_family: 'Inter', font_style: 'Medium', font_size: 14,
    line_height: { unit: 'PIXELS', value: 20 },
    letter_spacing: { unit: 'PIXELS', value: 0 },
  });
});

it('omits the block when no style is bound', () => {
  const brief = componentBrief(baseSpec(), { generatedAt: 'T' }) as Record<string, any>;
  expect('typography' in brief).toBe(false);
});

it('records a bound style the foundation cannot resolve rather than dropping it', () => {
  const spec = { ...baseSpec(), tokens: [{
    part: 'Label', path: 'Container/Label', property: 'typography',
    conditions: {}, token: 'Missing/Style' }] };
  const foundation: FoundationSpec =
    { fileKey: 'F', extractedAt: 'T', collections: [], textStyles: [] };
  const brief = componentBrief(spec, { generatedAt: 'T', foundation }) as Record<string, any>;
  // A style bound in the file but absent from this dump is unresolved, not absent.
  // Dropping it would make the brief claim the label has no typography at all.
  expect(brief.typography['Missing/Style']).toEqual({ unresolved: 'not in this file' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t typography`

Expected: FAIL, there is no `typography` block.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Every text style this component binds, resolved to the metrics an implementation
 * needs.
 *
 * v1 emitted only the display string, which made typography the one binding shape
 * that carried no value and no code: a consumer could not generate CSS from
 * "Button/L : 14px Medium", and requiredRatio could not pick a WCAG threshold
 * without a size and a weight.
 *
 * `source_name` keeps the raw Figma style name, stray double spaces included,
 * because that string is what a designer searches for in the file.
 */
function typographyOf(
  spec: IntermediateSpec,
  foundation: FoundationSpec | undefined,
): YamlValue | undefined {
  const names = new Set(
    spec.tokens.filter((t) => t.property === 'typography').map((t) => t.token));
  if (names.size === 0) return undefined;

  const out: Record<string, YamlValue> = {};
  for (const name of names) {
    const style = foundation?.textStyles.find((s) => s.name === name);
    if (!style) {
      // Bound in the file but absent from this dump: a published library style, or
      // a foundation read that did not cover it. Unresolved, never absent.
      out[name] = { unresolved: 'not in this file' };
      continue;
    }
    out[name] = {
      source_name: style.name,
      font_family: style.fontFamily,
      font_style: style.fontStyle,
      font_size: style.fontSize,
      line_height: { unit: style.lineHeight.unit, value: style.lineHeight.value },
      letter_spacing: { unit: style.letterSpacing.unit, value: style.letterSpacing.value },
    };
  }
  return out;
}
```

Add `typography: typographyOf(spec, opts.foundation),` to `componentBrief`'s return.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/brief.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

```bash
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts
git commit -m "feat(extractor): resolve typography structurally" -m "v1 emitted only a display string, which made typography the one binding shape carrying no value and no code: nothing could generate CSS from Button/L : 14px Medium, and requiredRatio could not pick a threshold without a size and a weight." -m "A style bound in the file but missing from this dump is recorded as unresolved rather than dropped, so the brief never claims a label has no typography." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Emit deterministic validation findings
The sample Button's most important fact is that its Primary/Large default variant
binds `color/surface/primary/disabled`. In v1 that sits in row 1 of 36, indistinguishable
from every other binding. This block names it.

Every finding is computed. Nothing here is inferred, and there is no aggregate score:
an undefined number that tells an agent it may skip human review is worse than no
number.

**Files:**
- Create: `packages/extractor/src/validate.ts`
- Modify: `packages/extractor/src/layout.ts` (carry the numbers, not only the sentence)
- Modify: `packages/extractor/src/hash.ts` (project `layout` so the new field cannot move the hash)
- Modify: `packages/extractor/src/statesMatrix.ts` (export `isStateLike`)
- Modify: `packages/extractor/src/brief.ts` (add the block), `packages/extractor/src/index.ts`
- Test: `packages/extractor/test/validate.test.ts`, `packages/extractor/test/layout.test.ts`, `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Consumes: `TokenRule.path`, `Gap.property` and `GapIssue` (Task 8), `lookupToken`'s `mode` (Task 9), `spec.layout`.
- Produces:

```ts
export type FindingId =
  | 'default-state-uses-state-token' | 'geometry-token-mismatch'
  | 'duplicate-conflicting-binding' | 'ambiguous-state-axis' | 'unbound-value';
export interface Finding {
  id: FindingId; severity: 'warning' | 'error';
  path?: string; property?: string; message: string;
  when?: Record<string, string[]>;
}
export function validate(spec: IntermediateSpec, resolved: Map<string, number>): Finding[]
```

- [ ] **Step 1: Write the failing tests**

Create `packages/extractor/test/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validate } from '../src/validate';

const base = () => ({
  name: 'Button', figmaKey: '', figmaFile: 'F', figmaNode: '1:1',
  anatomy: [], anatomyComponentId: '1:1', props: [], variants: [],
  variantInstances: [], states: [], tokens: [], related: [], gaps: [],
  layout: [], rawValues: [],
});

describe('validate', () => {
  it('flags a default variant bound to a token naming another state', () => {
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { type: ['Primary'], size: ['Large'] },
      token: 'color/surface/primary/disabled' }] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toContain('default-state-uses-state-token');
    expect(f[0].message).toContain('disabled');
  });

  it('does not flag a binding whose own condition names that state', () => {
    const spec = { ...base(), tokens: [{
      part: 'Container', path: 'Container', property: 'fill',
      conditions: { disabled: ['True'] },
      token: 'color/surface/primary/disabled' }] };
    expect(validate(spec as never, new Map())).toEqual([]);
  });

  it('flags a rendered geometry value disagreeing with its bound token', () => {
    const spec = { ...base(),
      tokens: [{ part: 'Container', path: 'Container', property: 'border-radius',
                 conditions: {}, token: 'rd-sm' }],
      layout: [{ part: 'Container', summary: 'horizontal, radius 4',
                 values: { radius: 4 } }] };
    const f = validate(spec as never, new Map([['rd-sm', 8]]));
    const hit = f.find((x) => x.id === 'geometry-token-mismatch')!;
    expect(hit.message).toContain('4');
    expect(hit.message).toContain('8');
  });

  it('flags one path and property bound to two tokens under the same condition', () => {
    const spec = { ...base(), tokens: [
      { part: 'vector', path: 'Container/vector', property: 'border-color',
        conditions: { loading: ['True'] }, token: 'color/icon/primary/primary' },
      { part: 'vector', path: 'Container/vector', property: 'border-color',
        conditions: { loading: ['True'] }, token: 'color/stroke/primary/default' },
    ] };
    const f = validate(spec as never, new Map());
    expect(f.map((x) => x.id)).toContain('duplicate-conflicting-binding');
  });

  it('flags more than one state-like axis instead of silently taking the first', () => {
    const spec = { ...base(), variants: [
      { prop: 'state', values: ['Default', 'Hover'] },
      { prop: 'tone', values: ['Success', 'Warning', 'Error'] },
    ] };
    const f = validate(spec as never, new Map());
    const hit = f.find((x) => x.id === 'ambiguous-state-axis')!;
    expect(hit.message).toContain('state');
    expect(hit.message).toContain('tone');
  });

  it('mirrors each unbound gap', () => {
    const spec = { ...base(), gaps: [{ part: 'Label', path: 'Container/Label',
      property: 'itemSpacing', issue: 'hardcoded-value' as const, value: 8 }] };
    const f = validate(spec as never, new Map());
    const hit = f.find((x) => x.id === 'unbound-value')!;
    expect(hit.path).toBe('Container/Label');
    expect(hit.property).toBe('itemSpacing');
  });

  it('returns an empty array for a clean component', () => {
    expect(validate(base() as never, new Map())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/validate.test.ts`

Expected: FAIL, cannot resolve `../src/validate`.

- [ ] **Step 3: Carry the layout numbers alongside the sentence**

`fmt()` in `packages/extractor/src/layout.ts` already has every number in hand and
throws them away into a string. Keep the string, which frames render, and also return
the numbers:

```ts
export interface LayoutValues { radius?: number; gap?: number }
export interface LayoutSummary { part: string; summary: string; values: LayoutValues }
```

In `extractLayout`, build both from the same `LayoutInfo`, so the sentence and the
numbers cannot disagree:

```ts
function valuesOf(l: LayoutInfo): LayoutValues {
  return {
    ...(l.cornerRadius !== undefined ? { radius: l.cornerRadius } : {}),
    ...(l.itemSpacing !== undefined ? { gap: l.itemSpacing } : {}),
  };
}
```

```ts
      const summary = fmt(n.layout);
      if (summary) out.push({ part: n.name, summary, values: valuesOf(n.layout) });
```

Add to `packages/extractor/test/layout.test.ts`:

```ts
it('carries the numbers it renders into the sentence', () => {
  const out = extractLayout(nodeWithLayout({ mode: 'HORIZONTAL', itemSpacing: 8, cornerRadius: 4 }));
  expect(out[0].summary).toContain('radius 4');
  expect(out[0].values).toEqual({ radius: 4, gap: 8 });
});

it('omits a value the node does not declare', () => {
  const out = extractLayout(nodeWithLayout({ mode: 'HORIZONTAL', itemSpacing: 8 }));
  expect(out[0].values).toEqual({ gap: 8 });
});
```

Use whatever node-building helper `layout.test.ts` already has rather than adding a
second one.

- [ ] **Step 4: Keep the new field out of the hash**

`spec.layout` is hashed, so adding `values` would flip every committed doc's baseline
for data already hashed under `summary`. Project it, exactly as `anatomy`, `tokens` and
`gaps` already are:

```ts
    layout: spec.layout.map(({ part, summary }) => ({ part, summary })),
```

Then confirm nothing moved:

Run: `npx vitest run packages/extractor/test/specHash.test.ts`

Expected: PASS, still equal to `BUTTON_HASH_V2`.

- [ ] **Step 5: Export `isStateLike`**

In `packages/extractor/src/statesMatrix.ts`, add `export` to the existing `isStateLike`
function. `detectStateMatrix` uses `variants.find(isStateLike)`, which silently takes the
first match when several axes qualify; exporting it lets the finding be exact rather than a
reimplemented approximation that could disagree with the matrix the frames render.

- [ ] **Step 6: Write the implementation**

Create `packages/extractor/src/validate.ts`:

```ts
/**
 * Deterministic findings about one component.
 *
 * Every entry here is COMPUTED from extracted data. Nothing is inferred, and there
 * is deliberately no aggregate score: a number with no defined arithmetic that
 * tells an agent it may generate without human review is worse than no number.
 *
 * There is also no `info` severity. A finding nobody should act on should not be
 * emitted at all.
 */
import type { IntermediateSpec } from './extract';
import type { LayoutSummary } from './layout';
import { isStateLike } from './statesMatrix';

export type FindingId =
  | 'default-state-uses-state-token'
  | 'geometry-token-mismatch'
  | 'duplicate-conflicting-binding'
  | 'ambiguous-state-axis'
  | 'unbound-value';

export interface Finding {
  id: FindingId;
  severity: 'warning' | 'error';
  path?: string;
  property?: string;
  message: string;
  when?: Record<string, string[]>;
}

/** State words that appearing in a TOKEN name implies a state-specific value. */
const STATE_WORDS = ['disabled', 'hover', 'focus', 'press', 'pressed', 'loading', 'selected'];

/**
 * The geometry a layout entry states, as property name plus number.
 *
 * Reads `values`, the structured numbers extractLayout now carries. An earlier
 * draft regex-parsed `summary` ("horizontal, radius 4") instead, which is the same
 * mistake v1 made with typography: round-tripping a number through a display
 * string, so the parse breaks silently the day the sentence is reworded.
 */
function geometryOf(l: LayoutSummary): { property: string; value: number }[] {
  const out: { property: string; value: number }[] = [];
  if (l.values.radius !== undefined) out.push({ property: 'border-radius', value: l.values.radius });
  if (l.values.gap !== undefined) out.push({ property: 'gap', value: l.values.gap });
  return out;
}

export function validate(
  spec: IntermediateSpec,
  /** token name -> resolved numeric value, at the mode the brief reports. */
  resolved: Map<string, number>,
): Finding[] {
  const findings: Finding[] = [];

  // 1. A binding whose token names a state that its own condition does not.
  for (const t of spec.tokens) {
    const word = STATE_WORDS.find((w) => t.token.toLowerCase().includes(w));
    if (!word) continue;
    const conditionText = Object.entries(t.conditions)
      .map(([axis, values]) => `${axis} ${values.join(' ')}`).join(' ').toLowerCase();
    if (conditionText.includes(word)) continue;
    findings.push({
      id: 'default-state-uses-state-token', severity: 'warning',
      path: t.path, property: t.property,
      message: `${t.property} is bound to ${t.token}, which names the ${word} state, `
        + 'but this binding applies where that state is not set.',
      ...(Object.keys(t.conditions).length > 0 ? { when: t.conditions } : {}),
    });
  }

  // 2. A rendered number disagreeing with its bound token's resolved value.
  for (const l of spec.layout) {
    for (const { property, value } of geometryOf(l)) {
      const rule = spec.tokens.find((t) => t.part === l.part && t.property === property);
      if (!rule) continue;
      const target = resolved.get(rule.token);
      if (target === undefined || target === value) continue;
      findings.push({
        id: 'geometry-token-mismatch', severity: 'warning',
        path: rule.path, property,
        message: `The frame renders ${property} ${value}, while the bound token `
          + `${rule.token} resolves to ${target}.`,
      });
    }
  }

  // 3. One path and property bound to two different tokens under one condition.
  const byTarget = new Map<string, Set<string>>();
  for (const t of spec.tokens) {
    const key = `${t.path} ${t.property} ${JSON.stringify(t.conditions)}`;
    const set = byTarget.get(key) ?? new Set<string>();
    set.add(t.token);
    byTarget.set(key, set);
  }
  for (const [key, tokens] of byTarget) {
    if (tokens.size < 2) continue;
    const [path, property] = key.split(' ');
    findings.push({
      id: 'duplicate-conflicting-binding', severity: 'error',
      path, property,
      message: `${property} is bound to ${[...tokens].join(' and ')} under the same `
        + 'condition, so a consumer has no rule for choosing between them.',
    });
  }

  // 4. More than one state-like axis. detectStateMatrix takes the first silently.
  const stateAxes = spec.variants.filter(isStateLike).map((v) => v.prop);
  if (stateAxes.length > 1) {
    findings.push({
      id: 'ambiguous-state-axis', severity: 'warning',
      message: `${stateAxes.join(' and ')} all read as state axes. Only `
        + `${stateAxes[0]} was used as the state matrix, and the rest were treated `
        + 'as ordinary variants.',
    });
  }

  // 5. Mirror each surviving gap, so one list carries everything actionable.
  for (const g of spec.gaps) {
    findings.push({
      id: 'unbound-value', severity: 'warning',
      path: g.path, property: g.property,
      message: g.value !== undefined
        ? `${g.property} is a hardcoded ${g.value} rather than a bound token.`
        : `${g.property} is not bound to a token.`,
    });
  }

  return findings;
}
```

- [ ] **Step 7: Wire it into the brief**

In `componentBrief`, build the resolved-number map from the same `lookupToken` results the
bindings use, then add the block:

```ts
    validation: (() => {
      const resolved = new Map<string, number>();
      for (const t of spec.tokens) {
        const looked = lookupToken(opts.foundation, t.token);
        const v = looked.value;
        if (typeof v === 'number') resolved.set(t.token, v);
        else if (v && typeof v === 'object' && 'resolved' in v
                 && typeof (v as { resolved?: unknown }).resolved === 'number') {
          resolved.set(t.token, (v as { resolved: number }).resolved);
        }
      }
      const findings = validate(spec, resolved);
      return findings.length > 0 ? findings : undefined;
    })(),
```

Export `validate`, `Finding` and `FindingId` from `packages/extractor/src/index.ts`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/validate.test.ts packages/extractor/test/brief.test.ts`

Expected: PASS.

- [ ] **Step 9: Confirm it catches the two real findings in the fixture**

```bash
npx tsx -e "const {readFileSync}=require('fs');const {extract,componentBrief}=require('./packages/extractor/src/index.ts');const n=JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json','utf8'));console.log(JSON.stringify((componentBrief(extract(n,{figmaFile:'F'}),{generatedAt:'T'})).validation,null,1));"
```

Expected: findings present. On a fixture carrying the real Button data this should include
`default-state-uses-state-token` for the Primary/Large default bound to
`color/surface/primary/disabled`. If the fixture does not carry that binding, note it in the
commit rather than claiming coverage the fixture does not have.

- [ ] **Step 10: Run the full suite and commit**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

```bash
git add packages/extractor/src packages/extractor/test/validate.test.ts
git commit -m "feat(extractor): emit deterministic validation findings" -m "Five computed findings: a default variant bound to a state token, a rendered geometry value disagreeing with its token, one path and property bound to two tokens, more than one state-like axis, and each unbound value." -m "No aggregate score. An undefined number telling an agent it may skip human review is worse than no number. No info severity either: a finding nobody should act on should not be emitted." -m "isStateLike is exported so the ambiguity finding matches the matrix the frames actually render, rather than reimplementing the test and risking disagreement." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Split `source` into key, name, node and component key
**Files:**
- Modify: `packages/extractor/src/extract.ts` (`IntermediateSpec` gains `figmaFileName`)
- Modify: `packages/extractor/src/brief.ts` (both `source` blocks)
- Modify: `packages/extractor/src/hash.ts` (exclude `figmaFileName`)
- Modify: `packages/plugin/src/messages.ts`, `packages/plugin/src/main.ts`, `packages/plugin/src/ui/actions.ts`
- Test: `packages/extractor/test/brief.test.ts`, `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IntermediateSpec.figmaFileName?: string`; `extract(root, meta: { figmaFile: string; figmaFileName?: string })`. Brief `source` is `{ file_key?, file_name?, node_id, node_name, component_key? }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('splits source into key, name, node and component key', () => {
  const spec = { ...baseSpec(), figmaFile: 'KEY1', figmaFileName: 'Design System',
                 figmaNode: '1391:54066', name: 'buttonPrimary', figmaKey: 'CK1' };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect(brief.source).toEqual({
    file_key: 'KEY1', file_name: 'Design System',
    node_id: '1391:54066', node_name: 'buttonPrimary', component_key: 'CK1',
  });
});

it('omits an unavailable file key rather than emitting the string unknown', () => {
  const spec = { ...baseSpec(), figmaFile: 'unknown', figmaFileName: undefined };
  const brief = componentBrief(spec, { generatedAt: 'T' }) as Record<string, any>;
  expect('file_key' in brief.source).toBe(false);
  expect('file_name' in brief.source).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t "splits source"`

Expected: FAIL, `source` is still `{ file, node, component_key }`.

- [ ] **Step 3: Write the implementation**

Add `figmaFileName?: string;` to `IntermediateSpec`, set it from `meta.figmaFileName`, and widen the `meta` type. Then in `brief.ts`:

```ts
    source: {
      // `resolveFileKey` yields the literal 'unknown' when Figma exposes no file
      // key and the user set no override. Emitting that reads as a value, and a
      // consumer cannot tell it apart from a real key, so an unavailable key is
      // an ABSENT key. The YAML emitter drops undefined-valued keys.
      file_key: spec.figmaFile && spec.figmaFile !== 'unknown' ? spec.figmaFile : undefined,
      file_name: spec.figmaFileName || undefined,
      node_id: spec.figmaNode,
      node_name: spec.name,
      component_key: spec.figmaKey || undefined,
    },
```

Apply the same `!== 'unknown'` treatment to `foundationBrief`'s `source.file_key`.

- [ ] **Step 4: Send the file name from the main thread**

`figma.root.name` is main-thread only. Confirm where the main thread already builds the message carrying `fileKey`:

```bash
grep -rn "figma.root\|fileKey" packages/plugin/src/main.ts | head
```

Add `fileName: figma.root.name` to that message, declare it in `packages/plugin/src/messages.ts`, and pass it at each `extract` call:

```ts
  const spec = extract(src.node, { figmaFile: src.fileKey, figmaFileName: src.fileName });
```

- [ ] **Step 5: Keep a file rename out of the hash**

`figmaFileName` joins `IntermediateSpec` and would otherwise enter the hash, making a Figma file rename read as component drift, which it is not:

```ts
  const { rawValues: _rawValues, figmaFileName: _fileName, ...rest } = spec;
```

- [ ] **Step 6: Run everything**

Run: `npx vitest run packages/extractor/test/specHash.test.ts && npm test && npm run check:sandbox && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS, with the hash still equal to `BUTTON_HASH_V2`.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor packages/plugin/src
git commit -m "feat(extractor): split brief source into key, name, node and component key" -m "figmaFile held a file KEY under a field named file, and fell back to the literal string unknown, which a consumer cannot tell from a real key. An unavailable key is now an absent key." -m "figmaFileName is excluded from specContentHash: renaming a Figma file is not component drift." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 13: Lock the size win with an assertion and a golden file
Task 4 delivered the size reduction. Nothing yet stops a later change from undoing it,
and nothing reviews the whole payload as a document rather than field by field.

**Files:**
- Create: `packages/extractor/test/briefGolden.test.ts`
- Create: `packages/extractor/test/fixtures/button-brief.yaml`
- Test: both of the above

**Interfaces:**
- Consumes: everything from Tasks 1-12.
- Produces: no source change. Two regression guards.

- [ ] **Step 1: Write the size assertion**

Create `packages/extractor/test/briefGolden.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { extract, componentBrief, toYaml } from '../src/index';

const button = () =>
  JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));

describe('component brief size', () => {
  // The repo's button.json has 3 variants and 6 token rules, so it renders in about
  // 104 lines whether bindings are condition-based or expanded per variant. An
  // absolute line threshold would pass forever and guard nothing. The property that
  // matters is that output tracks distinct RULES rather than the variant matrix, and
  // that holds at any fixture size.
  it('emits one binding per distinct rule, never one per variant', () => {
    const spec = extract(button(), { figmaFile: 'FILE1' });
    const brief = componentBrief(spec, { generatedAt: '2026-08-18T00:00:00.000Z' })
      as unknown as { tokens: { bindings: unknown[] } };
    expect(brief.tokens.bindings.length).toBeLessThanOrEqual(spec.tokens.length);
    // v1's shape was one entry per variant, each repeating every binding. If anyone
    // reintroduces that, this fails even on a 3-variant fixture.
    expect(brief.tokens.bindings.length)
      .toBeLessThan(spec.variantInstances.length * spec.tokens.length);
  });

  it('lists each token once however many bindings reference it', () => {
    const spec = extract(button(), { figmaFile: 'FILE1' });
    const brief = componentBrief(spec, { generatedAt: '2026-08-18T00:00:00.000Z' })
      as unknown as { tokens: { bindings: { token: string }[]; used: Record<string, unknown> } };
    const referenced = new Set(brief.tokens.bindings.map((b) => b.token));
    expect(Object.keys(brief.tokens.used).sort()).toEqual([...referenced].sort());
  });

  it('has no base or by_variant block', () => {
    const brief = componentBrief(extract(button(), { figmaFile: 'FILE1' }),
      { generatedAt: '2026-08-18T00:00:00.000Z' }) as unknown as { tokens: object };
    expect('base' in brief.tokens).toBe(false);
    expect('by_variant' in brief.tokens).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/extractor/test/briefGolden.test.ts`

Expected: PASS. If any of the three fails, Task 4 regressed and that is the bug to fix.
Do not relax an assertion to make it pass.

- [ ] **Step 3: Write the golden-file test**

Append to the same file:

```ts
const GOLDEN = 'packages/extractor/test/fixtures/button-brief.yaml';

describe('component brief golden file', () => {
  it('matches the reviewed payload byte for byte', () => {
    // A field-by-field test cannot catch a whole document reading badly: a wrong
    // block order, a duplicated section, a key that should have been omitted. The
    // golden file is reviewed once by a human and then diffed, so any later change
    // to the payload has to be looked at rather than merely compiling.
    //
    // This test only ever ASSERTS. The fixture is written by the generation step in
    // this task, not by the test: a test that writes its own expectation cannot
    // fail the first time it runs, which is exactly when it should.
    expect(existsSync(GOLDEN)).toBe(true);
    const yaml = toYaml(componentBrief(extract(button(), { figmaFile: 'FILE1' }),
      { generatedAt: '2026-08-18T00:00:00.000Z' }));
    expect(yaml).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
```

- [ ] **Step 4: Generate the golden file and read it**

Generate it with the same inputs the test uses, so the two cannot drift:

```bash
npx tsx -e "const {readFileSync,writeFileSync}=require('fs');const {extract,componentBrief,toYaml}=require('./packages/extractor/src/index.ts');const n=JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json','utf8'));writeFileSync('packages/extractor/test/fixtures/button-brief.yaml',toYaml(componentBrief(extract(n,{figmaFile:'FILE1'}),{generatedAt:'2026-08-18T00:00:00.000Z'})));" && wc -l packages/extractor/test/fixtures/button-brief.yaml
```

Run the test to confirm it now passes:

`npx vitest run packages/extractor/test/briefGolden.test.ts`

Then actually read
`packages/extractor/test/fixtures/button-brief.yaml` end to end and check:

- `source` carries a real key and name, and no `unknown`.
- `api` has `variants`, `states` and `booleans`, and there is no top-level `axes`.
- `tokens.used` lists each token once; `tokens.bindings` carries `when` only where a
  binding depends on an axis.
- `typography` has real metrics, not a display string.
- `unbound` names no path and property that `tokens.bindings` also names.
- `validation` includes the Primary/Large default bound to `color/surface/primary/disabled`.
- `guidelines` is the only block containing generated prose.
- There is no `contrast` block.

Fix anything wrong at its source, then re-run the generation command above. Do not
hand-edit the file: a golden file edited to match a bug documents the bug.

- [ ] **Step 5: Add the generated-content boundary scan**

Append:

```ts
it('confines generated prose to the guidelines block', () => {
  const brief = componentBrief(extract(button(), { figmaFile: 'FILE1' }), {
    generatedAt: 'T',
    prose: {
      definition: 'GENERATED_MARKER_A', accessibility: '', interactions: '',
      variantsSummary: '', anatomySummary: '', designConsiderations: '',
      contentConsiderations: '', dos: ['GENERATED_MARKER_B'], donts: [],
    },
  }) as Record<string, unknown>;
  // The boundary is structural, not a per-field annotation: generation is confined
  // to prose, so one block is the whole boundary. This asserts it stays that way.
  for (const [key, value] of Object.entries(brief)) {
    if (key === 'guidelines') continue;
    expect(JSON.stringify(value)).not.toContain('GENERATED_MARKER');
  }
  expect(JSON.stringify(brief.guidelines)).toContain('GENERATED_MARKER_A');
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/briefGolden.test.ts`

Expected: PASS, all three.

- [ ] **Step 7: Add the `origin` marker to component guidelines**

`guidelinesOf` builds the block. Add `origin: 'generated'` as its first key, so both briefs
mark it the same way:

```ts
  const result: Record<string, YamlValue | undefined> = {
    origin: 'generated',
    definition: prose.definition || undefined,
```

The existing emptiness check decides on whether any OTHER field is present, so `origin`
must not be counted:

```ts
  const { origin: _origin, ...fields } = result;
  return Object.values(fields).some((v) => v !== undefined) ? result : undefined;
```

Re-run the generation command, and read the diff before committing it.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

```bash
git add packages/extractor/src/brief.ts packages/extractor/test/briefGolden.test.ts packages/extractor/test/fixtures/button-brief.yaml
git commit -m "test(extractor): lock the brief size and add a golden file" -m "A field-by-field test cannot catch a document reading badly: wrong block order, a duplicated section, a key that should have been omitted. The golden file is reviewed once and then diffed." -m "The size assertion sits at 600 lines as a regression guard against Task 4 being undone; the target is 400-500 and v1 was roughly 2700." -m "A boundary scan asserts generated prose appears only under guidelines, which is what makes one marked block a sufficient boundary." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Classify foundation colour variables by role
**Files:**
- Create: `packages/extractor/src/colorContrast.ts`
- Test: `packages/extractor/test/colorContrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type ColorRole = 'foreground' | 'background' | null` and `export function colorRole(name: string): ColorRole`.

- [ ] **Step 1: Write the failing tests**

Create `packages/extractor/test/colorContrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { colorRole } from '../src/colorContrast';

describe('colorRole', () => {
  it('reads text, icon, stroke, border and content as foreground', () => {
    expect(colorRole('color/text/primary/default')).toBe('foreground');
    expect(colorRole('color/icon/neutral/default')).toBe('foreground');
    expect(colorRole('color/stroke/primary/focus')).toBe('foreground');
    expect(colorRole('color/border/subtle')).toBe('foreground');
    expect(colorRole('color/content/muted')).toBe('foreground');
  });

  it('reads surface, background, bg, fill, canvas and base as background', () => {
    expect(colorRole('color/surface/primary/default')).toBe('background');
    expect(colorRole('color/background/page')).toBe('background');
    expect(colorRole('color/bg/subtle')).toBe('background');
    expect(colorRole('color/fill/neutral')).toBe('background');
    expect(colorRole('color/canvas/default')).toBe('background');
    expect(colorRole('color/base/white')).toBe('background');
  });

  it('resolves a name carrying both words by first match in path order', () => {
    // "text" at segment 1 wins over "surface" inside "on-surface" at segment 2.
    expect(colorRole('color/text/on-surface/default')).toBe('foreground');
    expect(colorRole('color/icon/on-surface/default')).toBe('foreground');
    // The reverse order resolves the other way, which is what makes it a rule
    // rather than a special case for the on-surface convention.
    expect(colorRole('color/surface/text-ish/default')).toBe('background');
  });

  it('treats an on- prefixed segment as foreground before splitting it', () => {
    expect(colorRole('color/on-surface/default')).toBe('foreground');
    expect(colorRole('color/on-background/muted')).toBe('foreground');
  });

  it('splits a hyphenated segment to find a role word', () => {
    expect(colorRole('color/bg-subtle/default')).toBe('background');
    expect(colorRole('color/text-muted/default')).toBe('foreground');
  });

  it('is case insensitive', () => {
    expect(colorRole('Color/Surface/Primary')).toBe('background');
    expect(colorRole('COLOR/TEXT/PRIMARY')).toBe('foreground');
  });

  it('returns null when no segment carries a role word', () => {
    expect(colorRole('colors/blue/500')).toBeNull();
    expect(colorRole('brand/1')).toBeNull();
    expect(colorRole('')).toBeNull();
  });

  it('does not match a role word as a substring of a longer word', () => {
    // "subtext" is not "text", and "basement" is not "base". Substring matching
    // would misclassify both, and silently.
    expect(colorRole('color/subtext/default')).toBeNull();
    expect(colorRole('color/basement/default')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/colorContrast.test.ts`

Expected: FAIL, cannot resolve `../src/colorContrast`.

- [ ] **Step 3: Write the implementation**

Create `packages/extractor/src/colorContrast.ts`:

```ts
/**
 * Contrast over foundation COLOUR variables.
 *
 * A contrast ratio is a fact about two colour values, so it belongs to the
 * foundation rather than to each component that happens to use the pair. The
 * problem this file solves is that a collection is a flat list of colours with no
 * statement of which sits on which, so pairs have to come from the one signal
 * that is actually present: the words in the variable's own name.
 */

export type ColorRole = 'foreground' | 'background' | null;

/** Words meaning "this colour is drawn ON something". */
const FOREGROUND_WORDS = new Set(['text', 'icon', 'stroke', 'border', 'content']);
/** Words meaning "this colour is what something is drawn on". */
const BACKGROUND_WORDS = new Set(['surface', 'background', 'bg', 'fill', 'canvas', 'base']);

/**
 * The role a colour variable's name declares, or null when it declares none.
 *
 * Walks the name's `/` segments in order and returns the FIRST role found, which
 * is what makes a name carrying both words deterministic:
 * `color/text/on-surface/default` is a foreground because `text` comes first, not
 * a background because `surface` appears later.
 *
 * An `on-` prefixed segment is checked before the segment is split on hyphens.
 * Splitting first would find `surface` inside `on-surface` and classify the very
 * convention that means "content drawn on a surface" as a background.
 *
 * Matching is on whole hyphen-delimited words, never substrings: `subtext` is not
 * `text`, and `basement` is not `base`.
 */
export function colorRole(name: string): ColorRole {
  for (const rawSegment of name.split('/')) {
    const segment = rawSegment.trim().toLowerCase();
    if (!segment) continue;
    if (segment === 'on' || segment.startsWith('on-')) return 'foreground';
    const words = segment.split('-');
    if (words.some((w) => FOREGROUND_WORDS.has(w))) return 'foreground';
    if (words.some((w) => BACKGROUND_WORDS.has(w))) return 'background';
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/colorContrast.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/colorContrast.ts packages/extractor/test/colorContrast.test.ts
git commit -m "feat(extractor): classify foundation colours by role" -m "Pairs for contrast have to come from somewhere, and a collection is a flat list of colours with no statement of which sits on which. The one signal present is the variable name, so roles are read from its path segments." -m "First match in path order wins, so a name carrying both words is deterministic. An on- prefix is checked before hyphen splitting, or on-surface would classify as a background. Matching is on whole words, so subtext is not text." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 15: Report which WCAG bars a ratio clears
**Files:**
- Modify: `packages/extractor/src/colorContrast.ts`
- Test: `packages/extractor/test/colorContrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type ContrastBar = 'aa-large' | 'aa' | 'aaa'` and `export function barsCleared(ratio: number): ContrastBar[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/colorContrast.test.ts`, extending the import at the top to `import { colorRole, barsCleared } from '../src/colorContrast';`:

```ts
describe('barsCleared', () => {
  it('clears nothing below 3:1', () => {
    expect(barsCleared(2.23)).toEqual([]);
    expect(barsCleared(1)).toEqual([]);
  });
  it('clears aa-large from 3:1', () => {
    expect(barsCleared(3)).toEqual(['aa-large']);
    expect(barsCleared(4.22)).toEqual(['aa-large']);
  });
  it('clears aa from 4.5:1', () => {
    expect(barsCleared(4.5)).toEqual(['aa-large', 'aa']);
    expect(barsCleared(6.94)).toEqual(['aa-large', 'aa']);
  });
  it('clears aaa from 7:1', () => {
    expect(barsCleared(7)).toEqual(['aa-large', 'aa', 'aaa']);
    expect(barsCleared(21)).toEqual(['aa-large', 'aa', 'aaa']);
  });
  it('returns bars in ascending strictness so the last is the strongest', () => {
    expect(barsCleared(21)[2]).toBe('aaa');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/colorContrast.test.ts -t barsCleared`

Expected: FAIL, `barsCleared` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/extractor/src/colorContrast.ts`:

```ts
/** The named WCAG bars a ratio can clear, ascending in strictness. */
export type ContrastBar = 'aa-large' | 'aa' | 'aaa';

/**
 * Which bars this ratio clears.
 *
 * Deliberately NOT a pass/fail verdict. A foundation carries no font size, so
 * nothing here can know whether 3:1 (SC 1.4.3 large text, and SC 1.4.11 for UI
 * components and borders) or 4.5:1 (normal text) is the bar that applies to a
 * given use of the pair. Reporting every bar the ratio clears lets the reader
 * apply the one their case needs, instead of the extractor asserting a threshold
 * it cannot justify.
 */
export function barsCleared(ratio: number): ContrastBar[] {
  const out: ContrastBar[] = [];
  if (ratio >= 3) out.push('aa-large');
  if (ratio >= 4.5) out.push('aa');
  if (ratio >= 7) out.push('aaa');
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/colorContrast.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/colorContrast.ts packages/extractor/test/colorContrast.test.ts
git commit -m "feat(extractor): report which WCAG bars a ratio clears" -m "Not a pass/fail verdict: a foundation carries no font size, so nothing can justify picking 3:1 over 4.5:1 for a pair. Reporting every bar cleared lets the reader apply the one their case needs." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 16: Measure within-collection pairs per mode
**Files:**
- Modify: `packages/extractor/src/colorContrast.ts`, `packages/extractor/src/index.ts`
- Test: `packages/extractor/test/colorContrast.test.ts`

**Interfaces:**
- Consumes: `colorRole` and `barsCleared` (Tasks 14-15); `concreteColor`, `contrastRatio`, `blend` from `contrast.ts` (Task 2); `FoundationSpec`, `FoundationVariable` from `foundation.ts`.
- Produces:

```ts
export const CONTRAST_AXIS_CAP = 24;
export interface ContrastCell { ratio: number; clears: ContrastBar[] }
export interface ContrastMatrix {
  collection: string; mode: string;
  foregrounds: string[]; backgrounds: string[];
  cells: (ContrastCell | null)[][];
}
export interface ContrastFailure {
  collection: string; mode: string;
  foreground: { token: string; value: string };
  background: { token: string; value: string };
  ratio: number; clears: ContrastBar[];
}
export interface ColorContrastReport {
  measured: number; unclassified: number; omitted: number;
  matrices: ContrastMatrix[]; failures: ContrastFailure[];
}
export function colorContrast(foundation: FoundationSpec, cap?: number): ColorContrastReport
```

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/colorContrast.test.ts`:

```ts
import { colorContrast, CONTRAST_AXIS_CAP } from '../src/colorContrast';
import type { FoundationSpec, FoundationValue } from '../src/foundation';

const hex = (h: string, alpha = 1): FoundationValue => ({ kind: 'color', hex: h, alpha });

function spec(
  variables: { name: string; valuesByMode: Record<string, FoundationValue> }[],
  modes = [{ modeId: 'm1', name: 'Light' }],
): FoundationSpec {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-08-18T00:00:00.000Z',
    textStyles: [],
    collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 'm1', modes,
      variables: variables.map((v) => ({
        name: v.name, group: '', resolvedType: 'COLOR' as const,
        description: '', codeSyntax: {}, valuesByMode: v.valuesByMode,
      })),
    }],
  };
}

describe('colorContrast', () => {
  it('measures every foreground against every background', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/text/b', valuesByMode: { m1: hex('#000000') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#722ed1') } },
    ]));
    expect(r.matrices).toHaveLength(1);
    expect(r.matrices[0].foregrounds).toEqual(['color/text/a', 'color/text/b']);
    expect(r.matrices[0].backgrounds).toEqual(['color/surface/x']);
    expect(r.measured).toBe(2);
  });

  it('reproduces the known Button failures', () => {
    const r = colorContrast(spec([
      { name: 'color/text/on-surface/default', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/text/primary/default', valuesByMode: { m1: hex('#722ed1') } },
      { name: 'color/surface/primary/disabled', valuesByMode: { m1: hex('#a9aeb8') } },
      { name: 'color/surface/primary/light-press', valuesByMode: { m1: hex('#ddbef6') } },
    ]));
    const f = (fg: string, bg: string) =>
      r.failures.find((x) => x.foreground.token === fg && x.background.token === bg);
    const disabled = f('color/text/on-surface/default', 'color/surface/primary/disabled')!;
    expect(disabled.ratio).toBeCloseTo(2.23, 2);
    expect(disabled.clears).toEqual([]);
    // 4.22 clears aa-large but not aa, so it is not a failure by the bar-based
    // definition and must NOT appear in `failures`.
    const press = r.matrices[0].cells[1][1]!;
    expect(press.ratio).toBeCloseTo(4.22, 2);
    expect(press.clears).toEqual(['aa-large']);
  });

  it('measures each mode separately', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff'), m2: hex('#000000') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#000000'), m2: hex('#ffffff') } },
    ], [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }]));
    expect(r.matrices.map((m) => m.mode)).toEqual(['Light', 'Dark']);
    expect(r.matrices[0].cells[0][0]!.ratio).toBeCloseTo(21, 1);
    expect(r.matrices[1].cells[0][0]!.ratio).toBeCloseTo(21, 1);
  });

  it('composites a translucent foreground over its background', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#000000', 0.5) } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#ffffff') } },
    ]));
    // #000 at 50% over white is #808080, which is about 3.95:1 against white.
    expect(r.matrices[0].cells[0][0]!.ratio).toBeCloseTo(3.95, 1);
  });

  it('skips a translucent background as unknowable', () => {
    const r = colorContrast(spec([
      { name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } },
      { name: 'color/surface/x', valuesByMode: { m1: hex('#722ed1', 0.5) } },
    ]));
    expect(r.matrices[0].cells[0][0]).toBeNull();
    expect(r.measured).toBe(0);
  });

  it('counts colours that classify as neither role', () => {
    const r = colorContrast(spec([
      { name: 'colors/blue/500', valuesByMode: { m1: hex('#722ed1') } },
      { name: 'brand/1', valuesByMode: { m1: hex('#000000') } },
    ]));
    expect(r.unclassified).toBe(2);
    expect(r.matrices).toEqual([]);
    expect(r.measured).toBe(0);
  });

  it('caps each axis and reports how many tokens it dropped', () => {
    const many = Array.from({ length: CONTRAST_AXIS_CAP + 3 }, (_, i) => ({
      name: `color/text/t${i}`, valuesByMode: { m1: hex('#000000') },
    }));
    const r = colorContrast(spec([
      ...many,
      { name: 'color/surface/x', valuesByMode: { m1: hex('#ffffff') } },
    ]));
    expect(r.matrices[0].foregrounds).toHaveLength(CONTRAST_AXIS_CAP);
    expect(r.omitted).toBe(3);
  });

  it('ignores non-colour variables', () => {
    const s = spec([{ name: 'color/text/a', valuesByMode: { m1: hex('#ffffff') } }]);
    s.collections[0].variables.push({
      name: 'space/4', group: '', resolvedType: 'FLOAT',
      description: '', codeSyntax: {}, valuesByMode: { m1: { kind: 'number', value: 16 } },
    });
    const r = colorContrast(s);
    expect(r.unclassified).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/colorContrast.test.ts -t colorContrast`

Expected: FAIL, `colorContrast` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/extractor/src/colorContrast.ts`:

```ts
import type { FoundationSpec, FoundationVariable } from './foundation';
import { blend, contrastRatio, concreteColor } from './contrast';

/**
 * Cap on each axis of one matrix. A frame has to stay readable and a brief has to
 * stay small, and a 40 by 40 grid is neither. What the cap drops is REPORTED (see
 * `omitted`), because a bounded result presented as a complete one is worse than
 * no result at all.
 */
export const CONTRAST_AXIS_CAP = 24;

export interface ContrastCell { ratio: number; clears: ContrastBar[] }

export interface ContrastMatrix {
  collection: string;
  mode: string;
  foregrounds: string[];
  backgrounds: string[];
  /** `cells[fgIndex][bgIndex]`, null where the pair could not be measured. */
  cells: (ContrastCell | null)[][];
}

export interface ContrastFailure {
  collection: string;
  mode: string;
  foreground: { token: string; value: string };
  background: { token: string; value: string };
  ratio: number;
  clears: ContrastBar[];
}

export interface ColorContrastReport {
  /** Pairs actually measured. Zero means nothing was checked, never "all pass". */
  measured: number;
  /** COLOUR variables whose name declared no role, so they were never paired. */
  unclassified: number;
  /** Classified variables dropped by the cap. */
  omitted: number;
  matrices: ContrastMatrix[];
  /** Every measured pair clearing NO bar at all, flattened across matrices. A
   *  pair clearing aa-large but not aa is not listed: whether that is a failure
   *  depends on a font size the foundation does not have. */
  failures: ContrastFailure[];
}

/**
 * Measure contrast across a foundation's colour variables.
 *
 * Pairs are confined to ONE collection, which is what makes per-mode measurement
 * possible: both sides then share a single mode set, so Light pairs with Light and
 * Dark with Dark without inventing a correspondence between two collections'
 * unrelated modes. Cross-collection pairing needs exactly that correspondence,
 * which is why it stays out of scope rather than being approximated.
 */
export function colorContrast(
  foundation: FoundationSpec,
  cap: number = CONTRAST_AXIS_CAP,
): ColorContrastReport {
  const matrices: ContrastMatrix[] = [];
  const failures: ContrastFailure[] = [];
  let measured = 0;
  let unclassified = 0;
  let omitted = 0;

  for (const collection of foundation.collections) {
    const colours = collection.variables.filter((v) => v.resolvedType === 'COLOR');
    const fg: FoundationVariable[] = [];
    const bg: FoundationVariable[] = [];
    for (const v of colours) {
      const role = colorRole(v.name);
      if (role === 'foreground') fg.push(v);
      else if (role === 'background') bg.push(v);
      else unclassified++;
    }

    omitted += Math.max(0, fg.length - cap) + Math.max(0, bg.length - cap);
    const foregrounds = fg.slice(0, cap);
    const backgrounds = bg.slice(0, cap);
    if (!foregrounds.length || !backgrounds.length) continue;

    for (const mode of collection.modes) {
      const cells: (ContrastCell | null)[][] = [];
      for (const f of foregrounds) {
        const row: (ContrastCell | null)[] = [];
        const fgValue = f.valuesByMode[mode.modeId];
        const fgColour = fgValue ? concreteColor(fgValue) : null;
        for (const b of backgrounds) {
          const bgValue = b.valuesByMode[mode.modeId];
          const bgColour = bgValue ? concreteColor(bgValue) : null;
          // A translucent background is only meaningful over whatever sits behind
          // it, and a foundation does not know that. Assuming white would lighten
          // the computed background enough to push a real failure above threshold,
          // so skip and let the counts say so.
          if (!fgColour || !bgColour || bgColour.alpha < 1) { row.push(null); continue; }
          const composited = blend(fgColour.hex, fgColour.alpha, bgColour.hex);
          const ratio = Math.round(contrastRatio(composited, bgColour.hex) * 100) / 100;
          const clears = barsCleared(ratio);
          row.push({ ratio, clears });
          measured++;
          if (clears.length === 0) {
            failures.push({
              collection: collection.name, mode: mode.name,
              foreground: { token: f.name, value: composited },
              background: { token: b.name, value: bgColour.hex },
              ratio, clears,
            });
          }
        }
        cells.push(row);
      }
      matrices.push({
        collection: collection.name, mode: mode.name,
        foregrounds: foregrounds.map((v) => v.name),
        backgrounds: backgrounds.map((v) => v.name),
        cells,
      });
    }
  }

  return { measured, unclassified, omitted, matrices, failures };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/colorContrast.test.ts`

Expected: PASS, all describes.

- [ ] **Step 5: Export from the package index**

Add to `packages/extractor/src/index.ts`:

```ts
export {
  colorRole, barsCleared, colorContrast, CONTRAST_AXIS_CAP,
  type ColorRole, type ContrastBar, type ContrastCell, type ContrastMatrix,
  type ContrastFailure, type ColorContrastReport,
} from './colorContrast';
```

- [ ] **Step 6: Run the full suite and the type check**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor/src/colorContrast.ts packages/extractor/src/index.ts packages/extractor/test/colorContrast.test.ts
git commit -m "feat(extractor): measure within-collection colour contrast per mode" -m "Pairs are confined to one collection, which is what makes per-mode measurement possible at all: both sides share a single mode set, so Light pairs with Light without inventing a correspondence between two collections unrelated modes." -m "Translucent backgrounds are skipped rather than assumed to sit on white. Unclassified and cap-dropped counts are reported, so a bounded result is never presented as a complete one." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 17: Add the foundation contrast toggle
**Files:**
- Modify: `packages/plugin/src/docLink.ts:155-160` (`FoundationConfig`), and the foundation config parse near `:326-345`
- Test: `packages/plugin/test/docLink.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FoundationConfig` gains `includeContrast: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/docLink.test.ts`:

```ts
import type { FoundationDocLink } from '../src/docLink';

it('defaults includeContrast to false on a link written before it existed', () => {
  const blob = JSON.stringify({
    v: 1, kind: 'foundation', generatedAt: 0, pluginVersion: '2.0.0',
    contentHash: 'h', selfHash: 's',
    scope: { target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: ['m1'] },
    config: { includeDescriptions: true, aiNotes: false },
  });
  const parsed = parseDocLink(blob);
  expect(parsed).not.toBeNull();
  expect((parsed as FoundationDocLink).config.includeContrast).toBe(false);
});

it('round-trips includeContrast when set', () => {
  const blob = JSON.stringify({
    v: 1, kind: 'foundation', generatedAt: 0, pluginVersion: '2.0.0',
    contentHash: 'h', selfHash: 's',
    scope: { target: 'textStyles' },
    config: { includeDescriptions: false, aiNotes: false, includeContrast: true },
  });
  expect((parseDocLink(blob) as FoundationDocLink).config.includeContrast).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/docLink.test.ts -t includeContrast`

Expected: FAIL, `includeContrast` is undefined.

- [ ] **Step 3: Write the implementation**

In `packages/plugin/src/docLink.ts`:

```ts
export interface FoundationConfig {
  includeDescriptions: boolean;
  aiNotes: boolean;
  /**
   * Render the colour contrast matrix. Defaults to FALSE on any link written
   * before this existed, which is what keeps an existing doc's rendered output
   * identical after an upgrade.
   *
   * The matrix is derived from colours already hashed via
   * FoundationUnitContent.rows, so toggling it changes what renders without
   * moving foundationContentHash, exactly as includeDescriptions does.
   */
  includeContrast: boolean;
}
```

In the foundation config parse, alongside the existing coercions:

```ts
      includeContrast: j.config.includeContrast === true,
```

Then fix every construction site the type checker names:

```bash
npx tsc -p tsconfig.base.json --noEmit 2>&1 | grep includeContrast
```

Each gets `includeContrast: false`, except the build path that reads the user's toggle.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`

Expected: PASS.

- [ ] **Step 5: Prove the toggle cannot move the foundation hash**

Append to `packages/extractor/test/foundationHash.test.ts`:

```ts
it('is identical whether or not contrast is rendered', () => {
  // foundationContentHash hashes unitContent(), and contrast is deliberately NOT
  // part of FoundationUnitContent: it is derived from the colours already in
  // `rows`, so it cannot change unless a colour changes, and that moves the hash
  // on its own. This test is the guard on that decision. If someone later adds a
  // contrast field to FoundationUnitContent, this fails, and it should: every
  // existing foundation doc would flip to "update available" for a derived value.
  const spec = dumpOneOfEach();
  const scope = { target: 'collection' as const, collectionId: 'c1',
                  collectionName: 'Primitives', modeIds: ['m1'] };
  const built = buildFoundation(spec);
  const before = foundationContentHash(built, scope);
  // The toggle lives in FoundationConfig, which unitContent never receives, so
  // there is no second value to compute: the hash is toggle-independent by
  // construction. Assert the invariant that makes that true.
  expect(Object.keys(unitContent(built, scope) ?? {})).not.toContain('contrast');
  expect(foundationContentHash(built, scope)).toBe(before);
});
```

- [ ] **Step 6: Run the full suite and the type check**

Run: `npm test && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/docLink.ts packages/plugin/test/docLink.test.ts packages/extractor/test/foundationHash.test.ts
git commit -m "feat(plugin): add the foundation contrast toggle" -m "Defaults to false on links written before it existed, so upgrading leaves an existing foundation doc rendering exactly what it rendered before." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 18: Render the contrast matrix on the foundation frame
**Files:**
- Create: `packages/plugin/src/foundationContrast.ts`
- Modify: `packages/plugin/src/foundationFrame.ts`
- Test: `packages/plugin/test/foundationContrast.test.ts`

**Interfaces:**
- Consumes: `ColorContrastReport`, `ContrastMatrix` (Task 16); `FoundationConfig.includeContrast` (Task 17).
- Produces:

```ts
export type ContrastBlockModel =
  | { kind: 'none'; reason: string }
  | { kind: 'matrix'; matrices: ContrastMatrix[]; note: string | null };
export function contrastBlockModel(r: ColorContrastReport, collectionName: string): ContrastBlockModel
export function cellLabel(cell: { ratio: number; clears: string[] } | null): string
export function matrixFrame(m: ContrastMatrix): FrameNode
```

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin/test/foundationContrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contrastBlockModel, cellLabel } from '../src/foundationContrast';
import type { ColorContrastReport } from '@spec-layer/extractor';

const empty: ColorContrastReport =
  { measured: 0, unclassified: 0, omitted: 0, matrices: [], failures: [] };

const oneMatrix = () => ([{
  collection: 'Semantic', mode: 'Light',
  foregrounds: ['color/text/a'], backgrounds: ['color/surface/x'],
  cells: [[{ ratio: 6.94, clears: ['aa-large' as const, 'aa' as const] }]],
}]);

describe('contrastBlockModel', () => {
  it('explains itself when colours exist but none classified', () => {
    const m = contrastBlockModel({ ...empty, unclassified: 12 }, 'Semantic');
    expect(m.kind).toBe('none');
    expect(m.kind === 'none' && m.reason).toContain('12');
  });

  it('explains itself when the collection holds no colours at all', () => {
    const m = contrastBlockModel(empty, 'Spacing');
    expect(m.kind).toBe('none');
    expect(m.kind === 'none' && m.reason).toMatch(/no colour/i);
  });

  it('returns the matrices when there is something to show', () => {
    const m = contrastBlockModel({ ...empty, measured: 1, matrices: oneMatrix() }, 'Semantic');
    expect(m.kind).toBe('matrix');
    expect(m.kind === 'matrix' && m.matrices).toHaveLength(1);
    expect(m.kind === 'matrix' && m.note).toBeNull();
  });

  it('names the omitted count rather than hiding the cap', () => {
    const m = contrastBlockModel(
      { ...empty, measured: 4, omitted: 7, matrices: oneMatrix() }, 'Semantic');
    expect(m.kind === 'matrix' && m.note).toContain('7');
  });

  it('uses no em dash or en dash in any copy', () => {
    const models = [
      contrastBlockModel({ ...empty, unclassified: 3 }, 'Semantic'),
      contrastBlockModel(empty, 'Spacing'),
      contrastBlockModel({ ...empty, measured: 1, omitted: 2, matrices: oneMatrix() }, 'Semantic'),
    ];
    for (const m of models) {
      const text = m.kind === 'none' ? m.reason : (m.note ?? '');
      expect(text).not.toMatch(/[–—]/);
    }
  });
});

describe('cellLabel', () => {
  it('names the strongest bar cleared', () => {
    expect(cellLabel({ ratio: 6.94, clears: ['aa-large', 'aa'] })).toBe('6.94:1 AA');
    expect(cellLabel({ ratio: 21, clears: ['aa-large', 'aa', 'aaa'] })).toBe('21:1 AAA');
  });
  it('says a pair fails when it clears nothing', () => {
    expect(cellLabel({ ratio: 2.23, clears: [] })).toBe('2.23:1 fails');
  });
  it('distinguishes unmeasured from failing', () => {
    expect(cellLabel(null)).toBe('not measured');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/foundationContrast.test.ts`

Expected: FAIL, cannot resolve `../src/foundationContrast`.

- [ ] **Step 3: Write the pure model and the label helper**

Create `packages/plugin/src/foundationContrast.ts`:

```ts
import type { ColorContrastReport, ContrastMatrix } from '@spec-layer/extractor';

/**
 * What the contrast block should draw, decided without touching the Figma API so
 * the decision is testable. The node builder below turns this into frames.
 */
export type ContrastBlockModel =
  | { kind: 'none'; reason: string }
  | { kind: 'matrix'; matrices: ContrastMatrix[]; note: string | null };

/**
 * An empty grid and "no matrix could be built" look identical on a frame and mean
 * opposite things, so the empty case carries its reason instead of drawing a
 * blank grid a reader would take for a clean result.
 */
export function contrastBlockModel(
  report: ColorContrastReport,
  collectionName: string,
): ContrastBlockModel {
  if (report.matrices.length === 0) {
    if (report.unclassified > 0) {
      return {
        kind: 'none',
        reason: `${collectionName} has ${report.unclassified} colours, but none of their `
          + 'names say whether they are drawn on something or drawn under it. Contrast '
          + 'needs pairs, so nothing was measured here. Names containing text, icon, '
          + 'stroke or border, and surface, background, fill, let this pair them up.',
      };
    }
    return { kind: 'none', reason: `${collectionName} holds no colour variables.` };
  }
  const note = report.omitted > 0
    ? `${report.omitted} colours are not shown, to keep the grid readable.`
    : null;
  return { kind: 'matrix', matrices: report.matrices, note };
}

/** A cell reads as its ratio plus the strongest bar it clears. */
export function cellLabel(cell: { ratio: number; clears: string[] } | null): string {
  if (!cell) return 'not measured';
  const strongest = cell.clears[cell.clears.length - 1];
  return strongest ? `${cell.ratio}:1 ${strongest.toUpperCase()}` : `${cell.ratio}:1 fails`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/foundationContrast.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Add the node builder**

Append to `packages/plugin/src/foundationContrast.ts`. Match the conventions already in `foundationFrame.ts`: auto-layout frames, fonts loaded by the caller before any `characters` assignment, and the same 12px block gap.

```ts
const CELL_W = 92;
const LABEL_W = 190;
const ROW_H = 28;

/** Last path segment, so a grid header stays readable at 92px wide. */
function leaf(token: string): string {
  const parts = token.split('/');
  return parts[parts.length - 1] || token;
}

function cellText(value: string, width: number): FrameNode {
  const box = figma.createFrame();
  box.resize(width, ROW_H);
  box.layoutMode = 'HORIZONTAL';
  box.counterAxisAlignItems = 'CENTER';
  box.fills = [];
  const t = figma.createText();
  t.characters = value;
  t.fontSize = 11;
  box.appendChild(t);
  return box;
}

function gridRow(cells: FrameNode[]): FrameNode {
  const row = figma.createFrame();
  row.layoutMode = 'HORIZONTAL';
  row.fills = [];
  row.counterAxisSizingMode = 'AUTO';
  row.primaryAxisSizingMode = 'AUTO';
  for (const c of cells) row.appendChild(c);
  return row;
}

/** One matrix: backgrounds across the top, foregrounds down the side. */
export function matrixFrame(m: ContrastMatrix): FrameNode {
  const wrap = figma.createFrame();
  wrap.name = `Contrast ${m.collection} ${m.mode}`;
  wrap.layoutMode = 'VERTICAL';
  wrap.itemSpacing = 0;
  wrap.fills = [];
  wrap.counterAxisSizingMode = 'AUTO';
  wrap.primaryAxisSizingMode = 'AUTO';

  wrap.appendChild(gridRow([
    cellText('', LABEL_W),
    ...m.backgrounds.map((bg) => cellText(leaf(bg), CELL_W)),
  ]));

  m.foregrounds.forEach((fg, i) => {
    wrap.appendChild(gridRow([
      cellText(leaf(fg), LABEL_W),
      ...m.cells[i].map((cell) => cellText(cellLabel(cell), CELL_W)),
    ]));
  });
  return wrap;
}
```

- [ ] **Step 6: Wire it into the frame builder**

Find where a unit's swatch lists finish and how the existing optional block is threaded:

```bash
grep -n "includeDescriptions\|groupDescriptions" packages/plugin/src/foundationFrame.ts
```

Thread `includeContrast: boolean` and `contrast: ColorContrastReport` through the same parameter path `groupDescriptions` already takes. When `includeContrast` is false, append nothing. When true, call `contrastBlockModel(contrast, content.collectionName)` and either append one `matrixFrame(m)` per matrix plus a text node for `note` when non-null, or a single text node carrying `reason`.

- [ ] **Step 7: Run everything, including the sandbox guard**

Run: `npm test && npm run check:sandbox && npm run check:nul && npx tsc -p tsconfig.base.json --noEmit`

Expected: PASS. `check:sandbox` matters here specifically: this task adds main-thread code, Node tests would pass even with a browser global, and the guard is the only thing that catches it.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin/src/foundationContrast.ts packages/plugin/src/foundationFrame.ts packages/plugin/test/foundationContrast.test.ts
git commit -m "feat(plugin): render the colour contrast matrix on foundation frames" -m "The layout decision is a pure model so it is testable without the Figma API. An empty grid and no-matrix-could-be-built look identical on a frame and mean opposite things, so the empty case carries its reason instead." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

### Task 19: Carry contrast failures in the foundation brief
Task 7 gave the foundation brief its generated prose. This adds the contrast half, now
that Tasks 14-18 have something to report.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (`FoundationBriefOptions`, `foundationBrief`)
- Modify: `packages/plugin/src/ui/actions.ts` (`copyFoundationBrief`)
- Test: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `ColorContrastReport` (Task 16); `FoundationBriefOptions` (Task 7).
- Produces: `FoundationBriefOptions` gains `contrast?: ColorContrastReport`; the brief gains a `contrast` block.

- [ ] **Step 1: Write the failing tests**

```ts
it('carries contrast failures and counts but never the full matrix', () => {
  const brief = foundationBrief(oneCollection(), {
    generatedAt: 'T',
    contrast: {
      measured: 96, unclassified: 4, omitted: 0,
      matrices: [{ collection: 'Primitives', mode: 'Value', foregrounds: ['a'],
                   backgrounds: ['b'], cells: [[{ ratio: 2.23, clears: [] }]] }],
      failures: [{
        collection: 'Primitives', mode: 'Value',
        foreground: { token: 'color/text/on-surface/default', value: '#ffffff' },
        background: { token: 'color/surface/primary/disabled', value: '#a9aeb8' },
        ratio: 2.23, clears: [],
      }],
    },
  }) as Record<string, any>;
  expect(brief.contrast.measured).toBe(96);
  expect(brief.contrast.unclassified).toBe(4);
  expect(brief.contrast.failures).toHaveLength(1);
  // The matrix is for the frame. In a brief it is hundreds of passing cells.
  expect('matrices' in brief.contrast).toBe(false);
});

it('emits the counts even when nothing failed', () => {
  const brief = foundationBrief(oneCollection(), {
    generatedAt: 'T',
    contrast: { measured: 40, unclassified: 0, omitted: 0, matrices: [], failures: [] },
  }) as Record<string, any>;
  // measured tells "checked and clean" apart from "could not check", which an
  // empty failures list alone cannot do.
  expect(brief.contrast.measured).toBe(40);
  expect(brief.contrast.failures).toEqual([]);
});

it('omits contrast entirely when none was computed', () => {
  const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as Record<string, any>;
  expect('contrast' in brief).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t contrast`

Expected: FAIL, `FoundationBriefOptions` has no `contrast` field.

- [ ] **Step 3: Write the implementation**

Add to `FoundationBriefOptions`:

```ts
  /** Computed by colorContrast() at copy time. Absent when the caller did not
   *  compute it, which is not the same as a file having no failures. */
  contrast?: ColorContrastReport;
```

And to `foundationBrief`'s return, before `guidelines`:

```ts
    // Failures and counts only. The matrix belongs on the frame, where a grid is
    // readable; here it would be hundreds of lines of mostly-passing cells.
    // `measured` and `unclassified` keep the distinction a bare list destroys: a
    // short failures list means "checked and mostly clean" only when measured is
    // non-zero, and an empty one with measured zero means nothing was checked.
    contrast: opts.contrast ? {
      measured: opts.contrast.measured,
      unclassified: opts.contrast.unclassified,
      failures: opts.contrast.failures.map((f) => ({
        collection: f.collection, mode: f.mode,
        foreground: f.foreground, background: f.background,
        ratio: f.ratio, clears: f.clears,
      })),
    } : undefined,
```

- [ ] **Step 4: Compute it at the copy site**

In `copyFoundationBrief`, extend the call added in Task 7:

```ts
    const yaml = toYaml(foundationBrief(spec, {
      generatedAt: new Date().toISOString(),
      groupDescriptions,
      contrast: colorContrast(spec),
    }));
```

Import `colorContrast` from `@spec-layer/extractor`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/brief.test.ts packages/plugin/test/actions.test.ts`

Expected: PASS.

- [ ] **Step 6: Run everything and commit**

Run: `npm test && npm run check:sandbox && npm run check:nul && npx tsc -p tsconfig.base.json --noEmit`

```bash
git add packages/extractor packages/plugin/src/ui/actions.ts
git commit -m "feat(extractor,plugin): carry contrast failures in the foundation brief" -m "Failures and counts only: the matrix belongs on the frame where a grid is readable, and in a brief it would be hundreds of mostly-passing cells." -m "measured and unclassified are emitted even when nothing failed, because an empty failures list cannot tell checked-and-clean apart from nothing-was-checked." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: Verify in Figma
Every prior task is pure or unit-tested, and none of them proves the plugin runs. v1 was code-complete, fully reviewed, and never once run in Figma. This task is a release gate, not a follow-up.

**Files:**
- Create: `docs/manual-tests/2026-08-18-copy-for-ai-v2.md`

- [ ] **Step 1: Build and load**

```bash
npm run build && npm run check:sandbox && npm run check:nul && npm test
```

Import the plugin in Figma from `packages/plugin/manifest.json`. Use a file that has a multi-mode colour collection, a collection whose colours carry no role words, and at least one documented component whose label is a nested instance.

- [ ] **Step 2: Walk the checklist, recording the actual result for each line**

Record every result in `docs/manual-tests/2026-08-18-copy-for-ai-v2.md`. A line that cannot be checked is recorded as "not checked", never as a pass.

- [ ] The Accessibility group offers Interactions, Content Considerations and Semantics & Focus, and no Contrast checkbox.
- [ ] A component doc generated before this change rebuilds via Update, and the rebuilt frame has no Contrast section.
- [ ] Existing component docs show "Update available" once (expected: Task 8 changed gap issue ids) and settle after a single Update rather than reporting drift again.
- [ ] Existing foundation docs show NO "Update available". The contrast toggle defaults off and the block is derived, so the hash must not have moved.
- [ ] Turning the contrast toggle on renders the matrix, backgrounds across and foregrounds down, with readable labels at the 92px cell width.
- [ ] A two-mode collection renders one matrix per mode, and the Dark matrix shows Dark values.
- [ ] A collection whose colours carry no role words renders the explanatory text, not an empty grid.
- [ ] A collection with more than 24 classified foregrounds renders the note naming how many were omitted.
- [ ] Copy the foundation brief: it contains `guidelines.group_descriptions` nested by collection, and `contrast.failures` with `measured` and `unclassified`.
- [ ] Copy a component brief and count the lines: 400-500, not 2,700. The Copy toast does not warn about size.
- [ ] The component brief has `tokens.used` and `tokens.bindings`, no `base` or `by_variant`, and no top-level `axes`.
- [ ] `api` shows variants, states and booleans separately, and states does not list `Default`.
- [ ] `typography` carries real metrics rather than a display string.
- [ ] `validation` names the Primary/Large default bound to `color/surface/primary/disabled`.
- [ ] No `contrast:` block; `source.file_key` and `source.file_name` hold real values; `unbound` no longer names a path and property that `tokens.bindings` binds; each entry in `tokens.used` carries `mode`.
- [ ] `guidelines` is the only block containing generated prose, and it carries `origin: generated`.
- [ ] Paste both briefs into an agent in workflow order (foundation first, then component) and confirm it answers a question about the component using the right token names.

- [ ] **Step 3: Commit the record**

```bash
git add docs/manual-tests/2026-08-18-copy-for-ai-v2.md
git commit -m "docs: record the Copy for AI v2 manual Figma pass" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

---

## After this plan

Nothing from the v2 design is deferred. Two things the design explicitly rules out stay
ruled out, and are worth restating so a later reader does not mistake them for gaps:

- **No `implementation_readiness` score, `state_precedence`, `behavior.*`, `content.*` or
  aria recommendations.** All would require generating facts a Figma file cannot prove.
  Generation stays confined to prose the plugin already produces and already renders.
- **No cross-collection contrast pairs.** Confining pairs to one collection is what makes
  per-mode measurement possible; pairing across collections needs a mode correspondence
  that does not exist.

One known limitation this plan does not close, recorded so it is a decision rather than an
oversight: a pair clearing the 3:1 bar but not 4.5:1 (the sample Button's
`text/primary/default` on `light-press`, at 4.22:1) is reported as clearing AA-large and
is not listed as a failure. For a 14px label it is a real AA failure, but a foundation
carries no font size, so it cannot say so. Closing it means a later validator that joins
foundation pairs to the typography a component binds, which is why Task 9 resolves
typography to real metrics rather than a display string.
