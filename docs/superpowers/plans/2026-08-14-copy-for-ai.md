# Copy for AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Copy action that puts a YAML brief for an AI coding agent on the clipboard, replacing the Markdown download removed in `77f1412`.

**Architecture:** Four phases. Phase 1 builds the clipboard utility and measures which access tier actually works inside a Figma plugin iframe, because that answer changes the surface design and everything else is wasted if no tier works. Phase 2 persists `ProseDrafts` under its own pluginData key so Copy can include guidelines without regenerating them. Phase 3 adds two pure extractor modules, a hand-rolled YAML emitter and a brief projection, with js-yaml as a dev-only dependency proving the emitter's escaping. Phase 4 wires the two surfaces.

**Tech Stack:** TypeScript (strict), vitest, npm workspaces. Packages: `@spec-layer/extractor`, `@spec-layer/plugin`.

**Spec:** `docs/superpowers/specs/2026-08-14-copy-for-ai-design.md`

## Global Constraints

- **Never use em dashes in any plugin UI copy.** Plain, honest peer tone. Rules in `docs/plugin-voice-and-copy.md`.
- **No new runtime dependency in the plugin bundle.** js-yaml is `devDependencies` only. `ui.html` is already about 630 kB.
- **`packages/extractor` must stay free of Figma globals** so it runs under vitest. Figma access goes through `packages/plugin/src/serialize.ts` and `serializeFoundation.ts`.
- **Run `npm run check:ci` before every commit.** It is currently green with 0 vulnerabilities. A red `verify` is a real regression.
- **All 1174 existing tests must stay green** unless a task explicitly changes an assertion and says why.
- **Copy never mutates anything.** No canvas node, no pluginData, no quota, no `generateProse` call.
- **`EXTRACTOR_VERSION`** (`packages/extractor/src/version.ts`) means "extraction output changed, rebuild". The brief's own `version` is separate and changes only when the brief's shape changes.

## Deviations from the spec

Three places where the spec's illustrative YAML did not match the real types. The types win.

1. `PropKind` is `'variant' | 'boolean' | 'text' | 'instanceSwap'` (`props.ts:5`). The brief emits `instanceSwap` verbatim, not the spec's `instance-swap`. Renaming would be lossy for no gain.
2. `ContrastFinding` (`contrast.ts:79`) has no `result` field, because `checkContrast` only pushes a finding when `ratio < required` (`contrast.ts:344`). Every finding is a failure, so the spec's `result: fail` is dropped as redundant. `measured` and `skipped` counts still distinguish "checked and clean" from "could not check".
3. `ContrastReport.evaluated` is emitted as `measured`, which reads better in a brief. This is a projection choice, applied consistently.
4. The spec's "Prose persistence" section says the writer "truncates and records a diagnostic" on an over-budget payload. The implementation drops the whole payload instead and logs the drop, which is better: half a guideline set presented as complete is worse than none, and the brief already states plainly when guidelines are absent. Truncating would have to guess where a safe cut point is inside arbitrary AI-written prose; dropping needs no such guess and can never emit a guideline that reads as complete but silently ends mid-sentence.

## File Structure

**Created:**
- `packages/extractor/src/yaml.ts` — deterministic YAML emitter for closed, known shapes. Not a general library.
- `packages/extractor/src/brief.ts` — `componentBrief` and `foundationBrief` projections.
- `packages/extractor/test/yaml.test.ts`
- `packages/extractor/test/brief.test.ts`
- `packages/plugin/src/ui/clipboard.ts` — three-tier clipboard write.
- `packages/plugin/test/clipboard.test.ts`

**Modified:**
- `packages/extractor/src/index.ts` — export `yaml`, `brief`.
- `packages/plugin/src/docLink.ts` — `DOC_PROSE_KEY`, `serializeProse`, `parseProse`.
- `packages/plugin/src/main.ts` — write prose at frame creation, serve it on request.
- `packages/plugin/src/messages.ts` — `requestDocProse` / `docProse` messages, `canCopy` on library entries.
- `packages/plugin/src/ui/actions.ts` — `copyBriefFromSource`, `copyFoundationBrief`.
- `packages/plugin/src/ui/ui-vnext.ts` — Copy row action and foundations Copy wiring.
- `packages/plugin/src/ui/screens/library.ts` — Copy menu item.
- `packages/plugin/src/ui/screens/foundations.ts` — Copy footer button.
- `packages/plugin/src/ui/shell/icons.ts` — `copy` glyph.
- `packages/plugin/src/ui/viewModel/contracts.ts`, `viewModel/library.ts` — `canCopy`.
- `package.json` — js-yaml devDependency.

---

# Phase 1 — Clipboard

### Task 1: Three-tier clipboard write

The riskiest part of the feature, deliberately first. `navigator.clipboard.writeText` is often blocked by permissions policy inside a Figma plugin iframe. The textarea plus `document.execCommand('copy')` fallback only works inside the user-gesture call stack, and async extraction destroys that stack. Tier 3 is the correctness floor and always works.

**Files:**
- Create: `packages/plugin/src/ui/clipboard.ts`
- Create: `packages/plugin/test/clipboard.test.ts`

**Interfaces:**
- Produces: `copyText(text: string): Promise<CopyTier>` where `type CopyTier = 'async' | 'exec' | 'manual'`. Returns the tier that succeeded. Never throws. Tier `'manual'` means the caller must show the text for the user to copy by hand.
- Produces: `renderManualCopyModal(text: string): void` — appends a modal with a pre-selected textarea to `document.body`.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/clipboard.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyText } from '../src/ui/clipboard';

const g = globalThis as Record<string, unknown>;
const hadDocument = 'document' in g;

function stubDom(execResult: boolean) {
  const el = { value: '', style: {} as Record<string, string>, select: () => {}, setSelectionRange: () => {}, focus: () => {} };
  g.document = {
    createElement: () => el,
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => execResult,
  };
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (!hadDocument) delete g.document;
});

describe('copyText', () => {
  it('uses the async clipboard when it resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubDom(true);
    expect(await copyText('hello')).toBe('async');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the async clipboard rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } });
    const el = stubDom(true);
    expect(await copyText('payload')).toBe('exec');
    expect(el.value).toBe('payload');
  });

  it('falls back to execCommand when navigator.clipboard is absent entirely', async () => {
    vi.stubGlobal('navigator', {});
    stubDom(true);
    expect(await copyText('payload')).toBe('exec');
  });

  it('reports manual when both automatic tiers fail', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    stubDom(false);
    expect(await copyText('payload')).toBe('manual');
  });

  it('never throws when execCommand itself throws', async () => {
    vi.stubGlobal('navigator', {});
    g.document = {
      createElement: () => ({ value: '', style: {}, select: () => {}, setSelectionRange: () => {}, focus: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => { throw new Error('denied'); },
    };
    expect(await copyText('payload')).toBe('manual');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/clipboard.test.ts`
Expected: FAIL, cannot find module `../src/ui/clipboard`.

- [ ] **Step 3: Write the implementation**

Create `packages/plugin/src/ui/clipboard.ts`:

```ts
/**
 * clipboard.ts — writing text to the clipboard from a Figma plugin iframe.
 *
 * Three tiers, because no single mechanism is reliable here:
 *
 *   1. navigator.clipboard.writeText, which the iframe's permissions policy
 *      often blocks outright.
 *   2. A hidden textarea plus document.execCommand('copy'), which only works
 *      inside the user-gesture call stack. An awaited extraction between the
 *      click and this call destroys that stack, so tier 2 can fail for a
 *      reason that has nothing to do with permissions.
 *   3. Showing the text and letting the user copy it. Always works, and is
 *      the reason this function never needs to throw.
 *
 * Callers branch on the returned tier rather than on success, since 'manual'
 * is a real outcome the UI has to narrate, not an error.
 */

export type CopyTier = 'async' | 'exec' | 'manual';

async function tryAsync(text: string): Promise<boolean> {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
  const writeText = nav?.clipboard?.writeText;
  if (typeof writeText !== 'function') return false;
  try {
    await writeText.call(nav!.clipboard, text);
    return true;
  } catch {
    return false;
  }
}

function tryExec(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Off-screen rather than display:none: a hidden element cannot be selected,
    // and an unselected textarea makes execCommand('copy') a no-op.
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      return document.execCommand('copy') === true;
    } finally {
      document.body.removeChild(ta);
    }
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<CopyTier> {
  if (await tryAsync(text)) return 'async';
  if (tryExec(text)) return 'exec';
  return 'manual';
}

/**
 * Tier 3. Renders the payload in a pre-selected textarea so the user can copy
 * it with the keyboard. Returns a disposer the caller uses to dismiss it.
 */
export function renderManualCopyModal(text: string): () => void {
  const host = document.createElement('div');
  host.className = 'sl-copy-fallback';
  host.innerHTML =
    '<div class="sl-copy-fallback-panel">' +
    '<p>Select the text below and press Cmd C.</p>' +
    '<textarea readonly rows="12"></textarea>' +
    '<button type="button" data-copy-fallback-close>Close</button>' +
    '</div>';
  const ta = host.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = text;
  const dispose = () => { if (host.parentNode) document.body.removeChild(host); };
  (host.querySelector('[data-copy-fallback-close]') as HTMLButtonElement)
    .addEventListener('click', dispose);
  document.body.appendChild(host);
  ta.focus();
  ta.select();
  return dispose;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/clipboard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run check:ci > /tmp/ci.log 2>&1; echo $?`
Expected: `0`.

Do NOT verify with a pipe such as `npm run check:ci | tail -20`. A pipeline reports the exit code of the last command, so a red gate reads as green. Redirect and echo `$?`.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/clipboard.ts packages/plugin/test/clipboard.test.ts
git commit -m "feat(plugin): three-tier clipboard write for the Copy action"
```

- [ ] **Step 7: Spike the real environment before continuing**

This is a manual step and it gates the rest of the plan.

1. Add a temporary button to the component screen footer that calls `copyText('spec-layer clipboard probe')` and shows the returned tier via `nativeNotify`.
2. Build: `npm run build:plugin:vnext`
3. Load the plugin in Figma, click the button, record which tier fires.
4. Repeat with an `await new Promise(r => setTimeout(r, 300))` before the `copyText` call, to simulate extraction latency destroying the user gesture. Record the tier again.
5. Remove the temporary button. Do not commit it.

Record the result in this plan under Task 8, because it decides the surface:

- Both probes return `async`: Copy is one click, nothing changes.
- Immediate returns `exec` but delayed returns `manual`: the brief must be precomputed when the row menu opens so the click is synchronous. Task 8 changes accordingly.
- Both return `manual`: Copy always shows the tier-3 modal. Task 8 drops the toast path and always renders the modal.

---

# Phase 2 — Prose persistence

### Task 2: Store and read ProseDrafts under their own key

`ComponentDocLink` has no prose field, and `ai.ts`'s cache is an in-memory `Map` that dies with the session, so the only durable copy of generated guidelines is text inside the rendered frame. Prose gets its own pluginData key rather than joining the doc link, because the library scan parses every documented Section's link on every refresh (`main.ts:680`), and prose there would tax a hot path to draw a row that never shows it.

**Files:**
- Modify: `packages/plugin/src/docLink.ts`
- Modify: `packages/plugin/test/docLink.test.ts`

**Interfaces:**
- Consumes: `ProseDrafts` from `@spec-layer/extractor`.
- Produces: `DOC_PROSE_KEY: string`, `serializeProse(p: ProseDrafts): string`, `parseProse(raw: string): ProseDrafts | null`, `PROSE_BUDGET_BYTES: number`.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/docLink.test.ts`:

```ts
import { DOC_PROSE_KEY, serializeProse, parseProse, PROSE_BUDGET_BYTES } from '../src/docLink';
import type { ProseDrafts } from '@spec-layer/extractor';

const PROSE: ProseDrafts = {
  definition: 'A button triggers an action.',
  accessibility: 'Always give it an accessible name.',
  dos: ['Use sentence case.'],
  donts: ['Do not nest buttons.'],
  interactions: 'Hover raises the surface.',
};

describe('prose storage', () => {
  it('uses a key distinct from the doc link, so the library scan never reads it', () => {
    expect(DOC_PROSE_KEY).not.toBe('specLayerDoc');
  });

  it('round-trips every populated field', () => {
    expect(parseProse(serializeProse(PROSE))).toEqual(PROSE);
  });

  it('returns null for absent or unparseable data rather than throwing', () => {
    expect(parseProse('')).toBeNull();
    expect(parseProse('not json')).toBeNull();
    expect(parseProse('[]')).toBeNull();
  });

  it('drops a payload over budget rather than writing a truncated document', () => {
    const huge: ProseDrafts = { ...PROSE, definition: 'x'.repeat(PROSE_BUDGET_BYTES + 1) };
    expect(serializeProse(huge)).toBe('');
  });

  it('omits absent optional keys instead of writing empty strings', () => {
    const minimal: ProseDrafts = { definition: 'D', accessibility: 'A', dos: [], donts: [] };
    const parsed = parseProse(serializeProse(minimal));
    expect(parsed).toEqual(minimal);
    expect(parsed && 'interactions' in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: FAIL, no exported member `DOC_PROSE_KEY`.

- [ ] **Step 3: Write the implementation**

Add to `packages/plugin/src/docLink.ts`, below `DOC_REGISTRY_KEY`:

```ts
/**
 * Generated guidelines for a component doc, stored beside its link rather than
 * inside it.
 *
 * The library scan parses every documented Section's DOC_LINK_KEY on every
 * refresh. Prose is kilobytes of text that no library row displays, so putting
 * it in that blob would make a hot path pay for data it never reads. A separate
 * key is read only when Copy actually needs it.
 */
export const DOC_PROSE_KEY = 'specLayerProse';

/**
 * Ceiling on a serialized prose blob. Figma caps plugin data at 100 kB per
 * node and the doc link shares that budget, so this sits well below it.
 * A payload over budget is dropped whole: half a guideline set presented as
 * complete is worse than none, and the brief already states when guidelines
 * are absent.
 */
export const PROSE_BUDGET_BYTES = 64 * 1024;

const PROSE_STRING_KEYS = [
  'definition', 'accessibility', 'interactions',
  'variantsSummary', 'anatomySummary', 'designConsiderations', 'contentConsiderations',
] as const;

export function serializeProse(p: ProseDrafts): string {
  const out = JSON.stringify(p);
  // Figma stores plugin data as UTF-8; measure encoded length, not UTF-16 units.
  return new TextEncoder().encode(out).length > PROSE_BUDGET_BYTES ? '' : out;
}

export function parseProse(raw: string): ProseDrafts | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (typeof o.definition !== 'string' || typeof o.accessibility !== 'string') return null;

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  const out: ProseDrafts = {
    definition: o.definition,
    accessibility: o.accessibility,
    dos: strings(o.dos),
    donts: strings(o.donts),
  };
  for (const k of PROSE_STRING_KEYS) {
    if (k === 'definition' || k === 'accessibility') continue;
    if (typeof o[k] === 'string') (out as Record<string, unknown>)[k] = o[k];
  }
  if (Array.isArray(o.anatomyParts)) {
    (out as Record<string, unknown>).anatomyParts = o.anatomyParts;
  }
  return out;
}
```

Add the type import at the top of `docLink.ts`:

```ts
import type { ProseDrafts } from '@spec-layer/extractor';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate and commit**

```bash
npm run check:ci > /tmp/ci.log 2>&1; echo $?
git add packages/plugin/src/docLink.ts packages/plugin/test/docLink.test.ts
git commit -m "feat(plugin): store generated guidelines under their own pluginData key"
```

---

### Task 3: Write prose at frame creation and serve it on request

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/main.ts`
- Modify: `packages/plugin/src/ui/actions.ts:348-390` (`createDocFrame`)
- Modify: `packages/plugin/test/integration.test.ts`

**Interfaces:**
- Consumes: `DOC_PROSE_KEY`, `serializeProse`, `parseProse` from Task 2.
- Produces: message `{ type: 'requestDocProse'; docId: string }` (UI to main) and `{ type: 'docProse'; docId: string; prose: ProseDrafts | null }` (main to UI). The `renderDocFrame` message gains `prose?: ProseDrafts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/integration.test.ts`:

```ts
import { serializeProse, parseProse } from '../src/docLink';
import type { ProseDrafts } from '@spec-layer/extractor';

describe('prose survives the storage round trip the frame build performs', () => {
  it('recovers the drafts a build would have written', () => {
    const drafts: ProseDrafts = {
      definition: 'A button triggers an action.',
      accessibility: 'Give every button an accessible name.',
      dos: ['Use sentence case.'],
      donts: ['Do not nest buttons.'],
    };
    // Mirrors main.ts: serialize on build, parse when Copy asks for it.
    expect(parseProse(serializeProse(drafts))).toEqual(drafts);
  });

  it('treats a document written before prose storage as having none', () => {
    expect(parseProse('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/integration.test.ts`
Expected: FAIL until Task 2's exports exist. If Task 2 is already committed this passes immediately, which is fine, it is a regression guard for the wiring below.

- [ ] **Step 3: Add the messages**

In `packages/plugin/src/messages.ts`, add `prose` to the render message and add the two new messages. Change:

```ts
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; extractorVersion: string; config: DocConfig }
```

to:

```ts
  /** `prose` is the generated guidelines this build used, stored beside the doc
   *  link so a later Copy can include them without paying to regenerate. Absent
   *  when the build ran without AI. */
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; extractorVersion: string; config: DocConfig; prose?: ProseDrafts }
  | { type: 'requestDocProse'; docId: string }
```

Add to the main-to-UI union:

```ts
  | { type: 'docProse'; docId: string; prose: ProseDrafts | null }
```

Add `ProseDrafts` to the existing type import from `@spec-layer/extractor` in `messages.ts`.

- [ ] **Step 4: Write prose in main.ts**

In `packages/plugin/src/main.ts`, immediately after the existing `section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));` (around line 609), add:

```ts
        // Written in the same commit as the link, after the Section build
        // succeeded, so a failed build never leaves guidelines describing a
        // document that does not exist. An over-budget payload serializes to
        // '' and simply stores nothing.
        section.setPluginData(DOC_PROSE_KEY, msg.prose ? serializeProse(msg.prose) : '');
```

Add `DOC_PROSE_KEY` and `serializeProse` to the existing import from `./docLink` at the top of `main.ts`.

- [ ] **Step 5: Serve prose on request**

In `packages/plugin/src/main.ts`, in the `figma.ui.onmessage` switch, add a case alongside the other `request*` handlers:

```ts
      case 'requestDocProse': {
        const section = await sectionForDocId(msg.docId);
        figma.ui.postMessage({
          type: 'docProse',
          docId: msg.docId,
          prose: section ? parseProse(section.getPluginData(DOC_PROSE_KEY)) : null,
        });
        break;
      }
```

If no `sectionForDocId` helper exists, resolve the Section the same way the `requestDocSource` case already does and reuse that code path rather than writing a second lookup.

Add `parseProse` to the `./docLink` import.

- [ ] **Step 6: Pass prose from the UI**

In `packages/plugin/src/ui/actions.ts`, both `send({ type: 'renderDocFrame', ... })` calls gain the prose that build produced. In `createDocFrame` the local is `built.prose` if the build helper exposes it; otherwise thread the `prose` value already computed for `buildDocModel` into the send. Add to each call:

```ts
      ...(prose ? { prose } : {}),
```

using whichever local holds the `ProseDrafts | null` at that point. Do not call `generateProse` a second time.

- [ ] **Step 7: Run tests and the full gate**

```bash
npx vitest run
npm run check:ci > /tmp/ci.log 2>&1; echo $?
```
Expected: all tests pass, gate exits `0`.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin/src packages/plugin/test
git commit -m "feat(plugin): persist generated guidelines at frame creation"
```

---

# Phase 3 — The briefs

### Task 4: Deterministic YAML emitter

**Files:**
- Create: `packages/extractor/src/yaml.ts`
- Create: `packages/extractor/test/yaml.test.ts`
- Modify: `package.json` (root, devDependencies)
- Modify: `packages/extractor/src/index.ts`

**Interfaces:**
- Produces: `type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue | undefined }` and `toYaml(value: YamlValue): string`. Keys whose value is `undefined` are omitted entirely. Output always ends with exactly one newline.

- [ ] **Step 1: Add js-yaml as a dev dependency**

```bash
npm install --save-dev js-yaml @types/js-yaml
```

Confirm it landed in `devDependencies` and nowhere else:

```bash
node -e "const p=require('./package.json');console.log('dev:',!!p.devDependencies['js-yaml'],'prod:',!!(p.dependencies||{})['js-yaml'])"
```
Expected: `dev: true prod: false`

- [ ] **Step 2: Write the failing test**

Create `packages/extractor/test/yaml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { toYaml, type YamlValue } from '../src/yaml';

/** Parse our own output with a real YAML implementation. This is the whole
 *  point of the dev dependency: the emitter is hand-rolled, so something that
 *  actually knows YAML has to confirm it round-trips. */
function roundTrip(v: YamlValue): unknown {
  return load(toYaml(v));
}

describe('toYaml', () => {
  it('emits scalars and nested maps', () => {
    const v = { a: 1, b: 'two', c: true, d: null, e: { f: 'g' } };
    expect(roundTrip(v)).toEqual(v);
  });

  it('omits undefined keys entirely rather than emitting null', () => {
    const out = toYaml({ a: 'x', b: undefined });
    expect(out).not.toContain('b');
    expect(roundTrip({ a: 'x', b: undefined })).toEqual({ a: 'x' });
  });

  it('emits lists of maps', () => {
    const v = { items: [{ name: 'a', n: 1 }, { name: 'b', n: 2 }] };
    expect(roundTrip(v)).toEqual(v);
  });

  it('emits an empty list inline', () => {
    expect(toYaml({ items: [] })).toBe('items: []\n');
  });

  it('quotes strings YAML would otherwise reinterpret', () => {
    const v = {
      hex: '#2563EB',
      colon: 'Style: Filled',
      yes: 'yes',
      no: 'no',
      numeric: '123',
      leading: ' padded',
      trailing: 'padded ',
      empty: '',
      dash: '- not a list',
      brace: '{not a map}',
      at: '@handle',
      tick: '`backtick',
      quote: "it's quoted",
      tilde: '~',
    };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips multi-line prose', () => {
    const v = { definition: 'Line one.\nLine two.\n\nLine four.' };
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips multi-line text with trailing spaces on a line', () => {
    const v = { definition: 'Line one.   \nLine two.' };
    expect(roundTrip(v)).toEqual(v);
  });

  it('is deterministic', () => {
    const v = { b: 1, a: [{ z: 'x' }] };
    expect(toYaml(v)).toBe(toYaml(v));
  });

  it('ends with exactly one newline', () => {
    const out = toYaml({ a: 1 });
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/yaml.test.ts`
Expected: FAIL, cannot find module `../src/yaml`.

- [ ] **Step 4: Write the implementation**

Create `packages/extractor/src/yaml.ts`:

```ts
/**
 * yaml.ts — a deterministic YAML emitter for the brief shapes in brief.ts.
 *
 * Deliberately NOT a general YAML library. Both ends of this format are
 * controlled, the shapes are closed, and the output is snapshot-tested, so
 * shipping a general parser into a plugin bundle would buy nothing. The tests
 * parse this emitter's output with js-yaml (a dev dependency) to prove the
 * escaping is right, which is where a hand-rolled emitter actually fails.
 *
 * Emits YAML 1.2 block style only: no flow maps, no anchors, no tags.
 */

export type YamlValue =
  | string | number | boolean | null
  | YamlValue[]
  | { [k: string]: YamlValue | undefined };

/**
 * Characters that change a plain scalar's meaning in block context, plus the
 * shapes YAML would coerce to a non-string: numbers, booleans in all their
 * spellings, and null. `yes`/`no`/`on`/`off` are YAML 1.1 booleans that many
 * parsers still honour, so they are quoted defensively.
 */
const RESERVED_WORD = /^(y|n|yes|no|true|false|on|off|null|~)$/i;
const NUMERIC = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0[xob][0-9a-fA-F_]+)$/;
const LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

function needsQuote(s: string): boolean {
  if (s === '') return true;
  if (LEADING_INDICATOR.test(s)) return true;
  if (/^\s|\s$/.test(s)) return true;
  if (s.includes(': ') || s.endsWith(':')) return true;
  if (s.includes(' #')) return true;
  if (RESERVED_WORD.test(s)) return true;
  if (NUMERIC.test(s)) return true;
  return false;
}

/** Double-quoted style, which needs only these three escapes plus control chars. */
function doubleQuote(s: string): string {
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${body}"`;
}

function scalar(s: string, indent: number): string {
  if (s.includes('\n')) {
    const lines = s.split('\n');
    // A literal block scalar cannot preserve trailing whitespace on a line:
    // parsers strip it. Fall back to double-quoted so the value round-trips
    // byte for byte instead of looking prettier and losing data.
    if (lines.some((l) => /\s$/.test(l))) return doubleQuote(s);
    const pad = ' '.repeat(indent + 2);
    // `|-` strips the final newline, matching a string with no trailing \n.
    // A trailing newline in the source uses `|` instead.
    const chomp = s.endsWith('\n') ? '|' : '|-';
    const body = (s.endsWith('\n') ? s.slice(0, -1) : s)
      .split('\n')
      .map((l) => (l === '' ? '' : pad + l))
      .join('\n');
    return `${chomp}\n${body}`;
  }
  return needsQuote(s) ? doubleQuote(s) : s;
}

function isPlainObject(v: YamlValue): v is { [k: string]: YamlValue | undefined } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function emit(value: YamlValue, indent: number): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`yaml: cannot emit ${String(value)}`);
    return String(value);
  }
  if (typeof value === 'string') return scalar(value, indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = ' '.repeat(indent);
    return '\n' + value.map((item) => {
      const body = emit(item, indent + 2);
      // A nested map under "- " starts on the same line, so drop the leading
      // newline emit() produced for it and indent its first key inline.
      return `${pad}- ${body.startsWith('\n') ? body.slice(1).replace(new RegExp(`^${' '.repeat(indent + 2)}`), '') : body}`;
    }).join('\n');
  }

  const entries = Object.entries(value).filter((e): e is [string, YamlValue] => e[1] !== undefined);
  if (entries.length === 0) return '{}';
  const pad = ' '.repeat(indent);
  return '\n' + entries.map(([k, v]) => {
    const body = emit(v, indent + 2);
    return body.startsWith('\n') ? `${pad}${k}:${body}` : `${pad}${k}: ${body}`;
  }).join('\n');
}

export function toYaml(value: YamlValue): string {
  const out = emit(value, 0);
  return (out.startsWith('\n') ? out.slice(1) : out) + '\n';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/yaml.test.ts`
Expected: PASS, 9 tests.

If the list-of-maps case fails on indentation, fix `emit`'s array branch rather than relaxing the test. The round-trip assertion is the specification.

- [ ] **Step 6: Export from the package**

In `packages/extractor/src/index.ts`, add after `export * from './version';`:

```ts
export * from './yaml';
```

- [ ] **Step 7: Run the full gate and commit**

```bash
npm run check:ci > /tmp/ci.log 2>&1; echo $?
git add packages/extractor/src/yaml.ts packages/extractor/test/yaml.test.ts packages/extractor/src/index.ts package.json package-lock.json
git commit -m "feat(extractor): deterministic YAML emitter with js-yaml round-trip tests"
```

---

### Task 5: Foundation brief

**Files:**
- Create: `packages/extractor/src/brief.ts`
- Create: `packages/extractor/test/brief.test.ts`
- Modify: `packages/extractor/src/index.ts`

**Interfaces:**
- Consumes: `FoundationSpec`, `FoundationValue` from `./foundation`; `YamlValue` from `./yaml`; `EXTRACTOR_VERSION` from `./version`.
- Produces: `foundationBrief(foundation: FoundationSpec, generatedAt: string): YamlValue`.

- [ ] **Step 1: Write the failing test**

Create `packages/extractor/test/brief.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { foundationBrief } from '../src/brief';
import { toYaml } from '../src/yaml';
import type { FoundationSpec } from '../src/foundation';

const AT = '2026-08-14T10:22:00.000Z';

const FOUNDATION: FoundationSpec = {
  fileKey: 'abc123',
  extractedAt: AT,
  collections: [{
    id: 'C1',
    name: 'Color',
    modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
    defaultModeId: 'm1',
    variables: [
      {
        name: 'color/bg/brand', group: 'color', resolvedType: 'COLOR',
        description: 'Primary brand surface',
        codeSyntax: { WEB: '--color-bg-brand' },
        valuesByMode: {
          m1: { kind: 'color', hex: '#2563EB', alpha: 1 },
          m2: { kind: 'color', hex: '#3B82F6', alpha: 1 },
        },
      },
      {
        name: 'color/bg/muted', group: 'color', resolvedType: 'COLOR',
        description: '', codeSyntax: {},
        valuesByMode: {
          m1: { kind: 'alias', targetName: 'color/neutral/100', targetCollection: 'Color',
                external: false, resolved: { kind: 'color', hex: '#F5F5F5', alpha: 1 } },
          m2: { kind: 'unresolved', reason: 'external' },
        },
      },
    ],
  }],
  textStyles: [{
    name: 'Body/Regular', group: 'Body', description: '',
    fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
    lineHeight: { unit: 'PIXELS', value: 24 },
    letterSpacing: { unit: 'PERCENT', value: 0 },
    paragraphSpacing: 0, paragraphIndent: 0,
    textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {},
  }],
};

describe('foundationBrief', () => {
  it('stamps the envelope with the extractor version and brief version', () => {
    const b = foundationBrief(FOUNDATION, AT) as Record<string, Record<string, unknown>>;
    expect(b.spec_layer.kind).toBe('foundation');
    expect(b.spec_layer.version).toBe(1);
    expect(b.spec_layer.extractor).toBe('1');
  });

  it('keys mode values by mode name, not modeId', () => {
    const y = load(toYaml(foundationBrief(FOUNDATION, AT))) as any;
    expect(y.collections[0].tokens[0].values).toEqual({ Light: '#2563EB', Dark: '#3B82F6' });
  });

  it('emits code only when codeSyntax is populated', () => {
    const y = load(toYaml(foundationBrief(FOUNDATION, AT))) as any;
    expect(y.collections[0].tokens[0].code).toEqual({ WEB: '--color-bg-brand' });
    expect('code' in y.collections[0].tokens[1]).toBe(false);
  });

  it('gives an alias both its target and its resolved value', () => {
    const y = load(toYaml(foundationBrief(FOUNDATION, AT))) as any;
    expect(y.collections[0].tokens[1].values.Light)
      .toEqual({ alias: 'color/neutral/100', resolved: '#F5F5F5' });
  });

  it('states why an unresolved value is unresolved instead of dropping it', () => {
    const y = load(toYaml(foundationBrief(FOUNDATION, AT))) as any;
    expect(y.collections[0].tokens[1].values.Dark).toEqual({ unresolved: 'external' });
  });

  it('emits text styles', () => {
    const y = load(toYaml(foundationBrief(FOUNDATION, AT))) as any;
    expect(y.text_styles[0]).toEqual({
      name: 'Body/Regular',
      font: { family: 'Inter', style: 'Regular', size: 16 },
      line_height: { unit: 'PIXELS', value: 24 },
      letter_spacing: { unit: 'PERCENT', value: 0 },
    });
  });

  it('is deterministic', () => {
    expect(toYaml(foundationBrief(FOUNDATION, AT))).toBe(toYaml(foundationBrief(FOUNDATION, AT)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: FAIL, cannot find module `../src/brief`.

- [ ] **Step 3: Write the implementation**

Create `packages/extractor/src/brief.ts`:

```ts
/**
 * brief.ts — the public YAML brief projections.
 *
 * These are the product's only export contract now that Markdown is retired,
 * so they are deliberately a PROJECTION of the internal types rather than a
 * dump of them: internal ids, minimized token conditions, and rendering
 * concerns stay inside, and the shapes here can stay stable while the
 * extractor's internals change.
 */

import type { FoundationSpec, FoundationValue, FoundationVariable } from './foundation';
import { EXTRACTOR_VERSION } from './version';
import type { YamlValue } from './yaml';

/** Brief schema version. Bumped when the brief's shape or field meanings
 *  change, independently of EXTRACTOR_VERSION. */
export const BRIEF_VERSION = 1;

function envelope(kind: 'component' | 'foundation', generatedAt: string): YamlValue {
  return { kind, version: BRIEF_VERSION, extractor: EXTRACTOR_VERSION, generated: generatedAt };
}

/** A resolved value flattened to what a consumer can act on. */
function valueOf(v: FoundationValue): YamlValue {
  switch (v.kind) {
    case 'color': return v.alpha === 1 ? v.hex : { hex: v.hex, alpha: v.alpha };
    case 'number': return v.value;
    case 'string': return v.value;
    case 'boolean': return v.value;
    case 'alias':
      return {
        alias: v.targetName,
        resolved: v.resolved ? valueOf(v.resolved) : undefined,
        external: v.external ? true : undefined,
      };
    case 'unresolved': return { unresolved: v.reason };
  }
}

function tokenOf(variable: FoundationVariable, modeName: (id: string) => string): YamlValue {
  const values: Record<string, YamlValue> = {};
  for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
    values[modeName(modeId)] = valueOf(value);
  }
  const code = Object.keys(variable.codeSyntax).length > 0 ? variable.codeSyntax : undefined;
  return {
    name: variable.name,
    type: variable.resolvedType.toLowerCase(),
    description: variable.description || undefined,
    code: code as YamlValue,
    values,
  };
}

export function foundationBrief(foundation: FoundationSpec, generatedAt: string): YamlValue {
  return {
    spec_layer: envelope('foundation', generatedAt),
    source: { file: foundation.fileKey },
    collections: foundation.collections.map((c) => {
      const byId = new Map(c.modes.map((m) => [m.modeId, m.name]));
      const modeName = (id: string) => byId.get(id) ?? id;
      return {
        name: c.name,
        modes: c.modes.map((m) => m.name),
        default_mode: modeName(c.defaultModeId),
        tokens: c.variables.map((v) => tokenOf(v, modeName)),
      };
    }),
    text_styles: foundation.textStyles.map((t) => ({
      name: t.name,
      font: { family: t.fontFamily, style: t.fontStyle, size: t.fontSize },
      line_height: { unit: t.lineHeight.unit, value: t.lineHeight.value },
      letter_spacing: { unit: t.letterSpacing.unit, value: t.letterSpacing.value },
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export and commit**

Add `export * from './brief';` to `packages/extractor/src/index.ts`.

```bash
npm run check:ci > /tmp/ci.log 2>&1; echo $?
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts packages/extractor/src/index.ts
git commit -m "feat(extractor): foundation brief projection"
```

---

### Task 6: Component brief, everything except tokens

**Files:**
- Modify: `packages/extractor/src/brief.ts`
- Modify: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `IntermediateSpec` from `./extract`; `AnatomyPart` from `./anatomy`; `ProseDrafts` from `./prose/prompt`.
- Produces: `componentBrief(spec: IntermediateSpec, opts: { generatedAt: string; foundation?: FoundationSpec; prose?: ProseDrafts | null }): YamlValue`.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/brief.test.ts`:

```ts
import { componentBrief } from '../src/brief';
import type { IntermediateSpec } from '../src/extract';

const SPEC: IntermediateSpec = {
  name: 'Button', figmaKey: 'm3-button', figmaFile: 'abc123', figmaNode: '1:100',
  anatomyComponentId: '1:101',
  anatomy: [
    { id: 'p0', name: 'container', type: 'FRAME', nested: false, depth: 0 },
    { id: 'p1', name: 'icon', type: 'INSTANCE', nested: true, depth: 1, component: 'Icon' },
    { id: 'p2', name: 'label', type: 'TEXT', nested: false, depth: 1 },
  ],
  props: [
    { name: 'label', kind: 'text', default: 'Button' },
    { name: 'Style', kind: 'variant', options: ['Filled', 'Outlined'], default: 'Filled' },
    { name: 'disabled', kind: 'boolean', default: false },
  ],
  variants: [
    { prop: 'Style', values: ['Filled', 'Outlined'] },
    { prop: 'State', values: ['Enabled', 'Hovered'] },
  ],
  variantInstances: [
    { nodeId: '1:101', name: 'Style=Filled, State=Enabled', values: { Style: 'Filled', State: 'Enabled' } },
    { nodeId: '1:102', name: 'Style=Filled, State=Hovered', values: { Style: 'Filled', State: 'Hovered' } },
  ],
  states: ['Enabled', 'Hovered'],
  tokens: [],
  related: ['Icon'],
  gaps: [{ part: 'container', issue: 'hardcoded itemSpacing (8px)' }],
  layout: [{ part: 'container', summary: 'horizontal, gap 8' }],
  rawValues: [],
  contrast: { evaluated: 4, skipped: 1, findings: [] },
};

const brief = (over: Partial<Parameters<typeof componentBrief>[1]> = {}) =>
  load(toYaml(componentBrief(SPEC, { generatedAt: AT, ...over }))) as any;

describe('componentBrief', () => {
  it('stamps a component envelope and the source identity', () => {
    const y = brief();
    expect(y.spec_layer.kind).toBe('component');
    expect(y.source).toEqual({ file: 'abc123', node: '1:100', component_key: 'm3-button' });
  });

  it('emits props with their PropKind verbatim', () => {
    expect(brief().api).toEqual([
      { name: 'label', kind: 'text', default: 'Button' },
      { name: 'Style', kind: 'variant', options: ['Filled', 'Outlined'], default: 'Filled' },
      { name: 'disabled', kind: 'boolean', default: false },
    ]);
  });

  it('nests anatomy by depth rather than emitting a flat list', () => {
    expect(brief().anatomy).toEqual([{
      part: 'container', type: 'FRAME',
      children: [
        { part: 'icon', type: 'INSTANCE', component: 'Icon' },
        { part: 'label', type: 'TEXT' },
      ],
    }]);
  });

  it('emits axes, states, layout and related', () => {
    const y = brief();
    expect(y.axes).toEqual([
      { prop: 'Style', values: ['Filled', 'Outlined'] },
      { prop: 'State', values: ['Enabled', 'Hovered'] },
    ]);
    expect(y.states).toEqual(['Enabled', 'Hovered']);
    expect(y.layout).toEqual([{ part: 'container', summary: 'horizontal, gap 8' }]);
    expect(y.component).toEqual({ name: 'Button', related: ['Icon'] });
  });

  it('emits gaps as unbound', () => {
    expect(brief().unbound).toEqual([{ part: 'container', issue: 'hardcoded itemSpacing (8px)' }]);
  });

  it('reports measured and skipped counts so an empty findings list is readable', () => {
    expect(brief().contrast).toEqual({ measured: 4, skipped: 1, findings: [] });
  });

  it('includes stored guidelines verbatim', () => {
    const y = brief({ prose: { definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'] } });
    expect(y.guidelines).toEqual({
      definition: 'A button.', accessibility: 'Name it.', dos: ['Do'], donts: ['Do not'],
    });
  });

  it('omits guidelines entirely when none were stored', () => {
    expect('guidelines' in brief()).toBe(false);
    expect('guidelines' in brief({ prose: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: FAIL, no exported member `componentBrief`.

- [ ] **Step 3: Write the implementation**

Add to `packages/extractor/src/brief.ts`:

```ts
import type { IntermediateSpec } from './extract';
import type { AnatomyPart } from './anatomy';
import type { ProseDrafts } from './prose/prompt';

export interface ComponentBriefOptions {
  generatedAt: string;
  /** Resolves token names to concrete values. Absent on the drift path, which
   *  calls extract() without one; bindings then omit `value` rather than
   *  implying the token has none. */
  foundation?: FoundationSpec;
  /** Guidelines read from storage. Never generated here. */
  prose?: ProseDrafts | null;
}

/** Rebuild the depth-encoded anatomy list as a tree, which reads far better
 *  than a flat list with a depth number for a consumer that has to understand
 *  containment. */
function nestAnatomy(parts: AnatomyPart[]): YamlValue[] {
  const roots: YamlValue[] = [];
  const stack: { depth: number; children: YamlValue[] }[] = [{ depth: -1, children: roots }];
  for (const p of parts) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= p.depth) stack.pop();
    const children: YamlValue[] = [];
    const node: Record<string, YamlValue | undefined> = {
      part: p.name,
      type: p.type,
      component: p.component,
ようで
    };
    stack[stack.length - 1].children.push(node as YamlValue);
    stack.push({ depth: p.depth, children });
    // `children` is attached lazily below so an empty array is never emitted.
    Object.defineProperty(node, '__children', { value: children, enumerable: false });
  }
  attachChildren(roots);
  return roots;
}

function attachChildren(nodes: YamlValue[]): void {
  for (const n of nodes) {
    const node = n as Record<string, YamlValue | undefined> & { __children?: YamlValue[] };
    const kids = (Object.getOwnPropertyDescriptor(node, '__children')?.value ?? []) as YamlValue[];
    if (kids.length > 0) {
      attachChildren(kids);
      node.children = kids;
    }
  }
}

function guidelinesOf(prose: ProseDrafts | null | undefined): YamlValue | undefined {
  if (!prose) return undefined;
  return {
    definition: prose.definition || undefined,
    accessibility: prose.accessibility || undefined,
    interactions: prose.interactions,
    variants_summary: prose.variantsSummary,
    anatomy_summary: prose.anatomySummary,
    design_considerations: prose.designConsiderations,
    content_considerations: prose.contentConsiderations,
    dos: prose.dos.length > 0 ? prose.dos : undefined,
    donts: prose.donts.length > 0 ? prose.donts : undefined,
  };
}

export function componentBrief(spec: IntermediateSpec, opts: ComponentBriefOptions): YamlValue {
  return {
    spec_layer: envelope('component', opts.generatedAt),
    source: { file: spec.figmaFile, node: spec.figmaNode, component_key: spec.figmaKey || undefined },
    component: { name: spec.name, related: spec.related.length > 0 ? spec.related : undefined },
    api: spec.props.map((p) => ({
      name: p.name,
      kind: p.kind,
      options: p.options,
      default: p.default as YamlValue,
    })),
    axes: spec.variants.length > 0
      ? spec.variants.map((v) => ({ prop: v.prop, values: v.values }))
      : undefined,
    states: spec.states.length > 0 ? spec.states : undefined,
    anatomy: nestAnatomy(spec.anatomy),
    layout: spec.layout.length > 0 ? spec.layout.map((l) => ({ part: l.part, summary: l.summary })) : undefined,
    unbound: spec.gaps.length > 0 ? spec.gaps.map((g) => ({ part: g.part, issue: g.issue })) : undefined,
    contrast: {
      measured: spec.contrast.evaluated,
      skipped: spec.contrast.skipped,
      findings: spec.contrast.findings.map((f) => ({
        part: f.part, variant: f.variant,
        foreground: f.foreground, background: f.background, background_part: f.backgroundPart,
        ratio: f.ratio, required: f.required,
      })),
    },
    guidelines: guidelinesOf(opts.prose),
  };
}
```

Note: the `nestAnatomy` sketch above uses a non-enumerable `__children` property to avoid emitting empty `children` arrays. If that reads as too clever, replace it with a straightforward two-pass build that groups by depth. The tests define the required output; the implementation is free.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate and commit**

```bash
npm run check:ci > /tmp/ci.log 2>&1; echo $?
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts
git commit -m "feat(extractor): component brief for api, anatomy, states and guidelines"
```

---

### Task 7: Token bindings, factored into base and by_variant

The schema decision with the most behaviour behind it. `TokenRule` stores minimized conditions, which would make the consumer evaluate a boolean expression to answer "what is the background of Filled/Hovered?". `resolveTokensForVariant` already performs that evaluation, so the brief emits resolved bindings per variant. Emitting all of them is wasteful, so bindings identical across every variant are factored into `base`.

**Files:**
- Modify: `packages/extractor/src/brief.ts`
- Modify: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `resolveTokensForVariant` from `./resolve`.
- Produces: the `tokens` key on `componentBrief` output, shaped `{ base: Binding[]; by_variant: { when: Record<string,string>; bindings: Binding[] }[] }` where a `Binding` is `{ part, property, token, value?, code? }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/brief.test.ts`:

```ts
const TOKEN_SPEC: IntermediateSpec = {
  ...SPEC,
  tokens: [
    // Unconditioned: applies to every variant, so it belongs in base.
    { part: 'container', property: 'border-radius', conditions: {}, token: 'radius/md' },
    // Conditioned per state: belongs in by_variant.
    { part: 'container', property: 'fill', conditions: { State: ['Enabled'] }, token: 'color/bg/brand' },
    { part: 'container', property: 'fill', conditions: { State: ['Hovered'] }, token: 'color/bg/brand-hover' },
  ],
};

const tokenBrief = (over: Partial<ComponentBriefOptions> = {}) =>
  load(toYaml(componentBrief(TOKEN_SPEC, { generatedAt: AT, ...over }))) as any;

describe('componentBrief tokens', () => {
  it('factors bindings common to every variant into base', () => {
    expect(tokenBrief().tokens.base).toEqual([
      { part: 'container', property: 'border-radius', token: 'radius/md' },
    ]);
  });

  it('emits only the differing bindings per variant', () => {
    expect(tokenBrief().tokens.by_variant).toEqual([
      { when: { Style: 'Filled', State: 'Enabled' },
        bindings: [{ part: 'container', property: 'fill', token: 'color/bg/brand' }] },
      { when: { Style: 'Filled', State: 'Hovered' },
        bindings: [{ part: 'container', property: 'fill', token: 'color/bg/brand-hover' }] },
    ]);
  });

  it('never repeats a base binding inside by_variant', () => {
    const y = tokenBrief();
    for (const v of y.tokens.by_variant) {
      expect(v.bindings.some((b: any) => b.property === 'border-radius')).toBe(false);
    }
  });

  it('every `when` names a declared axis and a declared value', () => {
    const y = tokenBrief();
    const declared = new Map(y.axes.map((a: any) => [a.prop, a.values]));
    for (const v of y.tokens.by_variant) {
      for (const [axis, value] of Object.entries(v.when)) {
        expect(declared.has(axis)).toBe(true);
        expect(declared.get(axis)).toContain(value);
      }
    }
  });

  it('resolves token values through the foundation when one is supplied', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    const enabled = y.tokens.by_variant.find((v: any) => v.when.State === 'Enabled');
    // color/bg/brand resolves at the collection's default mode (Light).
    expect(enabled.bindings[0].value).toBe('#2563EB');
  });

  it('omits value entirely when no foundation is supplied', () => {
    const y = tokenBrief();
    expect('value' in y.tokens.by_variant[0].bindings[0]).toBe(false);
  });

  it('emits code when the resolved variable has codeSyntax', () => {
    const y = tokenBrief({ foundation: FOUNDATION });
    const enabled = y.tokens.by_variant.find((v: any) => v.when.State === 'Enabled');
    expect(enabled.bindings[0].code).toEqual({ WEB: '--color-bg-brand' });
  });

  it('emits an empty by_variant rather than omitting tokens when there are no variants', () => {
    const single: IntermediateSpec = { ...TOKEN_SPEC, variantInstances: [], variants: [] };
    const y = load(toYaml(componentBrief(single, { generatedAt: AT }))) as any;
    expect(y.tokens.by_variant).toEqual([]);
    expect(y.tokens.base.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'componentBrief tokens'`
Expected: FAIL, `tokens` is undefined on the brief.

- [ ] **Step 3: Write the implementation**

Add to `packages/extractor/src/brief.ts`:

```ts
import { resolveTokensForVariant, type ResolvedToken } from './resolve';

/** Stable identity for a resolved binding, used to intersect across variants. */
function bindingKey(t: ResolvedToken): string {
  // A separator that cannot occur inside a Figma layer, property, or
  // variable name, so two different bindings can never collide into one key.
  return `${t.part}\u0000${t.property}\u0000${t.token}`;
}

/** Look a token name up in the foundation, at its owning collection's default
 *  mode. Mirrors the lookup contrast.ts already performs. */
function lookup(
  foundation: FoundationSpec | undefined,
  token: string,
): { value?: YamlValue; code?: YamlValue } {
  if (!foundation) return {};
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      if (variable.name !== token) continue;
      const raw = variable.valuesByMode[collection.defaultModeId];
      return {
        value: raw ? valueOf(raw) : undefined,
        code: Object.keys(variable.codeSyntax).length > 0 ? (variable.codeSyntax as YamlValue) : undefined,
      };
    }
  }
  return {};
}

function binding(t: ResolvedToken, foundation: FoundationSpec | undefined): YamlValue {
  const { value, code } = lookup(foundation, t.token);
  return { part: t.part, property: t.property, token: t.token, value, code };
}

function tokensOf(spec: IntermediateSpec, foundation: FoundationSpec | undefined): YamlValue {
  const perVariant = spec.variantInstances.map((v) => ({
    when: v.values,
    resolved: resolveTokensForVariant(spec.tokens, v.values),
  }));

  // With no variant instances there is nothing to intersect: every rule is
  // unconditional by definition, so it all lands in base.
  if (perVariant.length === 0) {
    return {
      base: spec.tokens.map((t) => binding({ part: t.part, property: t.property, token: t.token }, foundation)),
      by_variant: [],
    };
  }

  // A binding is `base` when it is present, identically, on EVERY variant.
  // Intersecting rather than testing `conditions === {}` also catches a rule
  // whose conditions happen to cover every declared value, which is common
  // after the minimizer runs.
  let common = new Set(perVariant[0].resolved.map(bindingKey));
  for (const v of perVariant.slice(1)) {
    const here = new Set(v.resolved.map(bindingKey));
    common = new Set([...common].filter((k) => here.has(k)));
  }

  const baseTokens = perVariant[0].resolved.filter((t) => common.has(bindingKey(t)));

  return {
    base: baseTokens.map((t) => binding(t, foundation)),
    by_variant: perVariant.map((v) => ({
      when: v.when,
      bindings: v.resolved
        .filter((t) => !common.has(bindingKey(t)))
        .map((t) => binding(t, foundation)),
    })),
  };
}
```

Then add the key to `componentBrief`'s returned object, between `layout` and `unbound`:

```ts
    tokens: tokensOf(spec, opts.foundation),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: PASS, all `componentBrief tokens` tests plus the earlier ones.

- [ ] **Step 5: Add a size regression guard**

Append to `packages/extractor/test/brief.test.ts`:

```ts
it('keeps a wide variant set small by factoring, not by truncating', () => {
  const axes = [
    { prop: 'Style', values: ['A', 'B', 'C', 'D'] },
    { prop: 'Size', values: ['S', 'M', 'L'] },
    { prop: 'State', values: ['Default', 'Hover', 'Disabled', 'Focus', 'Pressed'] },
  ];
  const instances = [];
  for (const s of axes[0].values) for (const z of axes[1].values) for (const t of axes[2].values) {
    instances.push({ nodeId: `${s}${z}${t}`, name: `${s}/${z}/${t}`, values: { Style: s, Size: z, State: t } });
  }
  const wide: IntermediateSpec = {
    ...SPEC, variants: axes, variantInstances: instances,
    tokens: [
      { part: 'container', property: 'border-radius', conditions: {}, token: 'radius/md' },
      { part: 'label', property: 'typography', conditions: {}, token: 'type/label' },
      { part: 'container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/bg/hover' },
    ],
  };
  const y = load(toYaml(componentBrief(wide, { generatedAt: AT }))) as any;
  expect(instances.length).toBe(60);
  // Every variant is still present: factoring must not drop any.
  expect(y.tokens.by_variant.length).toBe(60);
  expect(y.tokens.base.length).toBe(2);
  // The 12 Hover variants carry a binding; the other 48 carry none.
  expect(y.tokens.by_variant.filter((v: any) => v.bindings.length > 0).length).toBe(12);
});
```

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full gate and commit**

```bash
npm run check:ci > /tmp/ci.log 2>&1; echo $?
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts
git commit -m "feat(extractor): resolve token bindings per variant, factored into base"
```

---

# Phase 4 — Surfaces

### Task 8: Copy on a Library row

**Record the Task 1 Step 7 spike result here before starting:**

- Tier for an immediate call: `________`
- Tier after a 300 ms await: `________`

If the delayed tier is `manual`, precompute the brief when the row menu opens and make the click synchronous. The steps below assume the async tier works; adjust if it does not.

**Files:**
- Modify: `packages/plugin/src/ui/shell/icons.ts`
- Modify: `packages/plugin/src/ui/viewModel/contracts.ts`
- Modify: `packages/plugin/src/ui/viewModel/library.ts`
- Modify: `packages/plugin/src/ui/screens/library.ts`
- Modify: `packages/plugin/src/ui/actions.ts`
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Modify: `packages/plugin/test/libraryScreen.test.ts`
- Create: `packages/plugin/test/copyBrief.test.ts`

**Interfaces:**
- Consumes: `copyText` from `./clipboard`; `componentBrief`, `toYaml` from `@spec-layer/extractor`; `DocSource` from `./actions`.
- Produces: `copyBriefFromSource(state: UiState, src: DocSource, prose: ProseDrafts | null, ui: BuildPresenter): Promise<void>`.

- [ ] **Step 1: Add the copy glyph**

In `packages/plugin/src/ui/shell/icons.ts`, add to `ICON_PATHS` in the same 24-viewBox stroked style as its neighbours:

```ts
  /** Copy a brief to the clipboard. */
  copy:
    '<rect x="8" y="8" width="12" height="12" rx="2"/>' +
    '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
```

- [ ] **Step 2: Write the failing test**

Create `packages/plugin/test/copyBrief.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';

const copyText = vi.fn();
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: () => () => {},
}));

const { copyBriefFromSource, createState } = await import('../src/ui/actions');

function presenter() {
  return {
    clear: vi.fn(), error: vi.fn(), info: vi.fn(),
    setBusy: vi.fn(), startProgress: vi.fn(), stopProgress: vi.fn(),
  };
}

const NODE = {
  id: '1:100', name: 'Button', type: 'COMPONENT', visible: true, key: 'k',
  children: [], bindings: [],
} as never;

const SRC = {
  docId: 'doc-1', node: NODE, fileKey: 'F1',
  config: { sections: [], variantIds: [], aiEnabled: false, anatomyView: 'diagram', measureViews: [] },
} as never;

beforeEach(() => {
  copyText.mockReset().mockResolvedValue('async');
  vi.stubGlobal('parent', { postMessage: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('copyBriefFromSource', () => {
  it('copies parseable YAML naming the component', async () => {
    const ui = presenter();
    await copyBriefFromSource(createState(), SRC, null, ui);
    expect(copyText).toHaveBeenCalledTimes(1);
    const y = load(copyText.mock.calls[0][0]) as any;
    expect(y.spec_layer.kind).toBe('component');
    expect(y.component.name).toBe('Button');
    expect(ui.error).not.toHaveBeenCalled();
  });

  it('includes stored guidelines without generating any', async () => {
    await copyBriefFromSource(createState(), SRC,
      { definition: 'A button.', accessibility: 'Name it.', dos: [], donts: [] }, presenter());
    const y = load(copyText.mock.calls[0][0]) as any;
    expect(y.guidelines.definition).toBe('A button.');
  });

  it('omits guidelines when the document has none stored', async () => {
    await copyBriefFromSource(createState(), SRC, null, presenter());
    expect('guidelines' in (load(copyText.mock.calls[0][0]) as any)).toBe(false);
  });

  it('reports a failure without copying when extraction throws', async () => {
    const ui = presenter();
    const broken = { ...SRC, node: null } as never;
    await copyBriefFromSource(createState(), broken, null, ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalled();
  });

  it('never posts a canvas-mutating message', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('parent', { postMessage: (m: { pluginMessage: unknown }) => sent.push(m.pluginMessage) });
    await copyBriefFromSource(createState(), SRC, null, presenter());
    const types = sent.map((m) => (m as { type: string }).type);
    expect(types).not.toContain('renderDocFrame');
    expect(types).not.toContain('updateFoundationDoc');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/copyBrief.test.ts`
Expected: FAIL, no exported member `copyBriefFromSource`.

- [ ] **Step 4: Write the action**

Add to `packages/plugin/src/ui/actions.ts`:

```ts
// ---------------------------------------------------------------------------
// Copy for AI (My Library) — put a YAML brief on the clipboard.
//
// Deliberately unlike the doc-building actions: it re-extracts the source the
// way Update does, but it never generates prose, never touches quota, and
// never mutates the canvas or any stored metadata. Guidelines come from the
// caller, which read them from DOC_PROSE_KEY.
// ---------------------------------------------------------------------------
export async function copyBriefFromSource(
  state: UiState,
  src: DocSource,
  prose: ProseDrafts | null,
  ui: BuildPresenter,
): Promise<void> {
  ui.clear();
  try {
    const spec = extract(src.node, {
      figmaFile: src.fileKey,
      ...(foundationSpec ? { foundation: foundationSpec } : {}),
    });
    const yaml = toYaml(componentBrief(spec, {
      generatedAt: new Date().toISOString(),
      ...(foundationSpec ? { foundation: foundationSpec } : {}),
      prose,
    }));
    const tier = await copyText(yaml);
    if (tier === 'manual') {
      renderManualCopyModal(yaml);
      return;
    }
    const lines = yaml.split('\n').length;
    const size = lines > 800 ? ` ${lines} lines, which is large for some chat windows.` : '';
    const missing = foundationSpec ? '' : ' Token values are missing because foundations have not been read yet.';
    const noProse = prose ? '' : ' This document was made before guidelines were saved, so it has none.';
    ui.info(`Copied.${size}${missing}${noProse}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Could not read that component. Nothing was copied. ${msg}`);
  }
}
```

Add the imports at the top of `actions.ts`:

```ts
import { componentBrief, toYaml } from '@spec-layer/extractor';
import { copyText, renderManualCopyModal } from './clipboard';
```

and add `ProseDrafts` to the existing type import from `@spec-layer/extractor`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/copyBrief.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the row action**

In `packages/plugin/src/ui/viewModel/contracts.ts`, add to `LibraryRowView`:

```ts
  canCopy: boolean;
```

In `packages/plugin/src/ui/viewModel/library.ts`, alongside the other capability flags:

```ts
    canCopy: componentSourceAvailable,
```

In `packages/plugin/src/ui/screens/library.ts`, add `'copy'` to `MenuItem['action']` and `'copy'` to `MenuItem['glyph']`, then add the menu item after the `open-source` block:

```ts
  if (row.canCopy) {
    navigation.push({
      action: 'copy',
      label: 'Copy for AI',
      glyph: 'copy',
    });
  }
```

- [ ] **Step 7: Wire the action in ui-vnext**

In `packages/plugin/src/ui/ui-vnext.ts`, add a `copy` case to the row-action switch:

```ts
      case 'copy':
        startLibraryCopy(docId);
        return;
```

and the operation, mirroring how `startLibraryDownload` used to work but with prose fetched first:

```ts
function startLibraryCopy(docId: string): void {
  const entry = libraryEntry(docId);
  if (!entry || entry.kind !== 'component' || !entry.sourceExists || operation.active) return;
  if (!beginOperation(operation)) return;
  libraryOperation = { kind: 'copy', currentDocId: docId };
  paint();
  // Prose first: the brief needs it, and it is a cheap pluginData read.
  send({ type: 'requestDocProse', docId });
}
```

Add `LibraryCopyOperation = { kind: 'copy'; currentDocId: string; prose?: ProseDrafts | null }` to the `libraryOperation` union, handle `docProse` by storing the prose and then sending `requestDocSource`, and handle `docSource` for `active.kind === 'copy'` by calling `copyBriefFromSource` and clearing the operation.

- [ ] **Step 8: Update the library screen test**

In `packages/plugin/test/libraryScreen.test.ts`, add `canCopy: false` to the base row fixture, and add:

```ts
  it('offers Copy for AI on a component row whose source still exists', () => {
    const html = libraryRowMarkup(row({ canCopy: true, menuOpen: true }));
    expect(html).toContain('data-library-action="copy"');
    expect(html).toContain('Copy for AI');
  });

  it('hides Copy for AI when the source is gone', () => {
    expect(libraryRowMarkup(row({ canCopy: false, menuOpen: true })))
      .not.toContain('data-library-action="copy"');
  });
```

Match the existing helper names in that file rather than inventing new ones.

- [ ] **Step 9: Run everything and commit**

```bash
npx vitest run
npm run check:ci > /tmp/ci.log 2>&1; echo $?
git add packages/plugin/src packages/plugin/test
git commit -m "feat(plugin): Copy for AI on a Library row"
```

---

### Task 9: Copy the foundation brief

**Files:**
- Modify: `packages/plugin/src/ui/screens/foundations.ts`
- Modify: `packages/plugin/src/ui/actions.ts`
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Create: `packages/plugin/test/copyFoundation.test.ts`

**Interfaces:**
- Consumes: `foundationBrief`, `toYaml` from `@spec-layer/extractor`; `currentFoundationSpec()` from `./actions`; `copyText` from `./clipboard`.
- Produces: `copyFoundationBrief(ui: BuildPresenter): Promise<void>`.

**Scope note:** the spec's open question was whether this respects the current scope selection or emits the whole file. **Decision: emit the whole file.** The brief exists to establish a complete token vocabulary for an agent, and a partial vocabulary produces exactly the invented token names the `unbound` list is meant to prevent. Scope selection stays what it is for generating foundation *documents*.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/copyFoundation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';

const copyText = vi.fn();
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: () => () => {},
}));

const { copyFoundationBrief, onFoundationMessage } = await import('../src/ui/actions');

function presenter() {
  return {
    clear: vi.fn(), error: vi.fn(), info: vi.fn(),
    setBusy: vi.fn(), startProgress: vi.fn(), stopProgress: vi.fn(),
  };
}

beforeEach(() => {
  copyText.mockReset().mockResolvedValue('async');
  vi.stubGlobal('parent', { postMessage: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('copyFoundationBrief', () => {
  it('refuses to copy when no foundation has been read', async () => {
    const ui = presenter();
    await copyFoundationBrief(ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalled();
  });

  it('copies parseable YAML with a foundation envelope', async () => {
    onFoundationMessage({
      fileKey: 'F1', extractedAt: '2026-08-14T00:00:00.000Z', externals: [], textStyles: [],
      collections: [{
        id: 'C1', name: 'Color', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Light' }],
        variables: [{
          id: 'V1', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
          codeSyntax: {}, valuesByMode: { m1: { r: 0.14, g: 0.39, b: 0.92, a: 1 } },
        }],
      }],
    } as never);
    await copyFoundationBrief(presenter());
    const y = load(copyText.mock.calls[0][0]) as any;
    expect(y.spec_layer.kind).toBe('foundation');
    expect(y.collections[0].tokens[0].name).toBe('color/bg/brand');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/copyFoundation.test.ts`
Expected: FAIL, no exported member `copyFoundationBrief`.

- [ ] **Step 3: Write the action**

Add to `packages/plugin/src/ui/actions.ts`, in the Foundations section:

```ts
/**
 * Copy the whole file's foundation as a YAML brief.
 *
 * Deliberately ignores the scope selection that foundation DOCUMENT generation
 * respects: the brief exists to give an agent a complete token vocabulary, and
 * a partial one produces exactly the invented token names the brief is meant
 * to prevent.
 */
export async function copyFoundationBrief(ui: BuildPresenter): Promise<void> {
  ui.clear();
  const spec = currentFoundationSpec();
  if (!spec) {
    ui.error('Read the foundations first, then copy.');
    return;
  }
  try {
    const yaml = toYaml(foundationBrief(spec, new Date().toISOString()));
    const tier = await copyText(yaml);
    if (tier === 'manual') {
      renderManualCopyModal(yaml);
      return;
    }
    const lines = yaml.split('\n').length;
    ui.info(lines > 800 ? `Copied. ${lines} lines, which is large for some chat windows.` : 'Copied.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Could not read the foundations. Nothing was copied. ${msg}`);
  }
}
```

Add `foundationBrief` to the `@spec-layer/extractor` import.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/copyFoundation.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the footer button**

In `packages/plugin/src/ui/screens/foundations.ts`, inside `foundationFooterMarkup`, add a secondary button beside the existing primary, shown when `spec` is non-null:

```ts
  const copy = spec
    ? '<button class="sl-button" data-tone="secondary" id="sl-copy-foundation" type="button">' +
      `${icon('copy', 15)}<span>Copy for AI</span></button>`
    : '';
```

and include `copy +` in the returned `sl-footer-actions` markup, before the primary button.

- [ ] **Step 6: Wire the click**

In `packages/plugin/src/ui/ui-vnext.ts`, in the click handler beside the other `#sl-` targets:

```ts
  if (target.closest('#sl-copy-foundation')) {
    void copyFoundationBrief(presenter('create'));
    return;
  }
```

Import `copyFoundationBrief` from `./actions`.

- [ ] **Step 7: Run everything and commit**

```bash
npx vitest run
npm run check:ci > /tmp/ci.log 2>&1; echo $?
git add packages/plugin/src packages/plugin/test
git commit -m "feat(plugin): Copy the foundation brief for AI"
```

---

### Task 10: Manual acceptance in Figma

Not automatable, and the feature is not done without it.

- [ ] **Step 1: Build**

```bash
npm run build:plugin:vnext
```

- [ ] **Step 2: Run the matrix**

Load the plugin in Figma and confirm each case. Record the clipboard tier each time.

| Case | Expected |
|---|---|
| Copy a component with foundations read | YAML on clipboard, bindings carry `value` |
| Copy the same component with foundations NOT read | YAML copied, no `value` keys, toast says token values are missing |
| Copy a doc created before this change | YAML copied, no `guidelines`, toast says so |
| Copy a doc created after, with AI on | `guidelines` present and matching the frame |
| Copy a doc whose source component was deleted | No Copy action offered on the row |
| Copy the foundation | YAML with every collection, not only the selected scope |
| Copy a component with 60+ variants | Every variant present in `by_variant`, `base` non-empty, toast reports the line count |

- [ ] **Step 3: Paste-test the output**

Paste a foundation brief followed by a component brief into a fresh Claude Code or Cursor session and ask it to implement the component. Confirm it references real token names rather than inventing them, and that it does not invent tokens for anything listed under `unbound`. This is the feature's actual acceptance criterion.

- [ ] **Step 4: Record the result**

Add a short note to this plan under Task 8 with the observed clipboard tiers, so the next person does not have to re-run the spike.

---

## Self-review notes

**Spec coverage.** Every section of the spec maps to a task: two-payload model (Tasks 5, 7, 9), envelope and versions (Task 5), foundation brief (Task 5), component brief (Tasks 6, 7), `base`/`by_variant` (Task 7), resolved values (Task 7), `unbound` and `contrast` (Task 6), prose persistence (Tasks 2, 3), YAML emitter and dev-only js-yaml (Task 4), Library surface (Task 8), foundations surface (Task 9), clipboard tiers (Task 1), failure copy (Tasks 8, 9), size reporting without truncation (Tasks 7 step 5, 8, 9), testing strategy (throughout), manual acceptance (Task 10).

**Spec open question resolved.** Foundation Copy emits the whole file rather than the selected scope. Rationale is in Task 9.

**Known gap.** The spec's failure table lists `That component is not in this file anymore.` for a missing source node. That case is handled by not offering the action at all (`canCopy` is false when `sourceExists` is false), so the string is never needed. If a race makes it reachable anyway (the source vanishes between the row rendering and the click), it is NOT `copyBriefFromSource`'s catch that reports it: `startLibraryCopy` sends `requestDocSource` before `copyBriefFromSource` ever runs, and `main.ts`'s handler for that message resolves the source node itself. When it is gone, that handler replies with `docSourceError` and the message `The source component is gone, so this doc can no longer be rebuilt.` (`main.ts:1187`), which `ui-vnext.ts`'s `docSourceError` case surfaces as the operation's failure toast. `copyBriefFromSource` is never reached in this race at all; its own catch only covers a source that resolved but then failed to extract.
