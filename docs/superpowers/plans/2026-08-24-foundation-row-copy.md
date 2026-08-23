# Copy for AI on Foundation Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "Copy for AI" dropdown entry to foundation documents in My Library, copying a YAML brief narrowed to that row's variable collection.

**Architecture:** A pure `narrowFoundation` helper in the extractor reduces a `FoundationSpec` to one collection (or to text styles), so the existing `foundationBrief` and `colorContrast` run unmodified on the narrowed result. The doc's stored scope rides the existing `LibraryEntry` message to the UI, which reduces it to a copy target, deliberately discarding the frame-pagination narrowing. A prefetch on entering My Library keeps the copy synchronous.

**Tech Stack:** TypeScript, Vitest, esbuild. Two workspace packages: `@spec-layer/extractor` (pure, Figma-free) and `@spec-layer/plugin` (Figma main thread + iframe UI).

**Spec:** `docs/superpowers/specs/2026-08-23-foundation-row-copy-design.md`

## Global Constraints

- **Never write NUL bytes.** This repo has been bitten three times by NUL-separator idioms in docs and plans that evade lint, tests, and `git diff`. `npm run check:nul` guards `packages/` only. Never use `printf '\0'`, `tr '\n' '\0'`, `xargs -0`, or `find -print0` when producing file content.
- **Plugin UI copy: no em dashes.** Use plain, honest, peer-tone sentences. Rules in `docs/plugin-voice-and-copy.md`.
- **The extractor stays Figma-free.** No `figma.*` and no browser globals in `packages/extractor`. `npm run check:sandbox` scans `dist/main.js` for browser globals that the Figma main thread does not have.
- **Verification command:** `npm run check` (lint, typecheck, check:nul, test, build, check:sandbox). Never verify through a pipe — it masks the exit code.
- **Single test run:** `npx vitest run <path> -t "<test name>"`.
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/extractor/src/foundation.ts` | Pure foundation model | Add `FoundationCopyTarget` + `narrowFoundation` (auto-exported by `export * from './foundation'` in `index.ts`) |
| `packages/extractor/test/narrowFoundation.test.ts` | Narrowing tests | Create |
| `packages/plugin/src/messages.ts` | Main-thread ↔ UI protocol | Add `foundationScope?` to `LibraryEntry` |
| `packages/plugin/src/main.ts` | Library enumeration | Populate `foundationScope` from the retargeted scope |
| `packages/plugin/src/ui/viewModel/library.ts` | Row presentation logic | Make `canCopy` kind-aware |
| `packages/plugin/test/libraryViewModel.test.ts` | Row logic tests | Extend |
| `packages/plugin/test/libraryScreen.test.ts` | Menu markup tests | Extend |
| `packages/plugin/src/ui/actions.ts` | Copy actions | Add `copyFoundationBriefForScope` |
| `packages/plugin/test/copyFoundation.test.ts` | Copy action tests | Extend |
| `packages/plugin/src/ui/ui-vnext.ts` | UI controller | Branch `startLibraryCopy`; prefetch on Library navigation |

`packages/plugin/src/ui/screens/library.ts` needs **no change**: it already renders the menu item from `row.canCopy` alone (`screens/library.ts:167`). Task 3 adds a test locking that in.

---

### Task 1: `narrowFoundation` in the extractor

Pure function, no dependencies on any other task. Reduces a whole-file `FoundationSpec` to the part one library row covers.

**Files:**
- Modify: `packages/extractor/src/foundation.ts` (append after the `FoundationScope` type, near line 108)
- Test: `packages/extractor/test/narrowFoundation.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type FoundationCopyTarget =
    | { target: 'collection'; collectionId: string }
    | { target: 'textStyles' };

  export function narrowFoundation(
    spec: FoundationSpec,
    target: FoundationCopyTarget,
  ): FoundationSpec | null;
  ```
  Returns `null` when the target resolves to nothing (unknown collection id, or a text-styles target in a spec with no text styles). Task 4 consumes both.

- [ ] **Step 1: Write the failing test**

Create `packages/extractor/test/narrowFoundation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildFoundation, narrowFoundation,
  type SerializedFoundation, type RawTextStyle,
} from '../src/foundation';

function textStyle(name: string): RawTextStyle {
  return {
    name, description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
    lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PIXELS', value: 0 },
    paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL',
    textDecoration: 'NONE', boundVariables: {},
  };
}

/**
 * Two collections where Semantic aliases into Primitives, plus five modes on
 * Semantic (one more than MAX_MODE_COLUMNS) and two top-level groups. This is
 * the shape every narrowing rule is stated against.
 */
function dumpTwoCollections(): SerializedFoundation {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-08-24T00:00:00.000Z',
    externals: [],
    textStyles: [textStyle('heading/lg'), textStyle('body/md')],
    collections: [
      {
        id: 'prim', name: 'Primitives', defaultModeId: 'p1',
        modes: [{ modeId: 'p1', name: 'Value' }],
        variables: [
          { id: 'blue500', name: 'color/blue/500', resolvedType: 'COLOR',
            description: '', codeSyntax: {},
            valuesByMode: { p1: { r: 0, g: 0.5, b: 1, a: 1 } } },
        ],
      },
      {
        id: 'sem', name: 'Semantic', defaultModeId: 's1',
        modes: [
          { modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' },
          { modeId: 's3', name: 'HC' }, { modeId: 's4', name: 'Print' },
          { modeId: 's5', name: 'BrandB' },
        ],
        variables: [
          { id: 'bg', name: 'color/bg/brand', resolvedType: 'COLOR',
            description: '', codeSyntax: {},
            valuesByMode: {
              s1: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s2: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s3: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s4: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s5: { type: 'VARIABLE_ALIAS', id: 'blue500' },
            } },
          { id: 'gap', name: 'space/gap', resolvedType: 'FLOAT',
            description: '', codeSyntax: {},
            valuesByMode: { s1: 8, s2: 8, s3: 8, s4: 8, s5: 8 } },
        ],
      },
    ],
  };
}

describe('narrowFoundation — collection target', () => {
  it('keeps only the named collection and drops every text style', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' });
    expect(out).not.toBeNull();
    expect(out!.collections.map((c) => c.name)).toEqual(['Semantic']);
    expect(out!.textStyles).toEqual([]);
  });

  it('keeps every mode and every group, ignoring the frame pagination limits', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' })!;
    // Five modes: one more than MAX_MODE_COLUMNS, which is a frame limit only.
    expect(out.collections[0].modes.map((m) => m.name))
      .toEqual(['Light', 'Dark', 'HC', 'Print', 'BrandB']);
    // Both groups: a split would have put these on separate rows.
    expect(out.collections[0].variables.map((v) => v.name))
      .toEqual(['color/bg/brand', 'space/gap']);
  });

  it('keeps aliases into a dropped collection resolvable', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' })!;
    const value = out.collections[0].variables[0].valuesByMode.s1;
    expect(value.kind).toBe('alias');
    if (value.kind !== 'alias') throw new Error('expected an alias');
    expect(value.targetName).toBe('color/blue/500');
    expect(value.resolved).toEqual({ kind: 'color', hex: '#0080FF', alpha: 1 });
  });

  it('carries file identity through unchanged', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'prim' })!;
    expect(out.fileKey).toBe('FILE1');
    expect(out.extractedAt).toBe('2026-08-24T00:00:00.000Z');
  });

  it('returns null for a collection that is no longer in the file', () => {
    const spec = buildFoundation(dumpTwoCollections());
    expect(narrowFoundation(spec, { target: 'collection', collectionId: 'gone' }))
      .toBeNull();
  });
});

describe('narrowFoundation — text styles target', () => {
  it('keeps every text style and drops every collection', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'textStyles' })!;
    expect(out.collections).toEqual([]);
    expect(out.textStyles.map((t) => t.name)).toEqual(['heading/lg', 'body/md']);
  });

  it('returns null when the file has no text styles left', () => {
    const dump = dumpTwoCollections();
    dump.textStyles = [];
    const spec = buildFoundation(dump);
    expect(narrowFoundation(spec, { target: 'textStyles' })).toBeNull();
  });
});

describe('narrowFoundation — purity', () => {
  it('does not mutate the spec it was given', () => {
    const spec = buildFoundation(dumpTwoCollections());
    narrowFoundation(spec, { target: 'collection', collectionId: 'sem' });
    expect(spec.collections).toHaveLength(2);
    expect(spec.textStyles).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/narrowFoundation.test.ts`
Expected: FAIL. TypeScript/Vitest reports `narrowFoundation` is not exported from `../src/foundation`.

- [ ] **Step 3: Write minimal implementation**

In `packages/extractor/src/foundation.ts`, immediately after the `FoundationScope` type declaration (around line 108, before `SPLIT_THRESHOLD`), add:

```ts
/**
 * What a single Copy-for-AI request covers.
 *
 * Deliberately coarser than FoundationScope, which additionally carries a
 * `group` and a `modeIds` subset. Both of those are artifacts of drawing a
 * frame — modes are capped at MAX_MODE_COLUMNS because a frame has four
 * columns, and a collection over SPLIT_THRESHOLD is divided into one document
 * per group — and the clipboard has neither limit. A copy that inherited them
 * would silently hide modes and whole token families from the agent reading it.
 */
export type FoundationCopyTarget =
  | { target: 'collection'; collectionId: string }
  | { target: 'textStyles' };

/**
 * Reduce a whole-file spec to the part one Copy covers, so foundationBrief and
 * colorContrast can run over it unmodified.
 *
 * Returns null when the target resolves to nothing: a collection deleted since
 * its document was generated, or a text-styles target in a file whose styles
 * are all gone. Null rather than an empty spec, because "there is nothing here
 * any more" is a message the caller must show, not a brief it should copy.
 *
 * Alias values are untouched. They were resolved during buildFoundation, so a
 * variable aliasing into a collection this narrowing drops still carries both
 * its target name and its resolved concrete value.
 */
export function narrowFoundation(
  spec: FoundationSpec,
  target: FoundationCopyTarget,
): FoundationSpec | null {
  if (target.target === 'textStyles') {
    if (spec.textStyles.length === 0) return null;
    return { ...spec, collections: [], textStyles: spec.textStyles };
  }
  const collection = spec.collections.find((c) => c.id === target.collectionId);
  if (!collection) return null;
  return { ...spec, collections: [collection], textStyles: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/narrowFoundation.test.ts`
Expected: PASS, 8 tests.

If the alias test fails on the hex value, read the actual value from the failure output and correct the expectation — `buildFoundation`'s hex formatting is the source of truth, not this plan.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/foundation.ts packages/extractor/test/narrowFoundation.test.ts
git commit -m "$(cat <<'EOF'
feat(extractor): narrow a foundation spec to one copy target

narrowFoundation reduces a whole-file spec to a single collection or to the
text styles, so foundationBrief and colorContrast can run over the result
unmodified.

It ignores the group and modeIds narrowing a FoundationScope carries, since
both come from a frame's four-column cap and its 150-row split rather than
from anything the user chose, and the clipboard has neither limit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Carry the doc's scope to the UI

The UI cannot know which collection a foundation row covers: the scope lives in the section's pluginData, readable only on the main thread.

**Files:**
- Modify: `packages/plugin/src/messages.ts:13-43` (the `LibraryEntry` interface)
- Modify: `packages/plugin/src/main.ts:764-782` (the foundation branch of library enumeration)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `LibraryEntry.foundationScope?: FoundationScope`, read by Tasks 3 and 5.

- [ ] **Step 1: Add the field to the protocol**

In `packages/plugin/src/messages.ts`, extend the first import to include `FoundationScope`:

```ts
import type {
  SerializedNode, SerializedFoundation, FoundationSelection, FoundationScope, ProseDrafts,
} from '@spec-layer/extractor';
```

Then, in `interface LibraryEntry`, directly after the `foundationIcon?: FoundationIconKind;` field, add:

```ts
  /** Foundation rows only: the scope this doc was generated for, already
   *  retargeted to the live collection id the way `foundationIcon` is. Only the
   *  main thread can read it (it lives in the section's pluginData), so it
   *  travels with the entry rather than being re-derived in the UI.
   *
   *  Copy is its only consumer, and it reads only `target` and `collectionId`:
   *  see FoundationCopyTarget for why `group` and `modeIds` are dropped there.
   *
   *  Absent on component rows, and on any entry an older main thread produced,
   *  which is why Copy is withheld rather than guessed at when it is missing. */
  foundationScope?: FoundationScope;
```

- [ ] **Step 2: Populate it on the main thread**

In `packages/plugin/src/main.ts`, in the `entries.push({ … })` call inside the `isFoundationLink(data)` branch, add one line directly after `foundationIcon: scopeIconKind(live, scope),`:

```ts
            // The RETARGETED scope, matching foundationIcon above: a renamed
            // collection resolves to its live id, which is the id Copy has to
            // match against the foundation dump the UI holds.
            foundationScope: scope,
```

- [ ] **Step 3: Verify it typechecks and nothing regressed**

Run: `npm run typecheck`
Expected: exits 0, no output.

Run: `npx vitest run packages/plugin/test/`
Expected: PASS. `foundationScope` is optional, so every existing fixture still satisfies `LibraryEntry`.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/main.ts
git commit -m "$(cat <<'EOF'
feat(plugin): carry a foundation doc's scope to the UI

A foundation LibraryEntry said which glyph to draw but not what the document
covered, so the UI had no way to copy one row's collection.

The scope sent is the retargeted one, matching foundationIcon: a renamed
collection resolves to its live id, which is the id Copy must match against
the foundation dump the UI already holds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Offer Copy on foundation rows

`canCopy` is currently `componentSourceAvailable && status !== 'unavailable'`, which is structurally false for foundation rows because they carry `sourceNodeId: ''`.

**Files:**
- Modify: `packages/plugin/src/ui/viewModel/library.ts:44-53` (the `canCopy` doc comment) and `:195` (the expression)
- Test: `packages/plugin/test/libraryViewModel.test.ts`, `packages/plugin/test/libraryScreen.test.ts`

**Interfaces:**
- Consumes: `LibraryEntry.foundationScope` from Task 2.
- Produces: `LibraryRowModel.canCopy` true for eligible foundation rows. Task 5 relies on the menu item rendering.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/libraryViewModel.test.ts`:

```ts
describe('canCopy on foundation rows', () => {
  function foundationEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
    return entry({
      docId: 'found-1',
      kind: 'foundation',
      label: 'Foundations · Semantic',
      componentName: 'Foundations · Semantic',
      sourceLabel: 'Semantic',
      // A foundation doc has no source node. This is exactly why the old
      // component-shaped canCopy could never be true here.
      sourceNodeId: '',
      foundationIcon: 'mixed',
      foundationScope: {
        target: 'collection', collectionId: 'sem',
        collectionName: 'Semantic', modeIds: ['s1'],
      },
      currentContentHash: 'stored',
      storedContentHash: 'stored',
      ...overrides,
    });
  }

  it('offers Copy on an in-sync foundation row', () => {
    const row = buildLibraryRow(foundationEntry(), { now: NOW });
    expect(row.status).toBe('inSync');
    expect(row.canCopy).toBe(true);
  });

  it('offers Copy on a drifted foundation row, since reading the live source is the point', () => {
    const row = buildLibraryRow(
      foundationEntry({ currentContentHash: 'live', storedContentHash: 'stored' }),
      { now: NOW },
    );
    expect(row.status).toBe('updateAvailable');
    expect(row.canCopy).toBe(true);
  });

  it('withholds Copy when the scope no longer resolves', () => {
    const row = buildLibraryRow(
      foundationEntry({ sourceExists: false }),
      { now: NOW },
    );
    expect(row.status).toBe('orphaned');
    expect(row.canCopy).toBe(false);
  });

  it('withholds Copy when the live read failed', () => {
    const row = buildLibraryRow(
      foundationEntry({ currentContentHash: undefined }),
      { now: NOW },
    );
    expect(row.status).toBe('unavailable');
    expect(row.canCopy).toBe(false);
  });

  it('withholds Copy from an older main thread that sent no scope', () => {
    const older = foundationEntry();
    delete older.foundationScope;
    expect(buildLibraryRow(older, { now: NOW }).canCopy).toBe(false);
  });

  it('leaves component rows unchanged', () => {
    expect(buildLibraryRow(entry(), { now: NOW }).canCopy).toBe(true);
    expect(buildLibraryRow(entry({ sourceNodeId: '' }), { now: NOW }).canCopy).toBe(false);
    expect(buildLibraryRow(entry({ sourceExists: false }), { now: NOW }).canCopy).toBe(false);
  });
});
```

Append to `packages/plugin/test/libraryScreen.test.ts`, inside the same `describe` block that holds the existing "offers Copy for AI on a component row" test:

```ts
  it('offers Copy for AI on a foundation row', () => {
    const foundationRow = row('foundSemantic', 'inSync', {
      kind: 'foundation',
      foundationIcon: 'mixed',
      sourceNodeId: '',
      canOpenSource: false,
      canCopy: true,
    });
    const markup = libraryScrollMarkup(model({
      allRows: [foundationRow],
      rows: [foundationRow],
      counts: { all: 1, updates: 0, inSync: 1 },
      menuDocId: 'foundSemantic',
    }));
    expect(markup).toContain('data-library-action="copy"');
    expect(markup).toContain('Copy for AI');
    // Copy sits in the navigation group beside the frame link, not among the
    // destructive actions.
    expect(markup.indexOf('data-library-action="copy"'))
      .toBeLessThan(markup.indexOf('data-library-action="remove"'));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/libraryViewModel.test.ts packages/plugin/test/libraryScreen.test.ts`
Expected: FAIL. The view-model tests report `canCopy` is `false` where `true` was expected. The screen test fails on the missing `Copy for AI` string.

If the screen test's `row(...)` helper does not accept a `kind` override, read its signature at the top of `libraryScreen.test.ts` and pass the override the way that helper expects.

- [ ] **Step 3: Make canCopy kind-aware**

In `packages/plugin/src/ui/viewModel/library.ts`, replace the `canCopy` doc comment on `LibraryRowModel` (the block starting `/** A COMPONENT row whose source still exists`) with:

```ts
  /**
   * Whether this row offers Copy for AI. Copy never mutates anything, so it
   * does not depend on drift or self-edit status the way canUpdate does:
   * `updateAvailable` and `edited` rows stay copyable, since reading the live
   * (drifted) source is exactly the point for those.
   *
   * Component rows: the source component still exists — the same condition the
   * removed Download action used.
   *
   * Foundation rows: the doc's scope still resolves, and the main thread told
   * us what that scope is. A foundation doc has no source node, so it can never
   * satisfy the component condition and had no Copy at all until this became
   * kind-aware.
   *
   * Both kinds exclude `unavailable`, which means the live read against this
   * source failed. Copy re-reads that same source, so it would very likely fail
   * too, and offering it would promise something that cannot be delivered.
   */
  canCopy: boolean;
```

Then, in `buildLibraryRow`, replace:

```ts
    canCopy: componentSourceAvailable && status !== 'unavailable',
```

with:

```ts
    canCopy: entry.kind === 'foundation'
      // An entry from an older main thread carries no scope. Unlike
      // foundationIcon, which falls back to `mixed`, there is no honest
      // fallback for "which collection": copying the wrong one is worse than
      // not offering, so the row withholds the action.
      ? entry.foundationScope !== undefined
        && status !== 'unavailable'
        && status !== 'orphaned'
      : componentSourceAvailable && status !== 'unavailable',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/libraryViewModel.test.ts packages/plugin/test/libraryScreen.test.ts`
Expected: PASS, including every pre-existing test in both files.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/viewModel/library.ts packages/plugin/test/libraryViewModel.test.ts packages/plugin/test/libraryScreen.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin): offer Copy for AI on foundation library rows

canCopy required a component source node, which a foundation doc never has:
its source is the file's own collections, addressed by scope. The one screen
listing a user's foundation documents was the one screen they could not be
copied from.

A row with no scope withholds the action rather than guessing. foundationIcon
can fall back to `mixed`, but there is no honest fallback for "which
collection", and copying the wrong one is worse than not offering.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The scoped copy action

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts` (add after `copyFoundationBrief`, around line 733)
- Test: `packages/plugin/test/copyFoundation.test.ts`

**Interfaces:**
- Consumes: `narrowFoundation`, `FoundationCopyTarget` (Task 1); `FoundationScope` (Task 2).
- Produces:
  ```ts
  export async function copyFoundationBriefForScope(
    scope: FoundationScope,
    ui: BuildPresenter,
  ): Promise<void>;
  ```
  Task 5 calls this.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/copyFoundation.test.ts`. Add `copyFoundationBriefForScope` to the existing import of `../src/ui/actions` at the top of the file, then append:

```ts
describe('copyFoundationBriefForScope', () => {
  /** Two collections plus a text style, so narrowing has something to drop. */
  const TWO: SerializedFoundation = {
    fileKey: 'F1',
    extractedAt: '2026-08-24T00:00:00.000Z',
    externals: [],
    textStyles: [{
      name: 'heading/lg', description: '', fontFamily: 'Inter', fontStyle: 'Regular',
      fontSize: 32, lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 }, paragraphSpacing: 0,
      paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: {},
    }],
    collections: [
      {
        id: 'C1', name: 'Color', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Light' }],
        variables: [{
          id: 'V1', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
          codeSyntax: {}, valuesByMode: { m1: { r: 0.14, g: 0.39, b: 0.92, a: 1 } },
        }],
      },
      {
        id: 'C2', name: 'Spacing', defaultModeId: 'n1',
        modes: [{ modeId: 'n1', name: 'Value' }],
        variables: [{
          id: 'V2', name: 'space/gap', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, valuesByMode: { n1: 8 },
        }],
      },
    ],
  };

  const COLOR_SCOPE = {
    target: 'collection' as const, collectionId: 'C1',
    collectionName: 'Color', modeIds: ['m1'],
  };

  function parse(): ParsedFoundationBrief {
    return load(copyText.mock.calls[0][0] as string) as ParsedFoundationBrief;
  }

  it('copies only the scoped collection', async () => {
    onFoundationMessage(TWO);
    const ui = presenter();
    await copyFoundationBriefForScope(COLOR_SCOPE, ui);
    const brief = parse();
    expect(brief.collections).toHaveLength(1);
    expect(brief.collections[0].tokens.map((t) => t.name)).toEqual(['color/bg/brand']);
    expect(ui.info).toHaveBeenCalled();
    expect(ui.error).not.toHaveBeenCalled();
  });

  it('ignores the group and mode narrowing the scope carries', async () => {
    onFoundationMessage(TWO);
    await copyFoundationBriefForScope(
      { ...COLOR_SCOPE, group: 'nonexistent', modeIds: [] },
      presenter(),
    );
    const brief = parse();
    expect(brief.collections[0].tokens.map((t) => t.name)).toEqual(['color/bg/brand']);
  });

  it('copies every text style for a text styles scope', async () => {
    onFoundationMessage(TWO);
    await copyFoundationBriefForScope({ target: 'textStyles' }, presenter());
    const brief = parse();
    expect(brief.collections).toEqual([]);
  });

  it('passes only the scoped collection\'s group descriptions', async () => {
    onFoundationMessage(TWO);
    setFoundationGroupDescriptions({
      Color: { color: 'Surface and text colours.' },
      Spacing: { space: 'The 8px scale.' },
    });
    await copyFoundationBriefForScope(COLOR_SCOPE, presenter());
    const brief = parse();
    expect(brief.guidelines?.group_descriptions).toEqual({
      Color: { color: 'Surface and text colours.' },
    });
  });

  it('refuses when no foundation has been read', async () => {
    const ui = presenter();
    await copyFoundationBriefForScope(COLOR_SCOPE, ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith(
      "Still reading this file's variables. Try again in a moment.",
    );
  });

  it('refuses when the collection is gone from the file', async () => {
    onFoundationMessage(TWO);
    const ui = presenter();
    await copyFoundationBriefForScope({ ...COLOR_SCOPE, collectionId: 'GONE' }, ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith(
      'That collection is no longer in this file. Nothing was copied.',
    );
  });

  it('leaves the whole-file copy covering every collection', async () => {
    onFoundationMessage(TWO);
    await copyFoundationBrief(presenter());
    expect(parse().collections).toHaveLength(2);
  });
});
```

The `describe` block needs `onFoundationMessage` reset between tests. The file's existing `beforeEach` resets the clipboard mocks; add this line to it so a spec set by one test does not leak into the "no foundation has been read" test:

```ts
  resetFoundationForTest();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/copyFoundation.test.ts`
Expected: FAIL. `copyFoundationBriefForScope` and `resetFoundationForTest` are not exported from `../src/ui/actions`.

- [ ] **Step 3: Write the implementation**

In `packages/plugin/src/ui/actions.ts`, extend the existing `@spec-layer/extractor` import to include `narrowFoundation`, and its type import to include `FoundationScope` and `FoundationCopyTarget`.

Add after `copyFoundationBrief` (after its closing brace, around line 733):

```ts
/**
 * Reduce a document's stored scope to what a Copy covers.
 *
 * This is the ONE place `group` and `modeIds` are dropped. They exist because a
 * frame renders at most MAX_MODE_COLUMNS columns and splits above
 * SPLIT_THRESHOLD rows; the clipboard has neither limit, and inheriting them
 * would hide whole token families and modes from the agent reading the brief.
 * Do not "restore fidelity" here: the widening is the intent.
 */
function copyTargetOf(scope: FoundationScope): FoundationCopyTarget {
  return scope.target === 'collection'
    ? { target: 'collection', collectionId: scope.collectionId }
    : { target: 'textStyles' };
}

/**
 * Copy one library row's foundation as a YAML brief.
 *
 * The sibling of copyFoundationBrief, which covers the whole file. Two
 * functions rather than one with a flag: the whole-file path's "deliberately
 * ignores the scope selection" reasoning is a doctrine for a file-wide screen,
 * and it should not acquire an escape hatch.
 *
 * Aliases into collections this narrowing drops still carry their resolved
 * concrete values, since resolution happened in buildFoundation, upstream of
 * any narrowing. That is what makes a scoped brief safe to hand an agent.
 */
export async function copyFoundationBriefForScope(
  scope: FoundationScope,
  ui: BuildPresenter,
): Promise<void> {
  ui.clear();
  const spec = currentFoundationSpec();
  if (!spec) {
    // Not "read the foundations first": from My Library that names a remedy on
    // another screen. The Library view asks for the dump on entry, so this is a
    // sub-second race or a read that failed, and both resolve by retrying.
    ui.error("Still reading this file's variables. Try again in a moment.");
    return;
  }
  const narrowed = narrowFoundation(spec, copyTargetOf(scope));
  if (!narrowed) {
    ui.error(scope.target === 'collection'
      ? 'That collection is no longer in this file. Nothing was copied.'
      : 'This file has no text styles left. Nothing was copied.');
    return;
  }
  try {
    // Filtered, not passed whole: group descriptions are keyed by collection
    // name, and a brief covering one collection must not carry another's
    // guidelines. A text styles copy gets none, since these describe variable
    // folders.
    const groupDescriptions = scope.target === 'collection'
      ? Object.fromEntries(
          Object.entries(foundationGroupDescriptions)
            .filter(([name]) => name === scope.collectionName),
        )
      : {};
    const yaml = toYaml(foundationBrief(narrowed, {
      generatedAt: new Date().toISOString(),
      groupDescriptions,
      // Measured on the NARROWED spec, so the pairs reported are the ones
      // inside this collection. colorContrast already scopes per collection,
      // so this needs no argument of its own.
      contrast: colorContrast(narrowed),
    }));
    const lines = yaml.split('\n').length;
    const size = lines > 800 ? ` ${lines} lines, which is large for some chat windows.` : '';
    const tier = await copyText(yaml);
    if (tier === 'manual') {
      renderManualCopyModal(yaml, size.trim() || undefined);
      return;
    }
    ui.info(`Copied.${size}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Could not read the foundations. Nothing was copied. ${msg}`);
  }
}

/** Test-only: clear the module-level foundation state between cases, so a spec
 *  set by one test cannot satisfy another test's "nothing has been read" path. */
export function resetFoundationForTest(): void {
  foundationSpec = null;
  foundationGroupDescriptions = {};
}
```

The group-description filter reads `scope.collectionName`, which is why `copyTargetOf` narrows separately: the target carries the id used for matching variables, and the scope still carries the name used for matching descriptions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/copyFoundation.test.ts`
Expected: PASS, including the pre-existing `copyFoundationBrief` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/test/copyFoundation.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin): copy one foundation row's collection as a brief

The sibling of copyFoundationBrief, which stays whole-file. Two functions
rather than one with a flag, so the whole-file path's "deliberately ignores
the scope selection" doctrine does not acquire an escape hatch.

Contrast is measured on the narrowed spec and group descriptions are filtered
to the scoped collection, so a brief covering one collection never carries
another's findings or guidelines.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire the click, and prefetch the dump

Two changes in the controller: dispatch a foundation row's Copy to the new action, and ask for the foundation dump when the Library view opens so the copy stays synchronous.

The prefetch matters for more than latency. An awaited main-thread round trip between the click and `copyText` destroys the user-gesture call stack, which is the exact tier-2 failure `clipboard.ts:9` documents; without the prefetch every cold copy would fall to the tier-3 manual modal.

**Files:**
- Modify: `packages/plugin/src/ui/ui-vnext.ts:355-370` (`navigateToView`) and `:826-834` (`startLibraryCopy`)

**Interfaces:**
- Consumes: `copyFoundationBriefForScope` (Task 4), `LibraryEntry.foundationScope` (Task 2), `canCopy` (Task 3).
- Produces: nothing downstream.

- [ ] **Step 1: Reuse the existing request guard for the prefetch**

In `packages/plugin/src/ui/ui-vnext.ts`, add a function directly after `refreshFoundations()` (around line 557):

```ts
/**
 * Ask for the foundation dump when Library opens, if nothing has fetched it
 * yet, so a foundation row's Copy can build its brief without a round trip.
 *
 * Copy needs the dump, and the two things that normally supply it may both be
 * absent here: the Foundations tab may never have been opened, and the
 * 'selection' message only carries a dump when a COMPONENT is selected, so
 * opening the plugin with nothing selected leaves the UI with no spec at all.
 *
 * Reuses foundationRequested rather than adding a second flag. On success the
 * 'foundation' reply sets the Foundations screen to 'ready' as well, so
 * skipping its own request later is correct; on failure 'foundationError'
 * clears the flag, so navigating there re-requests and resets to loading.
 */
function prefetchFoundationsForCopy(): void {
  if (foundationRequested || currentFoundationSpec()) return;
  foundationRequested = true;
  send({ type: 'requestFoundation' });
}
```

Then in `navigateToView`, change:

```ts
  if (view === 'library' && options.refreshLibrary !== false) refreshLibrary();
```

to:

```ts
  if (view === 'library') {
    if (options.refreshLibrary !== false) refreshLibrary();
    // Unconditional: the dump is needed whether or not the entry list is being
    // refreshed, and the guard inside makes repeat visits free.
    prefetchFoundationsForCopy();
  }
```

Confirm `currentFoundationSpec` is already imported from `./actions` in this file; it is used by `buildFoundations`. If it is not in the import list, add it.

- [ ] **Step 2: Branch the copy dispatch**

Replace `startLibraryCopy` in full:

```ts
/**
 * Copy for AI.
 *
 * Component rows need a round trip: the brief needs both the stored prose and
 * the doc's source, so this asks for prose first (cheap: a single pluginData
 * read) and only sends requestDocSource once the docProse reply lands and is
 * stashed on the operation. The docSource handler reads that prose back off,
 * builds the brief, and clears the operation on every exit.
 *
 * Foundation rows need none of that. The whole file's variables are already in
 * memory (the Library view asks for them on entry), and the doc's scope rode in
 * on its LibraryEntry, so the copy is synchronous. It deliberately does NOT
 * take the operation lock: there is nothing to wait for, and holding the lock
 * would block an unrelated Update behind an act that has already finished.
 */
function startLibraryCopy(docId: string): void {
  const entry = libraryEntry(docId);
  if (!entry) return;

  if (entry.kind === 'foundation') {
    // Withheld by canCopy, so this is a guard against a stale menu rather than
    // a path a user can reach by clicking.
    if (!entry.foundationScope) return;
    void copyFoundationBriefForScope(entry.foundationScope, copyPresenter());
    return;
  }

  if (entry.kind !== 'component' || !entry.sourceExists || operation.active) return;
  if (!beginOperation(operation)) return;
  libraryOperation = { kind: 'copy', currentDocId: docId };
  paint();
  // Prose first: the brief needs it, and it is a cheap pluginData read.
  send({ type: 'requestDocProse', docId });
}
```

Add `copyFoundationBriefForScope` to the existing import block from `./actions` at the top of the file (the one that already imports `onFoundationMessage`, around line 91).

- [ ] **Step 3: Verify the whole suite and the build**

Run: `npm run check`
Expected: exits 0. Lint clean, typecheck clean, no NUL bytes, all tests pass, plugin builds, sandbox scan clean.

Do not pipe this command anywhere. Piping masks the exit code, which has hidden a red result in this repo before.

If `check:sandbox` fails, the cause is a browser global reaching `dist/main.js`. Nothing in this task should touch main-thread code beyond Task 2's single field, so re-read that change before anything else.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/ui/ui-vnext.ts
git commit -m "$(cat <<'EOF'
feat(plugin): wire Copy for AI on foundation rows

A foundation row copies synchronously: its collection is already in memory and
its scope rode in on the LibraryEntry. It takes no operation lock, since there
is nothing to wait for and holding one would block an unrelated Update behind
an act that has already finished.

Library entry now prefetches the foundation dump. Without it the first copy in
a session would have to await a round trip, and an await between the click and
the clipboard write destroys the user-gesture call stack that tier 2 needs,
dropping every cold copy to the manual paste modal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Manual verification in Figma

Every automated check above runs against fixtures. This feature has never been exercised in a real Figma file, and the plugin's main thread has no browser globals despite Node tests passing, so a green suite is necessary but not sufficient.

Build with `npm run build:plugin`, load the plugin in a file that has at least two variable collections (one aliasing into the other) and some text styles, then confirm:

- [ ] Generate foundation docs for two collections, open My Library, and confirm each foundation row's menu shows "Copy for AI" in the same position as a component row's.
- [ ] **Open the plugin fresh with nothing selected, go straight to My Library, and copy a foundation row.** This is the path the prefetch exists for: it must copy on the first click, with a "Copied." toast and no manual-paste modal.
- [ ] Paste, and confirm the YAML holds only that collection, with every mode present including any beyond the fourth.
- [ ] In a collection that aliases into another, confirm the pasted aliases carry both `alias:` and `resolved:`.
- [ ] Copy a text-styles row and confirm it holds the text styles and no collections.
- [ ] Delete a documented collection, refresh the library, and confirm the row no longer offers Copy.
- [ ] Confirm the Foundations screen footer button still copies every collection.

## Self-Review

**Spec coverage.** Design section 1 (scope travels with the entry) is Task 2. Section 2 (narrowing in the extractor) is Task 1. Section 3 (filtered group descriptions) is Task 4, step 3. Section 4 (a new action beside the existing one) is Task 4. Section 5 (cold-read path) is Task 5, step 1. Section 6 (gating) is Task 3. The spec's testing section maps onto Tasks 1, 3, and 4; its "what this does not change" claims are locked by the `copyFoundationBrief` regression test in Task 4 and the untouched screen file noted in File Structure.

**Type consistency.** `narrowFoundation(spec, target)` returns `FoundationSpec | null` in Task 1 and is consumed as nullable in Task 4. `FoundationCopyTarget` is produced in Task 1 and constructed only by `copyTargetOf` in Task 4. `foundationScope` is optional in Task 2 and guarded before use in Tasks 3 and 5. `copyFoundationBriefForScope(scope, ui)` takes a `FoundationScope`, not a `FoundationCopyTarget`, in both Task 4 and Task 5.

**Known imprecision.** Two expectations depend on code this plan did not read line by line: the resolved hex in Task 1's alias test, and the `row(...)` helper signature in Task 3's screen test. Both steps say to read the actual value or signature and correct the expectation rather than bending the implementation to match the plan.
