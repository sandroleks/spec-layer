# Phase 1: Decouple the remaining actions from the legacy DOM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every action in `actions.ts` drivable by a UI that is not the legacy DOM, so the four remaining vNext screens can be built at all.

**Architecture:** Each coupled function uses `Refs` for exactly three things: status text, progress narration, and a busy button. One `BuildPresenter` interface covers all three. Choices the legacy UI stored in its DOM become values passed in. Legacy keeps its exact behavior through thin adapters that read its DOM and construct a presenter, exactly as `runCreateDocFrame` already does.

**Tech Stack:** TypeScript, esbuild, Vitest. No framework, no new dependencies.

## Global Constraints

- **No new runtime dependencies.** The plugin ships as one embedded `ui.html`.
- **No jsdom.** Test pure functions and presenters with fakes; never a fake DOM.
- **No visible change.** This phase ships zero UI difference. The legacy UI is still what users get, and its behavior must be identical afterwards.
- **Coverage is a ratchet** (`vitest.config.ts`: statements 45, branches 40, functions 50, lines 45). It may only go up.
- **Voice:** never em dashes in user-facing plugin copy. Every user-facing string in this phase is *moved*, never reworded.
- **Do not modify:** `docModel.ts`, `foundationState.ts`, `theme.ts`, `docLink.ts`, `messages.ts`. `foundationState.ts` is already pure and is consumed as-is.
- **`render.ts` is legacy presentation.** Do not decouple it; it is deleted in Phase 8.

**Scope:** Phase 1 of `docs/superpowers/plans/2026-07-29-plugin-ui-vnext-roadmap.md`.

## The substitution table

Every task below transforms a function body by the same mechanical rules. Apply
these and change nothing else inside the body:

| Legacy call | Becomes |
|---|---|
| `clearBanners(refs)` | `ui.clear()` |
| `showBanner(refs, 'error', X)` | `ui.error(X)` |
| `showBanner(refs, 'info', X)` | `ui.info(X)` |
| `startLoader(refs.loader, refs.loaderText, M)` | `ui.startProgress(M)` |
| `stopLoader(refs.loader)` | `ui.stopProgress()` |
| `refs.<anyButton>.disabled = X` | `ui.setBusy(X)` |
| `refs.sectionChecks[...]` / `refs.variantList` | a `DocSelection` parameter |

Preserve the order of these calls exactly. The sequence of disable, narrate,
work, stop, re-enable is what stops a double-click producing two frames.

---

### Task 1: Widen the presenter

`BuildPresenter.startProgress(withAi: boolean)` only suits the create path.
Download, update, and the foundation build each narrate differently, so the
presenter takes the messages instead of a boolean. `info` is added because
`runDownload` and `runUpdateFromSource` report success, which the create path
never needed.

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts`
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Test: `packages/plugin/test/componentScreen.test.ts`

**Interfaces:**
- Produces: `BuildPresenter { clear(): void; error(m: string): void; info(m: string): void; setBusy(b: boolean): void; startProgress(messages: string[]): void; stopProgress(): void }`, and `generatingMessages(withAi: boolean): string[]` becomes exported.

- [ ] **Step 1: Update the interface**

In `actions.ts`, replace the `BuildPresenter` interface with:

```ts
export interface BuildPresenter {
  /** Clear any status left over from a previous run. */
  clear(): void;
  /** Show a failure the user needs to read. */
  error(message: string): void;
  /** Report an outcome that is not a failure. */
  info(message: string): void;
  /** Disable or re-enable the action that started this build. */
  setBusy(busy: boolean): void;
  /** Begin the "working on it" narration with the given lines. */
  startProgress(messages: string[]): void;
  stopProgress(): void;
}
```

- [ ] **Step 2: Export the message builder and update the two call sites**

In `actions.ts`, change `function generatingMessages(` to
`export function generatingMessages(`.

In `createDocFrame`, replace:

```ts
  ui.startProgress(willGenerateProseFor(state, selection.sections));
```

with:

```ts
  ui.startProgress(generatingMessages(willGenerateProseFor(state, selection.sections)));
```

In `refsPresenter`, replace the `startProgress` line with:

```ts
    startProgress: (messages) => startLoader(refs.loader, refs.loaderText, messages),
```

- [ ] **Step 3: Update the vNext presenter**

In `ui-vnext.ts`, the `presenter()` object gains an `info` member and its
`startProgress` drops its parameter. Replace the `startProgress` entry and add
`info` directly above it:

```ts
    info: () => {
      // The component screen learns about success from docFrameDone, which
      // carries whether the frame was replaced. An info line here would be a
      // second, less informed source for the same fact.
    },
    startProgress: () => {
      screen = { kind: 'building', componentName: currentName() };
      paint();
    },
```

- [ ] **Step 4: Extend the presenter fake in the tests**

In `packages/plugin/test/componentScreen.test.ts`, add `info` to the object
returned by `fakePresenter`, directly after the `error` member:

```ts
      info: vi.fn(),
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: all pass. Typecheck is the real gate here: it finds every presenter
that has not grown its `info` member.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/src/ui/ui-vnext.ts packages/plugin/test/componentScreen.test.ts
git commit -m "refactor(plugin): widen BuildPresenter for the other build paths"
```

---

### Task 2: Decouple auto-extract

`runAutoExtract` writes the reading state straight into `refs.phaseLabel`. The
vNext screen has its own `reading` state and needs the same signal.

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:175`
- Modify: `packages/plugin/src/ui/ui.ts`
- Test: `packages/plugin/test/autoExtract.test.ts`

**Interfaces:**
- Produces: `autoExtract(state: UiState, onReading: (reading: boolean) => void, onReady?: () => void): void`, and `runAutoExtract(refs, state, onReady?)` kept as the legacy adapter.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/autoExtract.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { autoExtract, createState } from '../src/ui/actions';

describe('autoExtract', () => {
  it('does nothing without a selected node', () => {
    const onReading = vi.fn();
    autoExtract(createState(), onReading);
    expect(onReading).not.toHaveBeenCalled();
  });

  it('reports ready immediately when a spec is already extracted', () => {
    const state = createState();
    state.currentSpec = { name: 'x' } as never;
    state.currentNode = { id: '1', name: 'x' } as never;
    const onReady = vi.fn();
    autoExtract(state, vi.fn(), onReady);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/autoExtract.test.ts`
Expected: FAIL, `autoExtract` is not exported.

- [ ] **Step 3: Split the function**

In `actions.ts`, replace the whole `runAutoExtract` function with the pair
below. The body is the original, with `refs.phaseLabel` writes replaced by
`onReading` calls:

```ts
/**
 * Extract the current selection off the critical path.
 *
 * `onReading` brackets the synchronous extraction so a UI can show that it is
 * busy: extraction blocks the thread, so the caller has to paint before it
 * starts and again when it ends.
 */
export function autoExtract(
  state: UiState,
  onReading: (reading: boolean) => void,
  onReady?: () => void,
): void {
  if (!state.currentNode) return;
  if (state.currentSpec) { onReady?.(); return; }
  onReading(true);
  requestAnimationFrame(() => {
    try {
      ensureExtracted(state);
    } catch {
      /* errors surface when an action actually runs */
    }
    onReading(false);
    onReady?.();
  });
}

/** Legacy adapter: drives the old phase-label chip. */
export function runAutoExtract(refs: Refs, state: UiState, onReady?: () => void): void {
  autoExtract(
    state,
    (reading) => {
      refs.phaseLabel.className = reading ? 'chip' : 'phase-label';
      refs.phaseLabel.textContent = reading ? 'Reading…' : '';
    },
    onReady,
  );
}
```

Check the original body before deleting it: if it calls anything after
`onReady?.()`, carry that across too.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: all pass, including the two new cases.

- [ ] **Step 5: Point the vNext screen at it**

In `ui-vnext.ts`, the `selection` message handler currently calls
`ensureExtracted` inside its own `requestAnimationFrame`. Replace that block
with `autoExtract`, so both UIs share one extraction path:

```ts
      screen = { kind: 'reading', componentName: node.name };
      paint();
      autoExtract(
        state,
        () => { /* the reading state is already painted */ },
        () => {
          screen = { kind: 'ready', componentName: node.name };
          paint();
        },
      );
```

Add `autoExtract` to the `./actions` import and drop `ensureExtracted` if it is
no longer used there.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/src/ui/ui-vnext.ts packages/plugin/test/autoExtract.test.ts
git commit -m "refactor(plugin): split autoExtract from its legacy phase label"
```

---

### Task 3: Decouple download

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:502`
- Test: `packages/plugin/test/downloadDoc.test.ts`

**Interfaces:**
- Produces: `downloadDoc(state: UiState, selection: DocSelection, ui: BuildPresenter): Promise<void>`, with `runDownload(refs, state)` kept as the legacy adapter.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/downloadDoc.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createState, downloadDoc, type BuildPresenter } from '../src/ui/actions';

function fakePresenter(): BuildPresenter & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    clear: vi.fn(),
    error: (m: string) => { errors.push(m); },
    info: vi.fn(),
    setBusy: vi.fn(),
    startProgress: vi.fn(),
    stopProgress: vi.fn(),
  };
}

describe('downloadDoc', () => {
  it('refuses without a component', async () => {
    const ui = fakePresenter();
    await downloadDoc(createState(), { sections: new Set(), variantIds: new Set() }, ui);
    expect(ui.errors).toEqual(['Select a component first.']);
  });

  it('never leaves the button stuck busy after refusing', async () => {
    const ui = fakePresenter();
    await downloadDoc(createState(), { sections: new Set(), variantIds: new Set() }, ui);
    expect(ui.setBusy).not.toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/downloadDoc.test.ts`
Expected: FAIL, `downloadDoc` is not exported.

- [ ] **Step 3: Rename and rewire**

Rename `runDownload` to `downloadDoc`, change its signature to
`(state: UiState, selection: DocSelection, ui: BuildPresenter)`, and apply the
substitution table to its body. It already calls `selectionFromRefs` and
`assembleDocFor` from Task 1 of the earlier phase; replace the internal
`selectionFromRefs(refs)` call with the `selection` parameter.

Then add the adapter directly beneath it:

```ts
export function runDownload(refs: Refs, state: UiState): Promise<void> {
  return downloadDoc(state, selectionFromRefs(refs), refsPresenter(refs, refs.downloadBtn));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: all pass. `actionsRun.test.ts` covers the legacy download path; if it
fails, the substitution changed an order of operations and must be corrected
rather than the test relaxed.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/test/downloadDoc.test.ts
git commit -m "refactor(plugin): take download off the legacy refs"
```

---

### Task 4: Decouple the two from-source actions

These two power Library rows. Both already receive their input as a `src`
argument rather than from the DOM, so only presentation is coupled.

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts` (`runUpdateFromSource`, `runDownloadFromSource`)
- Test: `packages/plugin/test/fromSource.test.ts`

**Interfaces:**
- Produces:
  - `updateFromSource(state: UiState, src: DocSource, ui: BuildPresenter): Promise<boolean>`
  - `downloadFromSource(state: UiState, src: DocSource, ui: BuildPresenter): Promise<void>`
  - `type DocSource = { docId: string; node: SerializedNode; fileKey: string; config: DocConfig }`
  - `runUpdateFromSource(refs, state, src)` and `runDownloadFromSource(refs, state, src)` kept as legacy adapters.

- [ ] **Step 1: Name the argument type**

In `actions.ts`, directly above `runUpdateFromSource`, add:

```ts
/** A library row's stored source: what it was built from, and how. */
export type DocSource = {
  docId: string;
  node: SerializedNode;
  fileKey: string;
  config: DocConfig;
};
```

Use `DocSource` in both function signatures in place of the inline object type.

- [ ] **Step 2: Write the failing test**

Create `packages/plugin/test/fromSource.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createState, updateFromSource, type BuildPresenter, type DocSource } from '../src/ui/actions';

function fakePresenter(): BuildPresenter & { errors: string[]; progress: string[][] } {
  const errors: string[] = [];
  const progress: string[][] = [];
  return {
    errors,
    progress,
    clear: vi.fn(),
    error: (m: string) => { errors.push(m); },
    info: vi.fn(),
    setBusy: vi.fn(),
    startProgress: (messages: string[]) => { progress.push(messages); },
    stopProgress: vi.fn(),
  };
}

const badSource = {
  docId: 'd1',
  node: { id: 'n1', name: 'broken' },
  fileKey: 'f1',
  config: { sections: [], variantIds: [], aiEnabled: false },
} as unknown as DocSource;

describe('updateFromSource', () => {
  it('narrates before it starts working', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), badSource, ui);
    expect(ui.progress[0]).toEqual([
      'Reading the component',
      'Composing sections',
      'Placing the frame on the canvas',
    ]);
  });

  it('reports failure through the presenter rather than throwing', async () => {
    const ui = fakePresenter();
    await expect(updateFromSource(createState(), badSource, ui)).resolves.toBe(false);
    expect(ui.errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/fromSource.test.ts`
Expected: FAIL, `updateFromSource` is not exported.

- [ ] **Step 4: Rename both and add adapters**

Rename to `updateFromSource` and `downloadFromSource`, replace their `refs`
parameter with `ui: BuildPresenter`, and apply the substitution table. Then add:

```ts
export function runUpdateFromSource(
  refs: Refs, state: UiState, src: DocSource,
): Promise<boolean> {
  return updateFromSource(state, src, refsPresenter(refs, refs.createFrameBtn));
}

export function runDownloadFromSource(
  refs: Refs, state: UiState, src: DocSource,
): Promise<void> {
  return downloadFromSource(state, src, refsPresenter(refs, refs.downloadBtn));
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/test/fromSource.test.ts
git commit -m "refactor(plugin): take the from-source actions off the legacy refs"
```

---

### Task 5: Decouple the foundation handlers

These four keep their state in module variables and repaint by calling
`paintFoundations(refs)` directly. Registering a host lets either UI receive
that repaint.

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:693-780`
- Modify: `packages/plugin/src/ui/ui.ts`
- Test: `packages/plugin/test/foundationHost.test.ts`

**Interfaces:**
- Produces:
  - `interface FoundationHost { repaint(): void; setBusy(busy: boolean): void; startProgress(messages: string[]): void; stopProgress(): void }`
  - `setFoundationHost(host: FoundationHost): void`
  - `onFoundationMessage(dump: SerializedFoundation): void`
  - `onFoundationToggleAll(): void`
  - `onFoundationCheckboxChange(input: HTMLInputElement): void`
  - `setFoundationGenerating(value: boolean): void`
  - `currentFoundationSpec(): FoundationSpec | null`
  - `currentFoundationSelection()` and `isFoundationGenerating()` unchanged.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/foundationHost.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isFoundationGenerating,
  setFoundationGenerating,
  setFoundationHost,
  type FoundationHost,
} from '../src/ui/actions';

function fakeHost(): FoundationHost & { progress: string[][]; busy: boolean[] } {
  const progress: string[][] = [];
  const busy: boolean[] = [];
  return {
    progress,
    busy,
    repaint: vi.fn(),
    setBusy: (v: boolean) => { busy.push(v); },
    startProgress: (m: string[]) => { progress.push(m); },
    stopProgress: vi.fn(),
  };
}

describe('setFoundationGenerating', () => {
  let host: ReturnType<typeof fakeHost>;

  beforeEach(() => {
    host = fakeHost();
    setFoundationHost(host);
  });

  it('marks the build in flight so the shared lock can see it', () => {
    setFoundationGenerating(true);
    expect(isFoundationGenerating()).toBe(true);
    setFoundationGenerating(false);
    expect(isFoundationGenerating()).toBe(false);
  });

  it('disables and re-enables through the host', () => {
    setFoundationGenerating(true);
    setFoundationGenerating(false);
    expect(host.busy).toEqual([true, false]);
  });

  it('starts narration on the way in and stops it on the way out', () => {
    setFoundationGenerating(true);
    expect(host.progress).toHaveLength(1);
    setFoundationGenerating(false);
    expect(host.stopProgress).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/foundationHost.test.ts`
Expected: FAIL, `setFoundationHost` is not exported.

- [ ] **Step 3: Add the host and drop the refs parameters**

In `actions.ts`, directly above `paintFoundations`, add:

```ts
/**
 * How the foundation state reaches a UI.
 *
 * The four handlers below mutate module state and then need something
 * repainted. Registering a host is what lets either UI receive that, instead
 * of the handlers reaching for one specific set of DOM nodes.
 */
export interface FoundationHost {
  repaint(): void;
  setBusy(busy: boolean): void;
  startProgress(messages: string[]): void;
  stopProgress(): void;
}

const noopHost: FoundationHost = {
  repaint: () => {},
  setBusy: () => {},
  startProgress: () => {},
  stopProgress: () => {},
};

let foundationHost: FoundationHost = noopHost;

export function setFoundationHost(host: FoundationHost): void {
  foundationHost = host;
}

/** The parsed file, for a UI that renders its own foundation rows. */
export function currentFoundationSpec(): FoundationSpec | null {
  return foundationSpec;
}
```

Import `FoundationSpec` as a type from `@spec-layer/extractor` if it is not
already imported.

Now change the four handlers: drop their `refs` parameter, and replace every
`paintFoundations(refs)` call with `foundationHost.repaint()`. In
`setFoundationGenerating`, apply the substitution table: the button line
becomes `foundationHost.setBusy(value)`, the `startLoader` call becomes
`foundationHost.startProgress(foundationBuildMessages(...))`, and `stopLoader`
becomes `foundationHost.stopProgress()`.

Delete `paintFoundations` once nothing calls it.

- [ ] **Step 4: Register the legacy host in `ui.ts`**

In `ui.ts`, directly after `const refs = mount();`, add:

```ts
// The legacy foundation host: the same repaint, button, and loader the
// handlers used to reach for directly.
setFoundationHost({
  repaint: () => {
    const spec = currentFoundationSpec();
    if (!spec) return;
    renderFoundationPanel(
      refs, spec, summarize(spec), currentFoundationSelection(),
      emptyStateLines(spec), isFoundationGenerating(),
    );
  },
  setBusy: (busy) => { refs.createFrameBtn.disabled = busy; },
  startProgress: (messages) =>
    startLoader(refs.foundationLoader, refs.foundationLoaderText, messages),
  stopProgress: () => stopLoader(refs.foundationLoader),
});
```

Add `setFoundationHost` and `currentFoundationSpec` to the `./actions` import,
and `summarize` plus `emptyStateLines` from `./foundationState` if they are not
already imported. Then remove the now-stale `refs` argument from every
`onFoundation*` and `setFoundationGenerating` call site in `ui.ts`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: all pass. `foundationState.test.ts` and any foundation integration
test must stay green; they cover the behavior this task must not change.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/src/ui/ui.ts packages/plugin/test/foundationHost.test.ts
git commit -m "refactor(plugin): give the foundation handlers a host instead of refs"
```

---

### Task 6: Prove the legacy UI is unchanged

This phase claims zero visible change. That claim needs evidence, because every
task above rewrote a function the shipped UI depends on.

**Files:**
- No source changes expected.

- [ ] **Step 1: Run every gate**

```bash
npm run lint && npm run typecheck && npm test && npm run test:coverage && npm run build:plugin
```

Judge lint by exit code, not by its count of pre-existing warnings. Report the
real coverage numbers against the floors (statements 45, branches 40, functions
50, lines 45). Do not lower a threshold; if one fails, add tests.

- [ ] **Step 2: Confirm the default build is still legacy**

```bash
cd packages/plugin
node build.mjs
grep -c "tab-panel-selected" dist/ui.html   # expect 3
grep -c "sl-color-canvas" dist/ui.html      # expect 0
```

- [ ] **Step 3: Manual Figma pass on the legacy UI**

Import `packages/plugin/manifest.json` in Figma Desktop from a plain build and
confirm, on the legacy UI:

- Selecting a component shows the reading chip, then the section list.
- `Create frame` builds a frame; a second click during the build is refused.
- `Download` saves markdown matching the frame.
- The Foundations tab reads the file, toggles rows and the head link, and
  builds frames with its loader running.
- A My Library row updates and downloads from source.

Any difference from before this phase is a defect in the substitution, not an
acceptable change.

- [ ] **Step 4: Commit any fixes, then record completion**

```bash
git commit -am "fix(plugin): <what the manual pass caught>"
```

If the pass is clean, there is nothing to commit and the phase is done.
