# Review Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land items 1 to 11 of `docs/reviews/2026-09-05-major-review.md`: push `main`, prepare and run the manual Figma matrix, commit the strategy document, then eight small speed, UX, and clipboard changes.

**Architecture:** Phase A works on `main` and ends with the user running the Figma matrix. Phase B lands eight independent changes on branch `review-quick-wins`, one conventional commit per item, then merges to `main` after `npm run check`. Every new piece of logic lives in a small Figma-free module with its own test; `main.ts` and `ui-vnext.ts` only gain call sites, since neither is unit-tested.

**Tech Stack:** TypeScript, Vitest (happy-dom for DOM tests), esbuild, Figma Plugin API typings 1.128.0, npm workspaces, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-05-review-quick-wins-design.md`

## Global Constraints

- No extraction hash, `EXTRACTOR_VERSION`, JSON schema, or v5 contract changes. If a step would move `specContentHash`, `foundationContentHash`, or `semanticContentHash`, stop and report.
- `packages/extractor` stays Figma-free. New plugin modules that read Figma take the API as an injected structural parameter so tests can fake it.
- The main thread has no browser globals. New `packages/plugin/src/*.ts` files outside `ui/` must not reference `window`, `document`, `TextEncoder`, or `fetch`. `npm run check:sandbox` is the gate.
- Plugin UI copy: sentence case, second person, no em dashes anywhere in `packages/plugin/src`, no hype words. See `docs/plugin-voice-and-copy.md`.
- Never fabricate: an unknown is `null`, absent, or a stated diagnostic.
- Commits: single line, lowercase, conventional, scoped, e.g. `fix(plugin): ...`, `perf(plugin): ...`, `docs: ...`, ending with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- Every behaviour change adds a line under `## [Unreleased]` in `CHANGELOG.md`, in the `### Added` (line 9) or `### Changed` (line 220) section.
- Run tests with `npx vitest run <path>` for one file and `npm test` for all. `npm run check` is the full local gate.
- Never verify a gate through a pipe that swallows the exit code. Read the status directly.
- Do not use `localeCompare` anywhere new.

---

## Phase A: on `main`, before the matrix run

### Task 1: Push `main`, commit the strategy document, add confirmation rows, scaffold the run notes

**Files:**
- Modify: `docs/strategy/2026-09-02-design-conformance-pivot.md:4`
- Modify: `packages/plugin/TESTING.md:225-226` (Library row 10)
- Create: `docs/reviews/2026-09-05-matrix-run.md`

**Interfaces:**
- Produces: a pushed `main`, a tracked strategy document, TESTING.md rows the matrix run and Phase B Task 6 both rely on, and a notes file the user fills in.

- [ ] **Step 1: Push `main`**

Run:
```bash
git -C "/Users/sandrolek/Documents/Projects/Design System Docs" push origin main
```
Expected: the push completes and `git status -sb` shows `## main...origin/main` with no `ahead` count.

- [ ] **Step 2: Set the strategy document's status line**

Replace line 4 of `docs/strategy/2026-09-02-design-conformance-pivot.md`, which currently begins `**Status:** Proposal. Not committed direction.`, with:

```markdown
**Status:** Proposal, decision deferred. Not committed direction. Supersedes the open question at the end of `2026-06-22-positioning-and-pivot.md` with a concrete answer and a change list.
```

- [ ] **Step 3: Add the confirmation rows to TESTING.md**

In `packages/plugin/TESTING.md`, replace Library row 10:

```markdown
10. **Detach documentation** leaves the canvas Section but removes its Library
    connection. **Remove connection** performs the confirmed cleanup.
```

with:

```markdown
10. **Detach documentation** first asks for confirmation. Confirm the dialog is
    visible, Cancel leaves the row unchanged, and accepting leaves the canvas
    Section in place while removing its Library connection. **Remove
    connection** asks the same way and performs the cleanup only on accept.
    Also confirm that **Update documentation** on a row marked **Manually
    edited** shows its confirmation and that **Update all** with an edited
    row shows one confirmation naming how many documents have hand edits.
    If any of these actions runs without a dialog, or does nothing at all,
    record it in the run notes: a sandboxed iframe can make `window.confirm`
    return false silently.
```

- [ ] **Step 4: Scaffold the matrix run notes**

Create `docs/reviews/2026-09-05-matrix-run.md`:

```markdown
# Manual Figma matrix run (2026-09-05 review)

**Build:** `main` at `<commit>` built with `npm run build:plugin`.
**Figma:** desktop app version `<version>`, macOS.
**Test file:** `<synthetic file name>`, `<n>` variables in `<n>` collections,
`<n>` text styles, `<n>` component sets.

Follow `packages/plugin/TESTING.md` in its pre-merge order and record each
section's result below. Then answer the three review questions.

## Section results

| TESTING.md section | Result | Notes |
|---|---|---|
| Generate component docs | | |
| Generate Foundation docs | | |
| Foundation Context v5 Copy matrix | | |
| Doc frame content | | |
| Library | | |
| AI-writing allowance (free plan) | | |
| License | | |
| Publish and pull | | |
| Settings, search, keyboard, and visuals | | |

## Three questions the review could not answer

### 1. Does `window.confirm` show a dialog in the plugin iframe?

Run Library row 10. For each of Detach, Remove, Update of a hand-edited doc,
and Update all with an edited row, record: dialog visible (yes/no), Cancel
honoured (yes/no), Accept honoured (yes/no).

| Action | Dialog visible | Cancel honoured | Accept honoured |
|---|---|---|---|
| Detach | | | |
| Remove | | | |
| Update, hand-edited | | | |
| Update all, edited rows | | | |

### 2. How often does the non-component toast fire in normal use?

With the plugin open, click through a normal editing minute: frames, text,
one of the plugin's own documentation Sections, then back to a component.
Count how many times `Select a component or component set` appears.

Count: `<n>` in `<n>` clicks. Did it obscure anything you were reading? `<yes/no>`

### 3. What is the real size and paste behaviour of the DTCG clipboard?

Run Generate Foundation docs row 4 on the largest real file available.

| Measure | Value |
|---|---|
| Variables in file | |
| Lines copied | |
| Bytes copied (paste into a file, check its size) | |
| Time from click to "Copied." toast | |
| Pasted cleanly into a plain text editor | |
| Pasted cleanly into a chat window (which one) | |
| Manual-copy modal appeared instead of a toast | |

## Regressions found

List anything that failed, with the TESTING.md row number and what happened.
```

- [ ] **Step 5: Verify docs carry no NUL bytes and commit**

Run (`npm run check:nul` guards `packages/` only, and macOS BSD grep has no `-P`, so count NUL bytes with Node):
```bash
cd "/Users/sandrolek/Documents/Projects/Design System Docs" && node -e 'for (const f of process.argv.slice(1)) console.log(require("fs").readFileSync(f).filter((b) => b === 0).length, f)' docs/strategy/2026-09-02-design-conformance-pivot.md docs/reviews/2026-09-05-matrix-run.md packages/plugin/TESTING.md docs/reviews/2026-09-05-major-review.md
```
Expected: every line starts with `0`.

Then:
```bash
git add docs/strategy/2026-09-02-design-conformance-pivot.md docs/reviews/2026-09-05-major-review.md docs/reviews/2026-09-05-matrix-run.md packages/plugin/TESTING.md
git commit -m "docs: track the conformance strategy, the 2026-09-05 review, and the matrix run notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 6: Hand off to the user**

Tell the user: build with `npm run build:plugin`, import `packages/plugin/manifest.json` as a development plugin, walk `packages/plugin/TESTING.md`, and fill in `docs/reviews/2026-09-05-matrix-run.md`. Phase B does not wait on the result, but the notes decide which Phase B TESTING.md rows the second pass repeats.

---

## Phase B: branch `review-quick-wins`

### Task 2: Memoize resolver lookups per serialization pass

**Files:**
- Create: `packages/plugin/src/resolverMemo.ts`
- Create: `packages/plugin/test/resolverMemo.test.ts`
- Modify: `packages/plugin/src/main.ts:285`, `:1315`, `:1375`, `:1418` (the four `serializeNode(... , resolver)` calls)
- Modify: `CHANGELOG.md` under `### Changed`

**Interfaces:**
- Consumes: `NodeResolver` from `packages/plugin/src/serialize.ts:71-75`, with `variable(id)`, `style(id)`, `mainComponent(node)`.
- Produces: `memoizedResolver(base: NodeResolver): NodeResolver`.

- [ ] **Step 1: Create the branch**

```bash
cd "/Users/sandrolek/Documents/Projects/Design System Docs" && git checkout -b review-quick-wins main
```

- [ ] **Step 2: Write the failing test**

Create `packages/plugin/test/resolverMemo.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { memoizedResolver } from '../src/resolverMemo';
import type { NodeResolver } from '../src/serialize';

function base() {
  const resolver: NodeResolver = {
    variable: vi.fn(async (id: string) =>
      id === 'missing' ? null : { id, name: `var ${id}`, remote: false, collectionId: 'c1' }),
    style: vi.fn(async (id: string) =>
      id === 'missing' ? null : { id, name: `style ${id}`, remote: false, kind: 'paint-style' as const }),
    mainComponent: vi.fn(async () => ({ name: 'Main', key: 'k' })),
  };
  return resolver;
}

describe('memoizedResolver', () => {
  it('asks the base once per distinct variable id', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    const [a1, a2, c1] = await Promise.all([memo.variable('a'), memo.variable('a'), memo.variable('c')]);
    await memo.variable('a');
    expect(b.variable).toHaveBeenCalledTimes(2);
    expect(a1).toEqual(a2);
    expect(c1?.name).toBe('var c');
  });

  it('asks the base once per distinct style id', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    await memo.style('s');
    await memo.style('s');
    await memo.style('t');
    expect(b.style).toHaveBeenCalledTimes(2);
  });

  it('caches a null answer so a missing id is not re-asked', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    expect(await memo.variable('missing')).toBeNull();
    expect(await memo.variable('missing')).toBeNull();
    expect(b.variable).toHaveBeenCalledTimes(1);
  });

  it('keeps variable and style caches apart', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    await memo.variable('same');
    await memo.style('same');
    expect(b.variable).toHaveBeenCalledTimes(1);
    expect(b.style).toHaveBeenCalledTimes(1);
  });

  it('passes mainComponent through untouched', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    const node = {};
    await memo.mainComponent(node);
    await memo.mainComponent(node);
    expect(b.mainComponent).toHaveBeenCalledTimes(2);
    expect(b.mainComponent).toHaveBeenCalledWith(node);
  });

  it('does not share a cache between two wrappers', async () => {
    const b = base();
    await memoizedResolver(b).variable('a');
    await memoizedResolver(b).variable('a');
    expect(b.variable).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/resolverMemo.test.ts`
Expected: FAIL, cannot find module `../src/resolverMemo`.

- [ ] **Step 4: Write the module**

Create `packages/plugin/src/resolverMemo.ts`:

```ts
import type { NodeResolver } from './serialize';

/**
 * One answer per id for the life of one serialization pass.
 *
 * serializeNode awaits resolver.variable(id) for every binding on every node
 * in every variant, so a component set that binds the same few dozen
 * variables across forty variants makes hundreds of Figma round trips for a
 * few dozen distinct ids. Caching the PROMISE (not the value) means the
 * second request for an id joins the first in flight instead of starting
 * another. Null is cached too: the base resolver already turns failures into
 * null, and a pass must see one answer per id, not a retry.
 *
 * mainComponent is keyed by a node object, not an id, so it passes through.
 * The cache dies with the wrapper; create one per pass, never one per session,
 * or a rename between two selections would serve the old name.
 */
export function memoizedResolver(base: NodeResolver): NodeResolver {
  const variables = new Map<string, ReturnType<NodeResolver['variable']>>();
  const styles = new Map<string, ReturnType<NodeResolver['style']>>();
  return {
    variable(id) {
      let pending = variables.get(id);
      if (!pending) {
        pending = base.variable(id);
        variables.set(id, pending);
      }
      return pending;
    },
    style(id) {
      let pending = styles.get(id);
      if (!pending) {
        pending = base.style(id);
        styles.set(id, pending);
      }
      return pending;
    },
    mainComponent(node) {
      return base.mainComponent(node);
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/resolverMemo.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wrap the four call sites in `main.ts`**

Add to the imports at the top of `packages/plugin/src/main.ts`, after the `./serialize` imports:

```ts
import { memoizedResolver } from './resolverMemo';
```

In `postSelection` (around line 285), change:
```ts
    const node = await serializeNode(component as any, resolver);
```
to:
```ts
    const node = await serializeNode(component as any, memoizedResolver(resolver));
```

In `case 'requestDrift'` (around line 1315), change:
```ts
        const node = await serializeNode(src as any, resolver);
```
to:
```ts
        const node = await serializeNode(src as any, memoizedResolver(resolver));
```

In `case 'requestDocSource'` (around line 1375), make the same one-line change.

In `case 'requestPublishSources'` (around line 1418), one wrapper is shared across the whole loop because every component in one file binds the same few dozen variables. Directly before `for (const docId of reg.docIds) {`, add:

```ts
        // One memo for the whole publish pass: every doc in a file binds the
        // same few dozen variables, so per-doc caches would refetch them.
        const passResolver = memoizedResolver(resolver);
```

and change the loop's call to:
```ts
            const node = await serializeNode(src as any, passResolver);
```

- [ ] **Step 7: Typecheck, lint, build, sandbox scan**

Run:
```bash
npm run typecheck && npm run lint && npm run build:plugin && npm run check:sandbox
```
Expected: all four exit 0.

- [ ] **Step 8: Changelog and commit**

Add under `### Changed` in `CHANGELOG.md` `[Unreleased]`:

```markdown
- The plugin asks Figma once per distinct variable or style id during a
  component read, instead of once per binding occurrence. A component set
  binding the same tokens across many variants now makes a few dozen lookups
  rather than hundreds. Output is unchanged.
```

```bash
git add packages/plugin/src/resolverMemo.ts packages/plugin/test/resolverMemo.test.ts packages/plugin/src/main.ts CHANGELOG.md
git commit -m "perf(plugin): memoize resolver lookups per serialization pass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Bulk-read local variables in the foundation reader

**Files:**
- Create: `packages/plugin/src/foundationReader.ts`
- Create: `packages/plugin/test/foundationReader.test.ts`
- Modify: `packages/plugin/src/main.ts:96-180` (remove `publishStatusOf` and `foundationReader`), and the five `serializeFoundation(foundationReader, ...)` calls at lines 206, 792, 894, 952, 1140
- Modify: `CHANGELOG.md` under `### Changed`

**Interfaces:**
- Consumes: `FoundationReader`, `ReaderCollection`, `ReaderVariable`, `ReaderTextStyle`, `ReaderEffectStyle` from `packages/plugin/src/serializeFoundation.ts:17-73`. `RawEffect` from `@spec-layer/extractor`.
- Produces: `createFoundationReader(variables: VariablesSource, styles: StylesSource): FoundationReader`, one instance per `serializeFoundation` pass.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/foundationReader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  createFoundationReader,
  type VariablesSource,
  type StylesSource,
  type VariableSource,
} from '../src/foundationReader';

function variable(id: string, over: Partial<VariableSource> = {}): VariableSource {
  return {
    id, name: `color/${id}`, resolvedType: 'COLOR', description: '',
    variableCollectionId: 'c1', codeSyntax: { WEB: `--${id}` },
    valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
    scopes: ['ALL_SCOPES'], remote: false, hiddenFromPublishing: false,
    getPublishStatusAsync: async () => 'CURRENT',
    ...over,
  };
}

function fakes(locals: VariableSource[], byId: Record<string, VariableSource> = {}) {
  const variables: VariablesSource = {
    getLocalVariableCollectionsAsync: vi.fn(async () => []),
    getLocalVariablesAsync: vi.fn(async () => locals),
    getVariableByIdAsync: vi.fn(async (id: string) => byId[id] ?? null),
    getVariableCollectionByIdAsync: vi.fn(async () => null),
  };
  const styles: StylesSource = {
    getLocalTextStylesAsync: vi.fn(async () => []),
    getLocalEffectStylesAsync: vi.fn(async () => []),
  };
  return { variables, styles };
}

describe('createFoundationReader', () => {
  it('reads every local variable in one call and serves lookups from it', async () => {
    const { variables, styles } = fakes([variable('a'), variable('b')]);
    const reader = createFoundationReader(variables, styles);
    const [a, b, a2] = await Promise.all([reader.variable('a'), reader.variable('b'), reader.variable('a')]);
    expect(a?.name).toBe('color/a');
    expect(b?.name).toBe('color/b');
    expect(a2?.codeSyntax).toEqual({ WEB: '--a' });
    expect(variables.getLocalVariablesAsync).toHaveBeenCalledTimes(1);
    expect(variables.getVariableByIdAsync).not.toHaveBeenCalled();
  });

  it('falls back to a per-id read for an id the bulk read did not return', async () => {
    const { variables, styles } = fakes([variable('a')], { late: variable('late') });
    const reader = createFoundationReader(variables, styles);
    expect((await reader.variable('late'))?.name).toBe('color/late');
    expect(variables.getVariableByIdAsync).toHaveBeenCalledWith('late');
    expect(await reader.variable('gone')).toBeNull();
  });

  it('falls back per id when the bulk read itself fails', async () => {
    const { variables, styles } = fakes([], { a: variable('a') });
    (variables.getLocalVariablesAsync as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no'));
    const reader = createFoundationReader(variables, styles);
    expect((await reader.variable('a'))?.name).toBe('color/a');
  });

  it('keeps the per-variable publication status and turns a failed read into null', async () => {
    const { variables, styles } = fakes([
      variable('ok'),
      variable('bad', { getPublishStatusAsync: async () => { throw new Error('offline'); } }),
    ]);
    const reader = createFoundationReader(variables, styles);
    expect((await reader.variable('ok'))?.publishStatus).toBe('CURRENT');
    expect((await reader.variable('bad'))?.publishStatus).toBeNull();
  });

  it('drops non-string code syntax entries and copies scopes', async () => {
    const { variables, styles } = fakes([
      variable('a', { codeSyntax: { WEB: '--a', iOS: undefined } as Record<string, string | undefined>, scopes: ['GAP'] }),
    ]);
    const reader = createFoundationReader(variables, styles);
    const a = await reader.variable('a');
    expect(a?.codeSyntax).toEqual({ WEB: '--a' });
    expect(a?.scopes).toEqual(['GAP']);
  });

  it('does not share the bulk read between two readers', async () => {
    const { variables, styles } = fakes([variable('a')]);
    await createFoundationReader(variables, styles).variable('a');
    await createFoundationReader(variables, styles).variable('a');
    expect(variables.getLocalVariablesAsync).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/foundationReader.test.ts`
Expected: FAIL, cannot find module `../src/foundationReader`.

- [ ] **Step 3: Write the module**

Create `packages/plugin/src/foundationReader.ts`. This is the reader that `main.ts:106-180` held inline, moved out and given one bulk read. The structural source types are the subset of Figma's `Variable`, `VariableCollection`, `TextStyle`, and `EffectStyle` that the reader touches; the real objects satisfy them, and tests fake them.

```ts
/// <reference types="@figma/plugin-typings" />
import type {
  FoundationReader, ReaderCollection, ReaderVariable, ReaderTextStyle, ReaderEffectStyle,
} from './serializeFoundation';
import type { RawEffect } from '@spec-layer/extractor';

type PublishStatusSource = { getPublishStatusAsync(): Promise<PublishStatus> };

/** The fields of a Figma Variable this reader touches. */
export interface VariableSource extends PublishStatusSource {
  id: string;
  name: string;
  resolvedType: VariableResolvedDataType;
  description: string;
  variableCollectionId: string;
  codeSyntax: Partial<Record<string, string>>;
  valuesByMode: Record<string, VariableValue>;
  scopes: readonly VariableScope[];
  remote: boolean;
  hiddenFromPublishing: boolean;
}

export interface CollectionSource extends PublishStatusSource {
  id: string;
  name: string;
  modes: ReadonlyArray<{ modeId: string; name: string }>;
  defaultModeId: string;
  variableIds: readonly string[];
  hiddenFromPublishing: boolean;
  remote: boolean;
}

export interface TextStyleSource extends PublishStatusSource {
  id: string;
  name: string;
  description: string;
  fontName: FontName;
  fontSize: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: TextCase;
  textDecoration: TextDecoration;
  boundVariables?: Partial<Record<string, VariableAlias | undefined>>;
  remote: boolean;
}

export interface EffectStyleSource extends PublishStatusSource {
  id: string;
  name: string;
  description: string;
  effects: readonly Effect[];
  remote: boolean;
}

/** `figma.variables`, or a fake. */
export interface VariablesSource {
  getLocalVariableCollectionsAsync(): Promise<CollectionSource[]>;
  getLocalVariablesAsync(): Promise<VariableSource[]>;
  getVariableByIdAsync(id: string): Promise<VariableSource | null>;
  getVariableCollectionByIdAsync(id: string): Promise<CollectionSource | null>;
}

/** `figma`, or a fake: only the two style listings. */
export interface StylesSource {
  getLocalTextStylesAsync(): Promise<TextStyleSource[]>;
  getLocalEffectStylesAsync(): Promise<EffectStyleSource[]>;
}

async function publishStatusOf(source: PublishStatusSource): Promise<PublishStatus | null> {
  try { return await source.getPublishStatusAsync(); } catch { return null; }
}

function readerVariable(v: VariableSource, publishStatus: PublishStatus | null): ReaderVariable {
  return {
    id: v.id,
    name: v.name,
    resolvedType: v.resolvedType,
    description: v.description ?? '',
    variableCollectionId: v.variableCollectionId,
    // codeSyntax is Partial<Record<CodeSyntaxPlatform, string>>; drop empties.
    codeSyntax: Object.fromEntries(
      Object.entries(v.codeSyntax ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
    valuesByMode: v.valuesByMode as Record<string, never>,
    scopes: [...v.scopes],
    remote: v.remote,
    hiddenFromPublishing: v.hiddenFromPublishing,
    publishStatus,
  };
}

/**
 * A FoundationReader for one serialization pass.
 *
 * The first variable lookup reads every local variable in one
 * getLocalVariablesAsync call and indexes it by id, so a 464-variable file
 * costs one round trip for values instead of 464. An id the bulk read did not
 * return (or a bulk read that failed) falls back to getVariableByIdAsync, so
 * nothing is reported missing that Figma can still hand over.
 *
 * Publication status stays per variable and is not deferred: an absent
 * `publication` drops the field from every v5 artifact built from this dump,
 * and the selection-time dump is the same session cache the publish path
 * reads. The reads run concurrently under serializeFoundation's Promise.all.
 *
 * Create one per pass. The index is a snapshot; a reader kept across passes
 * would serve stale values after an edit.
 */
export function createFoundationReader(
  variables: VariablesSource,
  styles: StylesSource,
): FoundationReader {
  let index: Promise<Map<string, VariableSource>> | null = null;
  const localVariables = (): Promise<Map<string, VariableSource>> => {
    if (!index) {
      index = variables.getLocalVariablesAsync()
        .then((list) => new Map(list.map((v) => [v.id, v] as const)))
        // A failed bulk read must not fail every lookup; the per-id path below
        // still works, exactly as the reader behaved before the bulk read.
        .catch(() => new Map<string, VariableSource>());
    }
    return index;
  };

  return {
    async collections() {
      const colls = await variables.getLocalVariableCollectionsAsync();
      return Promise.all(colls.map(async (c): Promise<ReaderCollection> => ({
        id: c.id,
        name: c.name,
        modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
        defaultModeId: c.defaultModeId,
        variableIds: [...c.variableIds],
        hiddenFromPublishing: c.hiddenFromPublishing,
        publishStatus: await publishStatusOf(c),
        remote: c.remote,
      })));
    },
    async variable(id) {
      const v = (await localVariables()).get(id) ?? await variables.getVariableByIdAsync(id);
      if (!v) return null;
      return readerVariable(v, await publishStatusOf(v));
    },
    async textStyles() {
      const list = await styles.getLocalTextStylesAsync();
      return Promise.all(list.map(async (s): Promise<ReaderTextStyle> => ({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        fontName: { family: s.fontName.family, style: s.fontName.style },
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        paragraphSpacing: s.paragraphSpacing,
        paragraphIndent: s.paragraphIndent,
        textCase: String(s.textCase),
        textDecoration: String(s.textDecoration),
        boundVariables: Object.fromEntries(
          Object.entries(s.boundVariables ?? {})
            .filter((e): e is [string, VariableAlias] => Boolean(e[1]?.id))
            .map(([k, v]) => [k, { id: v.id }]),
        ),
        remote: s.remote,
        publishStatus: await publishStatusOf(s),
      })));
    },
    async effectStyles() {
      const list = await styles.getLocalEffectStylesAsync();
      return Promise.all(list.map(async (s): Promise<ReaderEffectStyle> => ({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        // Handed to effectLayerOf as-is: it is structurally typed for exactly
        // this, which keeps the effect union in the extractor rather than here.
        effects: s.effects as unknown as RawEffect[],
        remote: s.remote,
        publishStatus: await publishStatusOf(s),
      })));
    },
    async collectionName(id) {
      const c = await variables.getVariableCollectionByIdAsync(id);
      return c?.name ?? null;
    },
  };
}
```

If `typecheck` reports that a Reader type field differs from what this module returns (for example `ReaderTextStyle.lineHeight`), open `packages/plugin/src/serializeFoundation.ts:17-73` and match the field types there exactly; the inline reader in `main.ts:106-180` is the reference for what each field held.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/foundationReader.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Replace the inline reader in `main.ts`**

In `packages/plugin/src/main.ts`:

1. Delete lines 96 to 180: the `FoundationReader` banner comment, `publishStatusOf`, and `const foundationReader: FoundationReader = { ... };`.
2. Remove `type FoundationReader` from the `./serializeFoundation` import if nothing else uses it (grep `FoundationReader` in `main.ts` first).
3. Add to the imports:
   ```ts
   import { createFoundationReader } from './foundationReader';
   ```
4. At each of the five `serializeFoundation(` calls (previously lines 206, 792, 894, 952, 1140), replace the first argument `foundationReader` with `createFoundationReader(figma.variables, figma)`.

`figma.variables` satisfies `VariablesSource` and `figma` satisfies `StylesSource` structurally. If `typecheck` disagrees on a field, widen the structural type in `foundationReader.ts` to Figma's, never the other way.

Then run `npm run lint`. The `RawEffect` type import and the `FoundationReader` type import in `main.ts` become unused once the inline reader is gone; remove each one lint names. `PublishStatus` was a global Figma type and needs no import change.

- [ ] **Step 6: Typecheck, run all plugin tests, build, sandbox scan**

Run:
```bash
npm run typecheck && npx vitest run packages/plugin && npm run build:plugin && npm run check:sandbox
```
Expected: all exit 0; `serializeFoundation.test.ts` still passes unchanged.

- [ ] **Step 7: Changelog and commit**

Add under `### Changed`:

```markdown
- Reading a file's foundations fetches every local variable in one call and
  indexes it, instead of one call per variable. Publication status is still
  read per variable, so exported artifacts are unchanged.
```

```bash
git add packages/plugin/src/foundationReader.ts packages/plugin/test/foundationReader.test.ts packages/plugin/src/main.ts CHANGELOG.md
git commit -m "perf(plugin): bulk-read local variables in the foundation reader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Post the foundation dump to the UI once, not per selection

**Files:**
- Create: `packages/plugin/src/foundationPost.ts`
- Create: `packages/plugin/test/foundationPost.test.ts`
- Modify: `packages/plugin/src/main.ts` `postSelection` (around lines 270-292) and `case 'requestFoundation'` (around line 906)
- Modify: `packages/plugin/TESTING.md` Generate Foundation docs row 1
- Modify: `CHANGELOG.md` under `### Changed`

**Interfaces:**
- Produces: `class FoundationPostGate { fresh<T extends object>(dump: T): T | undefined; }`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/foundationPost.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FoundationPostGate } from '../src/foundationPost';

describe('FoundationPostGate', () => {
  it('hands over a dump the UI has not seen', () => {
    const gate = new FoundationPostGate();
    const dump = { fileKey: 'F' };
    expect(gate.fresh(dump)).toBe(dump);
  });

  it('withholds the same object on the next selection', () => {
    const gate = new FoundationPostGate();
    const dump = { fileKey: 'F' };
    gate.fresh(dump);
    expect(gate.fresh(dump)).toBeUndefined();
    expect(gate.fresh(dump)).toBeUndefined();
  });

  it('hands over a refreshed dump even when its content is equal', () => {
    const gate = new FoundationPostGate();
    gate.fresh({ fileKey: 'F' });
    const refreshed = { fileKey: 'F' };
    expect(gate.fresh(refreshed)).toBe(refreshed);
  });

  it('treats a dump posted through another message as seen', () => {
    const gate = new FoundationPostGate();
    const dump = { fileKey: 'F' };
    gate.fresh(dump); // requestFoundation posted it on the 'foundation' message
    expect(gate.fresh(dump)).toBeUndefined(); // the next 'selection' omits it
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/foundationPost.test.ts`
Expected: FAIL, cannot find module `../src/foundationPost`.

- [ ] **Step 3: Write the module**

Create `packages/plugin/src/foundationPost.ts`:

```ts
/**
 * Remembers which foundation dump object the UI already holds.
 *
 * The main thread caches one SerializedFoundation per session and used to
 * attach it to every 'selection' message: 114 KB of structured clone per
 * click at 360 variables, 340 KB at 1080, and a buildFoundation() re-run in
 * the UI each time. The UI keeps the parsed spec at module scope, so it only
 * needs the dump when the object changes. Identity, not equality: a refresh
 * that produced an equal dump is still a new read the UI should adopt, and
 * comparing content would cost what this saves.
 *
 * Both realms restart together when the plugin reopens, so the gate can never
 * believe the UI holds a dump it does not.
 */
export class FoundationPostGate {
  private posted: object | null = null;

  /** The dump if the UI has not seen this exact object; undefined otherwise. */
  fresh<T extends object>(dump: T): T | undefined {
    if (this.posted === dump) return undefined;
    this.posted = dump;
    return dump;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/foundationPost.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the gate into `main.ts`**

Add the import:
```ts
import { FoundationPostGate } from './foundationPost';
```

Directly after `let foundationCache: ... = null;` (around line 202), add:
```ts
const foundationPosts = new FoundationPostGate();
```

In `postSelection`, the message construction after the `if (seq !== selectionSeq) return;` line currently reads:
```ts
    const msg: MainToUi = {
      type: 'selection', node, fileKey: resolved.fileKey, fileKeySource: resolved.source,
      // figma.root.name is main-thread only, so the file's NAME has to ride
      // this message alongside its key; the UI cannot read it itself.
      fileName: figma.root.name,
      ...(foundation ? { foundation } : {}),
    };
```
Change the last spread to:
```ts
      // Only when the UI does not already hold this exact dump. See
      // FoundationPostGate for why identity is the right test.
      ...(foundation && foundationPosts.fresh(foundation) ? { foundation } : {}),
```
The gate call must stay after the `seq` check so a superseded selection never marks a dump as posted.

In `case 'requestFoundation'`, directly before `figma.ui.postMessage({ type: 'foundation', dump, groupDescriptions } as MainToUi);`, add:
```ts
        // The 'foundation' reply hands the UI this dump, so the next
        // 'selection' must not send it again.
        foundationPosts.fresh(dump);
```

- [ ] **Step 6: Typecheck, build, sandbox scan**

Run:
```bash
npm run typecheck && npm run build:plugin && npm run check:sandbox
```
Expected: exit 0.

- [ ] **Step 7: Add the TESTING.md row**

In `packages/plugin/TESTING.md`, Generate Foundation docs, append to row 1 after "without creating Sections.":

```markdown
   Then select a component, change a variable value, come back to
   **Foundation documents**, click **Refresh sources**, select the component
   again, and run Library **Copy for AI** on it. The copied token value must be
   the new one: the selection message no longer carries the foundation dump,
   so this checks the refreshed dump still reaches the component copy.
```

- [ ] **Step 8: Changelog and commit**

Add under `### Changed`:

```markdown
- Selecting a component no longer sends the whole foundation dump to the
  plugin panel on every click. The dump travels once per read and the panel
  keeps it, which removes a structured clone of up to a few hundred kilobytes
  per selection on large files.
```

```bash
git add packages/plugin/src/foundationPost.ts packages/plugin/test/foundationPost.test.ts packages/plugin/src/main.ts packages/plugin/TESTING.md CHANGELOG.md
git commit -m "perf(plugin): post the foundation dump to the ui once per read

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: In-shell confirmation dialog replacing `window.confirm`

**Files:**
- Create: `packages/plugin/src/ui/shell/confirmDialog.ts`
- Create: `packages/plugin/test/confirmDialog.test.ts`
- Modify: `packages/plugin/src/ui/design-system/patterns.css` after `.sl-dialog` (line 2628-2637)
- Modify: `packages/plugin/src/ui/ui-vnext.ts:850-876` (`startLibraryUpdates`), `:1382` and `:1481` (its callers), `:1494-1511` (detach and remove), `:2347-2365` (docSource hand-edit check)
- Modify: `CHANGELOG.md` under `### Changed`

**Interfaces:**
- Produces:
  ```ts
  export interface ConfirmDialogOptions {
    title: string; body: string; confirmLabel: string;
    cancelLabel?: string; tone?: 'danger' | 'primary';
  }
  export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean>
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/confirmDialog.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { confirmDialog } from '../src/ui/shell/confirmDialog';

afterEach(() => {
  document.body.innerHTML = '';
});

const OPTIONS = {
  title: 'Remove this frame from the canvas?',
  body: 'The Section and its Library connection are removed.',
  confirmLabel: 'Remove',
  tone: 'danger' as const,
};

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('no dialog rendered');
  return el;
}

describe('confirmDialog', () => {
  it('renders title, body, and both actions, and focuses Cancel', () => {
    void confirmDialog(OPTIONS);
    const el = dialog();
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('h2')?.textContent).toBe(OPTIONS.title);
    expect(el.querySelector('p')?.textContent).toBe(OPTIONS.body);
    const accept = el.querySelector<HTMLButtonElement>('[data-confirm-accept]');
    const cancel = el.querySelector<HTMLButtonElement>('[data-confirm-cancel]');
    expect(accept?.textContent).toBe('Remove');
    expect(accept?.dataset.tone).toBe('danger');
    expect(cancel?.textContent).toBe('Cancel');
    expect(document.activeElement).toBe(cancel);
  });

  it('resolves true on accept and removes itself', async () => {
    const result = confirmDialog(OPTIONS);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-accept]')?.click();
    expect(await result).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const result = confirmDialog(OPTIONS);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.click();
    expect(await result).toBe(false);
  });

  it('resolves false on Escape and stops the key reaching the shell', async () => {
    let reachedShell = false;
    document.addEventListener('keydown', () => { reachedShell = true; });
    const result = confirmDialog(OPTIONS);
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await result).toBe(false);
    expect(reachedShell).toBe(false);
  });

  it('resolves false on a backdrop click but not on a click inside the dialog', async () => {
    const result = confirmDialog(OPTIONS);
    dialog().querySelector('p')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-confirm-dialog]')?.click();
    expect(await result).toBe(false);
  });

  it('returns focus to the element that opened it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const result = confirmDialog(OPTIONS);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.click();
    await result;
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', () => {
    void confirmDialog(OPTIONS);
    const el = dialog();
    const cancel = el.querySelector<HTMLButtonElement>('[data-confirm-cancel]');
    const accept = el.querySelector<HTMLButtonElement>('[data-confirm-accept]');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(accept);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(cancel);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(accept);
  });

  it('refuses a second dialog while one is open', async () => {
    const first = confirmDialog(OPTIONS);
    expect(await confirmDialog(OPTIONS)).toBe(false);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-accept]')?.click();
    expect(await first).toBe(true);
  });

  it('defaults to the primary tone and a Cancel label', () => {
    void confirmDialog({ title: 'Update?', body: 'Edits are replaced.', confirmLabel: 'Update' });
    const accept = dialog().querySelector<HTMLButtonElement>('[data-confirm-accept]');
    expect(accept?.dataset.tone).toBe('primary');
    expect(dialog().querySelector('[data-confirm-cancel]')?.textContent).toBe('Cancel');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/confirmDialog.test.ts`
Expected: FAIL, cannot find module `../src/ui/shell/confirmDialog`.

- [ ] **Step 3: Write the module**

Create `packages/plugin/src/ui/shell/confirmDialog.ts`:

```ts
/**
 * An in-shell confirmation, replacing window.confirm.
 *
 * Figma's plugin iframe is sandboxed. A sandboxed iframe without
 * `allow-modals` makes confirm() return false without showing anything, which
 * turned every guarded action into a silent no-op. Native dialogs also ignore
 * the theme and cannot be focus-trapped. This renders the same .sl-overlay and
 * .sl-dialog the design system already defines.
 *
 * Text lands through textContent, never innerHTML, so a document name inside a
 * body string can never become markup. One dialog at a time: a second call
 * while one is open resolves false at once rather than stacking.
 */
export interface ConfirmDialogOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

let open = false;

function button(label: string, tone: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'sl-button';
  el.dataset.tone = tone;
  el.textContent = label;
  return el;
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  if (open) return Promise.resolve(false);
  open = true;

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const host = document.createElement('div');
  host.className = 'sl-overlay';
  host.setAttribute('data-confirm-dialog', '');

  const dialog = document.createElement('div');
  dialog.className = 'sl-dialog sl-confirm-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'sl-confirm-title');
  dialog.setAttribute('aria-describedby', 'sl-confirm-body');

  const title = document.createElement('h2');
  title.id = 'sl-confirm-title';
  title.textContent = options.title;

  const body = document.createElement('p');
  body.id = 'sl-confirm-body';
  body.textContent = options.body;

  const actions = document.createElement('div');
  actions.className = 'sl-dialog-actions';
  const cancel = button(options.cancelLabel ?? 'Cancel', 'secondary');
  cancel.setAttribute('data-confirm-cancel', '');
  const accept = button(options.confirmLabel, options.tone ?? 'primary');
  accept.setAttribute('data-confirm-accept', '');
  actions.append(cancel, accept);

  dialog.append(title, body, actions);
  host.appendChild(dialog);

  return new Promise<boolean>((resolve) => {
    const close = (result: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      open = false;
      opener?.focus();
      resolve(result);
    };

    // Capture phase, so this runs before the shell's own keydown listener on
    // document, and stopImmediatePropagation keeps Escape from also backing
    // out of whatever screen sits under the overlay.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(false);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const items = [cancel, accept];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey
          ? (current <= 0 ? items.length - 1 : current - 1)
          : (current < 0 || current === items.length - 1 ? 0 : current + 1);
        items[next].focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    host.addEventListener('click', (event) => {
      if (event.target === host) close(false);
    });
    cancel.addEventListener('click', () => close(false));
    accept.addEventListener('click', () => close(true));

    document.body.appendChild(host);
    cancel.focus();
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/confirmDialog.test.ts`
Expected: PASS, 9 tests. If the Escape test reports `reachedShell` true, the shell listener registered in the test is a bubble listener on `document` and the dialog's capture listener called `stopImmediatePropagation`; check that the event was dispatched on the dialog element (a descendant), not on `document` itself.

- [ ] **Step 5: Add the dialog styles**

In `packages/plugin/src/ui/design-system/patterns.css`, directly after the `.sl-dialog { ... }` block (ends around line 2637), add:

```css
.sl-confirm-dialog > h2 {
  margin: 0 0 var(--sl-space-8);
  color: var(--sl-color-text);
  font-size: var(--sl-font-size-section);
  font-weight: var(--sl-font-weight-semibold);
}

.sl-confirm-dialog > p {
  margin: 0;
  color: var(--sl-color-text-muted);
  font-size: var(--sl-font-size-control);
  line-height: var(--sl-line-height-body);
}

.sl-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sl-space-8);
  margin-top: var(--sl-space-14);
}
```

Every token used here already appears in `patterns.css` (`--sl-space-8`, `--sl-space-14`, `--sl-font-size-section`, `--sl-font-weight-semibold`, `--sl-font-size-control`, `--sl-line-height-body`, `--sl-color-text`, `--sl-color-text-muted`). If `grep -c` finds one missing, use the nearest one `.sl-empty-state` uses.

- [ ] **Step 6: Replace the four `window.confirm` sites in `ui-vnext.ts`**

Add the import near the other `./shell/` imports:
```ts
import { confirmDialog } from './shell/confirmDialog';
```

**Site 1, `startLibraryUpdates` (line 850).** Replace the whole function with:

```ts
async function startLibraryUpdates(docIds: string[], batch: boolean): Promise<void> {
  if (docIds.length === 0 || operation.active) return;
  const edited = docIds.filter((docId) => libraryEntry(docId)?.selfEdited);
  if (edited.length > 0) {
    const ok = await confirmDialog(batch
      ? {
          title: `Replace hand edits in ${edited.length} ${edited.length === 1 ? 'document' : 'documents'}?`,
          body: `${edited.length === 1 ? 'One selected document has' : `${edited.length} selected documents have`} hand edits to generated content. Updating replaces those edits. Text in the writing sections is kept.`,
          confirmLabel: 'Update all',
        }
      : {
          title: 'Replace your edits to generated content?',
          body: 'You edited generated content in this frame by hand. Updating replaces those edits. Your text in the writing sections is kept.',
          confirmLabel: 'Update',
        });
    if (!ok) return;
  }
  if (!beginOperation(operation)) return;
  libraryOperation = {
    kind: 'update',
    queue: [...docIds],
    currentDocId: null,
    completed: 0,
    total: docIds.length,
    batch,
    confirmedOverwrite: new Set(edited),
  };
  dispatchNextLibraryUpdate();
}
```

The two callers (line 1382 and the `case 'update'` at line 1481) become `void startLibraryUpdates(...)`. Keep their arguments as they are.

**Sites 2 and 3, the menu cases (lines 1494-1511).** Replace:

```ts
      case 'detach':
        if (
          !operation.active &&
          window.confirm(
            'Detach this documentation? It stays on the canvas as a plain frame and stops tracking its source.',
          )
        ) {
          send({ type: 'detachDoc', docId });
        }
        return;
      case 'remove':
        if (
          !operation.active &&
          window.confirm('Remove this documentation frame from the canvas?')
        ) {
          send({ type: 'removeDoc', docId });
        }
        return;
```

with:

```ts
      case 'detach':
        if (operation.active) return;
        void confirmDialog({
          title: 'Detach this documentation?',
          body: 'It stays on the canvas as a plain frame and stops tracking its source.',
          confirmLabel: 'Detach',
        }).then((ok) => {
          if (ok && !operation.active) send({ type: 'detachDoc', docId });
        });
        return;
      case 'remove':
        if (operation.active) return;
        void confirmDialog({
          title: 'Remove this frame from the canvas?',
          body: 'The documentation Section is deleted and its Library connection is removed.',
          confirmLabel: 'Remove',
          tone: 'danger',
        }).then((ok) => {
          if (ok && !operation.active) send({ type: 'removeDoc', docId });
        });
        return;
```

**Site 4, the `docSource` hand-edit check (lines 2347-2365).** The block currently reads:

```ts
      if (msg.selfEdited && !active.confirmedOverwrite.has(msg.docId)) {
        if (!window.confirm('You edited generated content in this frame by hand. Updating replaces those edits. Your text in the writing sections is kept.')) {
          finishLibraryOperation('Update canceled because the frame has hand edits to generated content.');
          return;
        }
        active.confirmedOverwrite.add(msg.docId);
      }
      let preparationError = '';
      void updateFromSource(state, src, libraryPresenter((message) => {
        preparationError = message;
      })).then((dispatched) => {
        if (!dispatched) {
          finishLibraryOperation(
            preparationError ||
            'The source could not be prepared, so the remaining updates stopped.',
          );
        }
      });
      return;
```

Replace it with:

```ts
      const runUpdate = (): void => {
        let preparationError = '';
        void updateFromSource(state, src, libraryPresenter((message) => {
          preparationError = message;
        })).then((dispatched) => {
          if (!dispatched) {
            finishLibraryOperation(
              preparationError ||
              'The source could not be prepared, so the remaining updates stopped.',
            );
          }
        });
      };
      if (msg.selfEdited && !active.confirmedOverwrite.has(msg.docId)) {
        void confirmDialog({
          title: 'Replace your edits to generated content?',
          body: 'You edited generated content in this frame by hand. Updating replaces those edits. Your text in the writing sections is kept.',
          confirmLabel: 'Update',
        }).then((ok) => {
          if (libraryOperation !== active) return; // the operation ended while the dialog was open
          if (!ok) {
            finishLibraryOperation('Update canceled because the frame has hand edits to generated content.');
            return;
          }
          active.confirmedOverwrite.add(msg.docId);
          runUpdate();
        });
        return;
      }
      runUpdate();
      return;
```

- [ ] **Step 7: Confirm no `window.confirm` remains, then typecheck, lint, test, build**

Run:
```bash
grep -rn "window.confirm" packages/plugin/src ; npm run typecheck && npm run lint && npx vitest run packages/plugin && npm run build:plugin && npm run check:sandbox
```
Expected: the grep prints nothing; every gate exits 0.

- [ ] **Step 8: Voice check**

Run:
```bash
grep -rn "—" packages/plugin/src/ui/shell/confirmDialog.ts packages/plugin/src/ui/ui-vnext.ts | grep -v "^\s*//\|^\s*\*" | head
```
Expected: no em dash inside a string literal. Comments may contain them, since the voice rules govern UI copy.

- [ ] **Step 9: Changelog and commit**

Add under `### Changed`:

```markdown
- Detach, Remove, and Update of a hand-edited document now confirm inside the
  plugin panel instead of through the browser's `confirm()`. A sandboxed
  iframe can answer `confirm()` with false without showing anything, which
  made those actions do nothing. The new dialog follows the theme, traps
  focus, and cancels on Escape.
```

```bash
git add packages/plugin/src/ui/shell/confirmDialog.ts packages/plugin/test/confirmDialog.test.ts packages/plugin/src/ui/design-system/patterns.css packages/plugin/src/ui/ui-vnext.ts CHANGELOG.md
git commit -m "fix(plugin): confirm destructive library actions in the panel, not window.confirm

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Remove the non-component toast

**Files:**
- Modify: `packages/plugin/src/main.ts:257` (inside `postSelection`)
- Modify: `packages/plugin/TESTING.md:66-67`
- Modify: `CHANGELOG.md` under `### Changed`

- [ ] **Step 1: Delete the toast**

In `postSelection`, remove the line:
```ts
    figma.notify('Select a component or component set');
```
The `if (!component) { ... }` block keeps its `seq` check and its `postMessage`.

- [ ] **Step 2: Confirm nothing else depends on it**

Run:
```bash
grep -rn "Select a component or component set" packages/plugin/src packages/plugin/test
```
Expected: hits only in the empty-state copy under `packages/plugin/src/ui/` (and its tests), none in `main.ts`.

- [ ] **Step 3: Update TESTING.md**

In `packages/plugin/TESTING.md`, Generate component docs, replace:

```markdown
Also verify a nested selection resolves to its enclosing component and a
non-component selection shows an actionable empty state.
```

with:

```markdown
Also verify a nested selection resolves to its enclosing component and a
non-component selection shows an actionable empty state with no toast. Click
a frame, a text node, and one of the plugin's own Sections while the panel is
open: nothing should pop up on the canvas.
```

- [ ] **Step 4: Typecheck, build, sandbox scan**

Run: `npm run typecheck && npm run build:plugin && npm run check:sandbox`
Expected: exit 0.

- [ ] **Step 5: Changelog and commit**

Add under `### Changed`:

```markdown
- Clicking anything that is not a component no longer shows a toast on the
  canvas. The panel's empty state already says what to select.
```

```bash
git add packages/plugin/src/main.ts packages/plugin/TESTING.md CHANGELOG.md
git commit -m "fix(plugin): drop the toast on every non-component selection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Copy for AI on the component screen

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:503-546` (`copyBriefFromSource` signature and caveat)
- Modify: `packages/plugin/src/ui/screens/component.ts:331-352` (`componentFooterMarkup`)
- Modify: `packages/plugin/src/ui/ui-vnext.ts` click handler near line 1633 (`if (target.closest('#sl-create')) build();`)
- Modify: `packages/plugin/test/copyBrief.test.ts`, `packages/plugin/test/componentScreen.test.ts`
- Modify: `packages/plugin/TESTING.md` Generate component docs row 5
- Modify: `CHANGELOG.md` under `### Added`

**Interfaces:**
- Consumes: `copyBriefFromSource(state, src, prose, ui)` from `actions.ts:503`; `copyPresenter()` from `ui-vnext.ts:795`; `UiState.currentNode`, `currentFileKey`, `currentFileName`.
- Produces:
  ```ts
  export type CopySource = Pick<DocSource, 'node' | 'fileKey' | 'fileName'>;
  export interface CopyBriefOptions { guidelinesNote?: boolean } // default true
  export async function copyBriefFromSource(state, src: CopySource, prose, ui, options?: CopyBriefOptions): Promise<void>
  ```
  Footer button `id="sl-copy-component"`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/copyBrief.test.ts` inside `describe('copyBriefFromSource', ...)`:

```ts
  it('accepts a bare selection source with no doc id or config', async () => {
    const ui = presenter();
    await copyBriefFromSource(createState(), { node: NODE, fileKey: 'F1' }, null, ui);
    expect(copyText).toHaveBeenCalledTimes(1);
    const y = load(copyText.mock.calls[0][0]) as ParsedCopyBrief;
    expect(y.source.node_id).toBe('1:100');
  });

  it('omits the guidelines note when the caller says no document is involved', async () => {
    copyText.mockResolvedValue('manual');
    await copyBriefFromSource(createState(), { node: NODE, fileKey: 'F1' }, null, presenter(), { guidelinesNote: false });
    const [, notice] = renderManualCopyModal.mock.calls[0];
    expect(notice ?? '').not.toContain('no saved guidelines');
    expect(notice ?? '').toContain('Token values are missing');
  });
```

Append to `packages/plugin/test/componentScreen.test.ts`, in the describe block that already tests `componentFooterMarkup` (search for `componentFooterMarkup(` in the file and add beside it):

```ts
  it('offers Copy for AI beside Create docs whenever the screen is not busy', () => {
    const ready = componentFooterMarkup(READY);
    expect(ready).toContain('id="sl-copy-component"');
    expect(ready).toContain('Copy for AI');
    expect(ready.indexOf('sl-copy-component')).toBeLessThan(ready.indexOf('id="sl-create"'));
    expect(ready).not.toMatch(/id="sl-copy-component"[^>]*disabled/);
    expect(componentFooterMarkup({ kind: 'reading', componentName: 'Button' }))
      .toMatch(/id="sl-copy-component"[^>]*disabled/);
    expect(componentFooterMarkup({ kind: 'building', componentName: 'Button', action: 'create' }))
      .toMatch(/id="sl-copy-component"[^>]*disabled/);
    expect(componentFooterMarkup({ kind: 'empty' })).toBe('');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/copyBrief.test.ts packages/plugin/test/componentScreen.test.ts`
Expected: the copyBrief additions fail to compile (`DocSource` requires `docId` and `config`; fifth argument not accepted); the footer test fails on `sl-copy-component`.

- [ ] **Step 3: Widen `copyBriefFromSource`**

In `packages/plugin/src/ui/actions.ts`, directly above `export async function copyBriefFromSource(` add:

```ts
/** What a copy needs from a source: the live node and where it came from.
 *  A Library row passes its DocSource; the component screen passes the
 *  current selection, which has no doc id or config. */
export type CopySource = Pick<DocSource, 'node' | 'fileKey' | 'fileName'>;

export interface CopyBriefOptions {
  /** Say "This document has no saved guidelines" when prose is null. True for
   *  a Library row, where a document exists and could have had them. False
   *  from the component screen, where there is no document to speak of. */
  guidelinesNote?: boolean;
}
```

Change the signature to:

```ts
export async function copyBriefFromSource(
  state: UiState,
  src: CopySource,
  prose: ProseDrafts | null,
  ui: BuildPresenter,
  options: CopyBriefOptions = {},
): Promise<void> {
```

and the `noProse` line to:

```ts
    const noProse = prose || options.guidelinesNote === false ? '' : ' This document has no saved guidelines.';
```

`src.node.id`, `src.fileKey`, and `src.fileName` are the only fields the body reads, so nothing else changes.

- [ ] **Step 4: Add the footer button**

In `packages/plugin/src/ui/screens/component.ts`, `componentFooterMarkup`, change the returned markup to:

```ts
  return (
    (progress ? `<div class="sl-footer-progress">${progress}</div>` : '') +
    '<div class="sl-footer-actions">' +
    // The fastest path to value is component context in an agent's window,
    // and it used to require a canvas document first. Same disabled rule as
    // Create docs: both need the extracted spec, which reading produces.
    `<button class="sl-button" data-tone="secondary" id="sl-copy-component" type="button"` +
    `${busy ? ' disabled' : ''}>${icon('copy', 15)}` +
    '<span>Copy for AI</span></button>' +
    `<button class="sl-button" data-tone="primary" id="sl-create" type="button"` +
    `${busy ? ' disabled' : ''}>${icon('filePlus', 15)}` +
    `<span>${createLabel}</span></button>` +
    '</div>'
  );
```

- [ ] **Step 5: Wire the click**

In `packages/plugin/src/ui/ui-vnext.ts`, directly above `if (target.closest('#sl-create')) build();` (around line 1633, already inside the `if (operation.active) return;` guard), add:

```ts
  if (target.closest('#sl-copy-component')) {
    copyCurrentComponent();
    return;
  }
```

Add this function near `copyPresenter()` (around line 795):

```ts
/**
 * Copy for AI from the Selected component screen: the same brief a Library
 * row copies, built from the current selection. No document is read, so no
 * saved guidelines ride along and the caveat does not mention them.
 */
function copyCurrentComponent(): void {
  const node = state.currentNode;
  if (!node) return;
  void copyBriefFromSource(
    state,
    { node, fileKey: state.currentFileKey, ...(state.currentFileName ? { fileName: state.currentFileName } : {}) },
    null,
    copyPresenter(),
    { guidelinesNote: false },
  );
}
```

`copyBriefFromSource` is already imported at the top of `ui-vnext.ts`; confirm with `grep -n "copyBriefFromSource" packages/plugin/src/ui/ui-vnext.ts`.

- [ ] **Step 6: Run the tests, typecheck, lint, build**

Run:
```bash
npx vitest run packages/plugin/test/copyBrief.test.ts packages/plugin/test/componentScreen.test.ts && npm run typecheck && npm run lint && npm run build:plugin
```
Expected: PASS and exit 0.

- [ ] **Step 7: Update TESTING.md**

In Generate component docs, replace row 5:

```markdown
5. Open **Library**, use the row menu's **Copy for AI**, and paste into a plain
   text editor. Confirm it is a YAML brief for the live source. It must not
   download Markdown/ZIP files or change the canvas.
```

with:

```markdown
5. With a component selected and no document created, click the footer's
   **Copy for AI** and paste into a plain text editor. Confirm it is a YAML
   brief for the live source that says `kind: component`, carries token values
   when Foundations have been read, and does not mention saved guidelines. It
   must not change the canvas. Then open **Library**, use a row menu's **Copy
   for AI**, and confirm that brief still includes saved guidelines when the
   document has them.
```

- [ ] **Step 8: Changelog and commit**

Add under `### Added`:

```markdown
- **Copy for AI** on the Selected component screen. The component brief no
  longer requires creating a canvas document first; it copies from the
  selection with the same content a Library row copies, minus saved
  guidelines, since no document is involved.
```

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/src/ui/screens/component.ts packages/plugin/src/ui/ui-vnext.ts packages/plugin/test/copyBrief.test.ts packages/plugin/test/componentScreen.test.ts packages/plugin/TESTING.md CHANGELOG.md
git commit -m "feat(plugin): copy for ai from the component screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Minify both bundles

**Files:**
- Modify: `packages/plugin/build.mjs`
- Modify: `scripts/check-main-sandbox.mjs` header comment (line 20-23)
- Modify: `CHANGELOG.md` under `### Changed`

- [ ] **Step 1: Record the current sizes**

Run:
```bash
npm run build:plugin && ls -l packages/plugin/dist/main.js packages/plugin/dist/ui.html
```
Expected: roughly 235 KB and 616 KB. Note both numbers for the changelog.

- [ ] **Step 2: Minify the JS builds**

In `packages/plugin/build.mjs`, add `minify: true,` to the options of all three `esbuild.build` calls (main, UI, harness), directly after `target: 'es2017',` in each.

- [ ] **Step 3: Minify the embedded CSS**

Replace:
```js
const uiHtmlCss = designSystemCss;
```
with:
```js
// Comments and whitespace out; selectors, custom properties, and cascade order
// untouched. The uiHtml test checks order by selector, not by comment.
const uiHtmlCss = (await esbuild.transform(designSystemCss, { loader: 'css', minify: true })).code;
```

The harness build keeps `designSystemCss` unminified; it is dev-only.

- [ ] **Step 4: Rebuild, run the bundle tests, scan**

Run:
```bash
npm run build:plugin && ls -l packages/plugin/dist/main.js packages/plugin/dist/ui.html && npx vitest run packages/plugin/test/uiHtml.test.ts && npm run check:sandbox
```
Expected: both files smaller (expect roughly 40 to 60 percent), `uiHtml.test.ts` passes (its markers are `--sl-plugin-width`, `.sl-button`, `.sl-plugin-shell`, `sl-plugin-shell`, and `<script>`, all of which survive minification), and the sandbox scan exits 0.

If the sandbox scan reports a new hit, it is a real reference that comments used to hide from the reader, not from the scan; open the reported line in `dist/main.js`, find the source, and fix the source. Do not loosen the scan.

- [ ] **Step 5: Update the scan's comment**

In `scripts/check-main-sandbox.mjs`, change:

```js
 * Matching is deliberately narrow to avoid false positives on a bundled,
 * unminified artifact: constructor globals are matched only as `new X(`, and
```
to:
```js
 * Matching is deliberately narrow to avoid false positives on a bundled
 * artifact: constructor globals are matched only as `new X(`, and
```
Also add after the sentence ending "in a comment or a string literal.":
```js
 * The bundle is minified since 2026-09; minifiers rename locals, never
 * globals, so `document.` and `new TextEncoder(` still read the same here.
```

- [ ] **Step 6: Run the full test suite once**

Run: `npm test`
Expected: all pass. `uiHtml.test.ts` builds the bundle itself, so this also proves the build.

- [ ] **Step 7: Changelog and commit**

Add under `### Changed`, filling in the measured sizes:

```markdown
- The plugin bundles are minified. `dist/ui.html`, which the panel loads on
  every open, went from <before> KB to <after> KB; `dist/main.js` from
  <before> KB to <after> KB. No behaviour change.
```

```bash
git add packages/plugin/build.mjs scripts/check-main-sandbox.mjs CHANGELOG.md
git commit -m "chore(plugin): minify the main and ui bundles

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Compact DTCG clipboard and byte-based size caveat

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:503-546` (`copyBriefFromSource` caveat), `:637-651` (`deliverBrief`), `:690` (`foundationDtcgJson` return)
- Modify: `packages/plugin/test/copyFoundation.test.ts:217-237`
- Modify: `packages/plugin/test/copyBrief.test.ts` (add one test)
- Modify: `packages/plugin/TESTING.md` Generate Foundation docs row 4
- Modify: `CHANGELOG.md` under `### Changed`

**Interfaces:**
- Produces: `export function sizeCaveat(text: string): string` in `actions.ts`, returning `''` under the threshold or ` N KB, which is large for some chat windows.` (leading space, so it concatenates like the old string). Threshold constant `LARGE_COPY_BYTES = 200 * 1024`.

- [ ] **Step 1: Write the failing tests**

In `packages/plugin/test/copyFoundation.test.ts`, replace the test `'carries the same size caveat into the tier-3 modal as the toast reports'` (lines 217-237) with:

```ts
  it('copies compact JSON: one line, still parseable, same content', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const text = copyText.mock.calls.at(-1)?.[0] as string;
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trimEnd().includes('\n')).toBe(false);
    expect(text).not.toContain('  "');
    expect(copied().version).toBe('2025.10');
  });

  it('carries a byte-based size caveat into the tier-3 modal, the same one the toast reports', async () => {
    const bigDump: SerializedFoundation = {
      ...DUMP,
      collections: [{
        id: 'C1', name: 'Color', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Light' }],
        // Each token is roughly 120 bytes of compact JSON, so 2500 tokens
        // lands well past the 200 KB threshold.
        variables: Array.from({ length: 2500 }, (_, i) => ({
          id: `V${i}`, name: `color/bg/brand-${i}`, resolvedType: 'COLOR' as const, description: '',
          codeSyntax: {}, valuesByMode: { m1: { r: 0.14, g: 0.39, b: 0.92, a: 1 } },
        })),
      }],
    };
    onFoundationMessage(bigDump);
    copyText.mockResolvedValue('manual');
    await copyFoundationBrief(presenter());
    expect(renderManualCopyModal).toHaveBeenCalledTimes(1);
    const [text, notice] = renderManualCopyModal.mock.calls[0];
    const kb = Math.round(new TextEncoder().encode(text).length / 1024);
    expect(notice).toBe(`${kb} KB, which is large for some chat windows.`);
  });

  it('says nothing about size under the threshold', async () => {
    onFoundationMessage(DUMP);
    const ui = presenter();
    await copyFoundationBrief(ui);
    expect(ui.info).toHaveBeenCalledWith('Copied.');
  });
```

Append to `packages/plugin/test/copyBrief.test.ts` inside `describe('copyBriefFromSource', ...)`:

```ts
  it('measures the component brief in kilobytes too', async () => {
    const wide = {
      ...NODE,
      children: Array.from({ length: 3000 }, (_, i) => ({
        id: `1:${i + 200}`, name: `Layer ${i} with a deliberately long descriptive name`, type: 'FRAME',
        visible: true, children: [], bindings: [],
      })),
    } as never;
    copyText.mockResolvedValue('manual');
    await copyBriefFromSource(createState(), { node: wide, fileKey: 'F1' }, null, presenter());
    const [text, notice] = renderManualCopyModal.mock.calls[0];
    const kb = Math.round(new TextEncoder().encode(text).length / 1024);
    if (kb * 1024 > 200 * 1024) {
      expect(notice).toContain(`${kb} KB, which is large for some chat windows.`);
    } else {
      expect(notice ?? '').not.toContain('large for some chat windows');
    }
    expect(notice ?? '').not.toMatch(/\d+ lines/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/copyFoundation.test.ts packages/plugin/test/copyBrief.test.ts`
Expected: the compact-JSON test fails on `'  "'`; the caveat tests fail on `lines`.

- [ ] **Step 3: Implement the byte caveat and compaction**

In `packages/plugin/src/ui/actions.ts`, above `copyBriefFromSource`, add:

```ts
/** Above this, a copy warns that some chat windows will not take it whole. */
export const LARGE_COPY_BYTES = 200 * 1024;

/**
 * Size caveat for a copied payload, in kilobytes.
 *
 * Bytes, not lines: the DTCG clipboard is compact JSON on one line, and what
 * a chat window or an agent's context actually pays for is bytes. Leading
 * space so it appends to "Copied." the way the line-count string did.
 */
export function sizeCaveat(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes <= LARGE_COPY_BYTES) return '';
  return ` ${Math.round(bytes / 1024)} KB, which is large for some chat windows.`;
}
```

`TextEncoder` is fine here: `actions.ts` runs in the UI iframe, a real browser realm. It must never move to `main.ts`.

In `copyBriefFromSource`, replace:
```ts
    const lines = yaml.split('\n').length;
    const size = lines > 800 ? ` ${lines} lines, which is large for some chat windows.` : '';
```
with:
```ts
    const size = sizeCaveat(yaml);
```

In `deliverBrief`, replace:
```ts
    const lines = text.split('\n').length;
    const size = lines > 800 ? ` ${lines} lines, which is large for some chat windows.` : '';
```
with:
```ts
    const size = sizeCaveat(text);
```
and update its doc comment's "800-line threshold" to "size threshold".

In `foundationDtcgJson`, replace:
```ts
  return `${JSON.stringify(foundationDtcgDocument(artifact), null, 2)}\n`;
```
with:
```ts
  // Compact on purpose. Indented, a 360-variable file is 12,000 lines and
  // 424 KB; compact is roughly half the bytes and the same document. Files on
  // disk stay two-space through dtcgExportFiles, which is what the CLI writes.
  return `${JSON.stringify(foundationDtcgDocument(artifact))}\n`;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/plugin/test/copyFoundation.test.ts packages/plugin/test/copyBrief.test.ts && npm run typecheck && npm run lint`
Expected: PASS and exit 0. Other tests in `copyFoundation.test.ts` parse the copied text with `JSON.parse`, which does not care about whitespace.

- [ ] **Step 5: Update TESTING.md**

In Generate Foundation docs row 4, replace the first sentence:

```markdown
4. Click the Foundations footer's **Copy for AI** and paste into a plain text
   editor. Confirm it is JSON with `"version": "2025.10"`, one set or modifier
```
with:
```markdown
4. Click the Foundations footer's **Copy whole file for AI** and paste into a
   plain text editor. Confirm it is a single line of compact JSON that a
   formatter can pretty-print, with `"version": "2025.10"`, one set or modifier
```
and replace the end of the row:
```markdown
   Confirm the complete file-wide vocabulary is present regardless of source
   selection, and no canvas objects are created.
```
with:
```markdown
   Confirm the complete file-wide vocabulary is present regardless of source
   selection, and no canvas objects are created. Note the size the toast
   reports, if any; it appears above 200 KB and is measured in kilobytes.
```
(The footer label changes in Task 10; writing it here keeps the row correct after the branch merges.)

- [ ] **Step 6: Changelog and commit**

Add under `### Changed`:

```markdown
- The Foundation clipboard document is compact JSON on one line, roughly half
  the bytes of the indented form. Files written by the CLI are unchanged. The
  "large for some chat windows" notice now reports kilobytes above 200 KB
  instead of a line count, for both Foundation and component copies.
```

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/test/copyFoundation.test.ts packages/plugin/test/copyBrief.test.ts packages/plugin/TESTING.md CHANGELOG.md
git commit -m "feat(plugin): compact the dtcg clipboard and report copy size in kilobytes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Per-row Copy for AI on the Foundations screen

**Files:**
- Modify: `packages/plugin/src/ui/screens/foundations.ts:65-84` (`sourceRow`), `:91-150` (`foundationScrollMarkup`), `:186-190` (footer copy label)
- Modify: `packages/plugin/src/ui/design-system/patterns.css` near `.sl-foundation-summary` (line 1693)
- Modify: `packages/plugin/src/ui/ui-vnext.ts` click handler near line 1640 (`[data-foundation-source]` block)
- Modify: `packages/plugin/test/foundationScreen.test.ts`
- Modify: `packages/plugin/TESTING.md` Generate Foundation docs (new row)
- Modify: `CHANGELOG.md` under `### Added`

**Interfaces:**
- Consumes: `copyFoundationBriefForScope(scope: FoundationScope, ui)` from `actions.ts:727`; `FoundationScope` from `@spec-layer/extractor` (`{ target: 'collection'; collectionId; collectionName; modeIds: string[] } | { target: 'textStyles' }`); `copyPresenter()` from `ui-vnext.ts`; `currentFoundationSpec()` from `actions.ts`.
- Produces: row buttons `data-foundation-copy="<collectionId>"` and `data-foundation-copy="text-styles"`, disabled while `busy`. Footer id `sl-copy-foundation` unchanged, label `Copy whole file for AI`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/foundationScreen.test.ts` inside `describe('foundation screen', ...)`:

```ts
  it('gives every source row its own Copy for AI action', () => {
    const markup = foundationScrollMarkup({ kind: 'ready' }, SPEC, ALL);
    expect(markup).toContain('data-foundation-copy="colors"');
    expect(markup).toContain('data-foundation-copy="density"');
    expect(markup).toContain('data-foundation-copy="text-styles"');
    expect(markup).toContain('aria-label="Copy Mapped Colors for AI"');
    expect(markup).toContain('aria-label="Copy Text styles for AI"');
    expect(markup).toContain(ICON_PATHS.copy);
    expect(markup).not.toMatch(/data-foundation-copy="colors"[^>]*disabled/);
  });

  it('disables the row copies while the screen is loading or generating', () => {
    const generating = foundationScrollMarkup({ kind: 'generating', done: 0, total: 3 } as FoundationScreenState, SPEC, ALL);
    expect(generating).toMatch(/data-foundation-copy="colors"[^>]*disabled/);
  });

  it('keeps the row copy outside the checkbox button so a copy never toggles inclusion', () => {
    const markup = foundationScrollMarkup({ kind: 'ready' }, SPEC, ALL);
    const row = markup.slice(markup.indexOf('<article'), markup.indexOf('</article>') + 10);
    const summaryEnd = row.indexOf('</button>');
    expect(row.indexOf('data-foundation-copy')).toBeGreaterThan(summaryEnd);
  });

  it('names the footer copy as the whole file', () => {
    const footer = foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL);
    expect(footer).toContain('id="sl-copy-foundation"');
    expect(footer).toContain('Copy whole file for AI');
  });
```

If `FoundationScreenState`'s `generating` variant has different field names, open `packages/plugin/src/ui/viewModel/contracts.ts` and match them; the cast keeps the test compiling either way.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/foundationScreen.test.ts`
Expected: FAIL on `data-foundation-copy` and on the footer label.

- [ ] **Step 3: Add the row action and relabel the footer**

In `packages/plugin/src/ui/screens/foundations.ts`, change `sourceRow` to:

```ts
function sourceRow(options: {
  id: string;
  name: string;
  meta: string;
  checked: boolean;
  iconName: IconName;
  textStyles?: boolean;
  busy: boolean;
}): string {
  const action = options.checked ? 'Remove' : 'Include';
  return (
    '<article class="sl-foundation-row">' +
    `<button class="sl-foundation-summary" type="button" data-foundation-source="${esc(options.id)}"` +
    `${options.textStyles ? ' data-text-styles="true"' : ''} aria-pressed="${options.checked}" ` +
    `aria-label="${action} ${esc(options.name)} ${options.checked ? 'from' : 'in'} docs">` +
    checkbox(options.checked) +
    `<span class="sl-foundation-source-icon">${icon(options.iconName, 17)}</span>` +
    '<span class="sl-foundation-title">' +
    `<strong>${esc(options.name)}</strong><small>${esc(options.meta)}</small>` +
    '</span></button>' +
    // A sibling of the checkbox button, never inside it: a copy must not
    // toggle inclusion. One collection is what an agent usually needs, and
    // it stays well under the size the whole-file copy reaches.
    `<button class="sl-icon-button sl-foundation-copy" type="button" data-foundation-copy="${esc(options.id)}"` +
    `${options.textStyles ? ' data-text-styles="true"' : ''}` +
    ` aria-label="Copy ${esc(options.name)} for AI" title="Copy for AI"${options.busy ? ' disabled' : ''}>` +
    `${icon('copy', 17)}</button>` +
    '</article>'
  );
}
```

In `foundationScrollMarkup`, after `const summary = summarize(spec);` add:
```ts
  const busy = state.kind === 'loading' || state.kind === 'generating';
```
and pass `busy,` into both `sourceRow({...})` calls.

In `foundationFooterMarkup`, change the copy button's label:
```ts
      `${icon('copy', 15)}<span>Copy whole file for AI</span></button>`
```
and its comment above from "so an agent can grab the whole token vocabulary without waiting on (or being limited by) a source selection" to:
```ts
  // The whole file, named as such now that every row copies its own
  // collection. Kept one click away: the CLI writes the same document as
  // files, and some agents want the complete vocabulary.
```

- [ ] **Step 4: Lay the row out as a grid with the action at the end**

In `patterns.css`, change:
```css
.sl-foundation-row {
  border-bottom: 1px solid var(--sl-color-border-muted);
}
```
to:
```css
.sl-foundation-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid var(--sl-color-border-muted);
}

.sl-foundation-copy {
  margin-inline-end: var(--sl-space-8);
  color: var(--sl-color-text-muted);
}
```

`.sl-foundation-summary` already has `width: 100%`, which now fills the first column.

- [ ] **Step 5: Wire the click**

In `packages/plugin/src/ui/ui-vnext.ts`, directly above the `const foundationSource = target.closest<HTMLButtonElement>('[data-foundation-source]');` line (around line 1640), add:

```ts
  const foundationCopy = target.closest<HTMLButtonElement>('[data-foundation-copy]');
  if (foundationCopy?.dataset.foundationCopy) {
    copyFoundationRow(foundationCopy.dataset.foundationCopy, foundationCopy.dataset.textStyles === 'true');
    return;
  }
```

This sits inside the click handler's `if (operation.active) return;` guard, so a copy cannot start during a build.

Add near `copyPresenter()`:

```ts
/**
 * Copy one Foundations row: a collection with all of its modes, or the text
 * styles. Reuses the Library row's scoped copy, which widens a collection to
 * every mode and its local dependency closure. modeIds is a frame-only limit
 * the copy ignores, so it is passed empty.
 */
function copyFoundationRow(id: string, textStyles: boolean): void {
  if (textStyles) {
    void copyFoundationBriefForScope({ target: 'textStyles' }, copyPresenter());
    return;
  }
  const collection = currentFoundationSpec()?.collections.find((c) => c.id === id);
  if (!collection) {
    nativeNotify('That collection is no longer in this file. Nothing was copied.', { error: true, timeout: 5000 });
    return;
  }
  void copyFoundationBriefForScope(
    { target: 'collection', collectionId: collection.id, collectionName: collection.name, modeIds: [] },
    copyPresenter(),
  );
}
```

Confirm `currentFoundationSpec` and `copyFoundationBriefForScope` are imported from `./actions` at the top of `ui-vnext.ts` (`grep -n "currentFoundationSpec\|copyFoundationBriefForScope" packages/plugin/src/ui/ui-vnext.ts`); add either to the existing import list if missing. `nativeNotify` is already used throughout the file.

- [ ] **Step 6: Run the tests, typecheck, lint, build**

Run:
```bash
npx vitest run packages/plugin/test/foundationScreen.test.ts && npm run typecheck && npm run lint && npm run build:plugin
```
Expected: PASS and exit 0.

- [ ] **Step 7: Add the TESTING.md row**

In Generate Foundation docs, insert after row 4:

```markdown
5. Click the copy icon on one collection row and paste. Confirm the document
   contains that collection with all of its modes plus only the collections
   its aliases need, that the "included" checkbox did not toggle, and that the
   copy is much smaller than the whole-file copy. Repeat for the **Text
   styles** row and confirm only `sets["Typography styles"]` and its
   dependency collections appear.
```
and renumber the old row 5 to 6.

- [ ] **Step 8: Changelog and commit**

Add under `### Added`:

```markdown
- Every collection row and the text styles row on the Foundations screen has
  its own **Copy for AI**, producing the same scoped DTCG document a Library
  row copies. The footer copy is now labelled **Copy whole file for AI**.
```

```bash
git add packages/plugin/src/ui/screens/foundations.ts packages/plugin/src/ui/design-system/patterns.css packages/plugin/src/ui/ui-vnext.ts packages/plugin/test/foundationScreen.test.ts packages/plugin/TESTING.md CHANGELOG.md
git commit -m "feat(plugin): copy one foundation row for ai from the foundations screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Full gate, merge, and hand-off

**Files:**
- Modify: `CLAUDE.md` "Where things stand" section, `docs/superpowers/specs/2026-09-05-review-quick-wins-design.md` status line

- [ ] **Step 1: Run the full local gate**

Run: `npm run check`
Expected: exit 0. Read the exit status directly; do not pipe into another command.

- [ ] **Step 2: Em dash and NUL sweep on everything the branch touched**

Run:
```bash
cd "/Users/sandrolek/Documents/Projects/Design System Docs" && git diff --name-only main...HEAD | xargs node -e 'for (const f of process.argv.slice(1)) { const n = require("fs").readFileSync(f).filter((b) => b === 0).length; if (n) console.log(n, f); }'
```
Expected: prints nothing.

```bash
git diff main...HEAD -- packages/plugin/src | grep '^+' | grep -v '^+\s*//\|^+\s*\*\|^+\s*/\*' | grep -c '—'
```
Expected: prints `0` (grep exits 1 when the count is zero; that is the pass).

- [ ] **Step 3: Update the standing status**

In `CLAUDE.md`, under "Where things stand", add to the "Shipped and merged" list:

```markdown
- **2026-09-05 review quick wins.** Memoized resolver lookups, bulk variable
  reads, foundation dump posted once per read, in-panel confirmation dialogs,
  no non-component toast, Copy for AI on the component screen and per
  Foundations row, minified bundles, compact DTCG clipboard with a kilobyte
  size notice. Design in `docs/superpowers/specs/2026-09-05-review-quick-wins-design.md`.
```

Change the spec's status line to `**Status:** Implemented on branch review-quick-wins, merged to main <date>.`

Commit:
```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-05-review-quick-wins-design.md
git commit -m "docs: record the review quick wins as shipped

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Merge to `main` and push**

```bash
git checkout main && git merge --no-ff review-quick-wins -m "merge: review quick wins (2026-09-05 review items 4 to 11)" && npm run check && git push origin main && git branch -d review-quick-wins
```
Expected: fast merge, gate exits 0, push completes, branch deleted.

- [ ] **Step 5: Hand off the second Figma pass**

Tell the user which TESTING.md rows changed and need a run against the new build: Generate component docs row 5 and the closing paragraph (toast), Generate Foundation docs rows 1, 4, and 5, and Library row 10. Point them at `docs/reviews/2026-09-05-matrix-run.md` to append the second pass under a new heading `## Second pass, after the quick wins`.
