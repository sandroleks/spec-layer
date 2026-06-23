# Standalone Figma Plugin Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Figma plugin usable on its own — generate AI-written guideline prose (with component vision) and lay out a formatted "Guidelines" frame (text sections + token tables) next to the component on canvas, all without the docs web app.

**Architecture:** All new code lives in `packages/plugin` plus one backward-compatible tweak in `@spec-layer/extractor`. The UI thread orchestrates (extract → AI fill → assemble a `DocFrameModel`), the main thread owns Figma I/O (PNG export, frame building). A pure `docModel` function (spec + prose + selected sections → `DocFrameModel`) is the unit-tested seam between them.

**Tech Stack:** TypeScript, esbuild (`build.mjs`), Figma Plugin API, vitest, the existing `@spec-layer/extractor` (`extract`, `renderSpec`, `draftProse`).

**Spec:** `docs/superpowers/specs/2026-06-23-standalone-figma-plugin-design.md`

**Branch:** `plugin-standalone` (already created; spec already committed there).

---

## Conventions for the implementer

- Run tests from the repo root: `npx vitest run <path>`.
- Build the plugin: `cd packages/plugin && node build.mjs` (no separate `package.json` build script).
- Full gate before final commit: `npm run check` (lint + tsc + tests + web build + plugin build).
- The plugin has **two bundles**: `src/main.ts` → `dist/main.js` (Figma main thread, has `figma.*`), and `src/ui/ui.ts` → embedded in `dist/ui.html` (iframe, has DOM + `fetch`, no `figma.*`). Keep main-thread-only code (`figma.*`) out of `src/ui/**` and DOM code out of `src/main.ts` / `src/docFrame.ts`.
- Message passing is the only bridge: UI → main via `parent.postMessage({pluginMessage}, '*')` (the `send()` helper), main → UI via `figma.ui.postMessage(...)`. Both ends switch on the typed unions in `src/messages.ts`.
- Commit after each task. Use `feat:`/`test:`/`chore:` prefixes and the Co-Authored-By trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

## Task 1: Extractor — base64 image source + cache-key fix

Adds a base64 image path to `draftProse` (the plugin produces base64, not a URL) and fixes the cache key so a vision run is never served a text-only draft. Backward compatible: the web app keeps passing `imageUrl`.

**Files:**
- Modify: `packages/extractor/src/prose/client.ts`
- Test: `packages/extractor/src/prose/client.test.ts` (create if absent; otherwise add cases)

- [ ] **Step 1: Write the failing tests**

Create/extend `packages/extractor/src/prose/client.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { draftProse, proseCacheKey } from './client';
import type { IntermediateSpec } from '../extract';

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [], props: [], variants: [], states: [], tokens: [], related: [], gaps: [],
} as unknown as IntermediateSpec;

const PROSE = JSON.stringify({ definition: 'd', accessibility: 'a', dos: ['x'], donts: ['y'] });

function memStore() {
  const m = new Map<string, string>();
  return { store: m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
}

describe('draftProse base64 image', () => {
  it('sends a base64 image content block when imageBase64 is provided', async () => {
    let captured: any;
    const fetcher = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return { ok: true, json: async () => ({ content: [{ text: PROSE }] }) };
    }) as unknown as typeof fetch;
    const { get, set } = memStore();
    await draftProse(spec, {
      apiKey: 'k', fetcher, cacheStore: { get, set },
      imageBase64: 'AAAA', imageMediaType: 'image/png',
    });
    const userMsg = captured.messages.at(-1);
    const imgBlock = userMsg.content.find((c: any) => c.type === 'image');
    expect(imgBlock.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'AAAA' });
  });

  it('keys a base64 vision draft separately from a text-only draft', () => {
    const textKey = proseCacheKey(spec, {});
    const visionKey = proseCacheKey(spec, { image: true });
    expect(visionKey).not.toEqual(textKey);
    // base64 must produce the vision-marked key, not the text-only one:
    expect(proseCacheKey(spec, { image: true })).toContain(':img');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/extractor/src/prose/client.test.ts`
Expected: FAIL (`imageBase64` not in `DraftOptions`; base64 branch missing).

- [ ] **Step 3: Implement**

In `client.ts`:
- Extend `DraftOptions`:
  ```ts
  /** Base64-encoded component image (plugin path). Mutually exclusive with imageUrl in practice. */
  imageBase64?: string | null;
  imageMediaType?: string; // e.g. 'image/png'
  ```
- Fix the cache-key marker (line ~54):
  ```ts
  const key = proseCacheKey(spec, { image: Boolean(opts.imageUrl || opts.imageBase64) });
  ```
- Build the content block, preferring base64 when present:
  ```ts
  const imageBlock = opts.imageBase64
    ? { type: 'image', source: { type: 'base64', media_type: opts.imageMediaType ?? 'image/png', data: opts.imageBase64 } }
    : opts.imageUrl
      ? { type: 'image', source: { type: 'url', url: opts.imageUrl } }
      : null;
  const content = imageBlock ? [imageBlock, { type: 'text', text: prompt }] : prompt;
  ```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/extractor/src/prose/client.test.ts`
Expected: PASS. Also run existing extractor tests: `npx vitest run packages/extractor` → all green (backward compat).

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/client.ts packages/extractor/src/prose/client.test.ts
git commit -m "feat(extractor): add base64 image source to draftProse + fix vision cache key"
```

---

## Task 2: `DocFrameModel` type + `docModel` pure function

The unit-tested seam. `docModel(spec, prose, selectedSections)` decides which sections appear, in canonical order, and shapes each into a `DocFrameModel` block. Deterministic sections come from the spec; AI sections come from `prose` (placeholder text when prose is null). Defines the `DocFrameModel` type imported by both `messages.ts` and `docFrame.ts`.

**Files:**
- Create: `packages/plugin/src/ui/docModel.ts`
- Test: `packages/plugin/test/docModel.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/plugin/test/docModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDocModel, ALL_SECTIONS, type SectionId } from '../src/ui/docModel';
import type { IntermediateSpec } from '@spec-layer/extractor';

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [{ name: 'Label', nested: false }],
  props: [{ name: 'Size', kind: 'variant', default: 'M', options: ['S','M'] }],
  variants: [{ prop: 'Style', values: ['Filled','Text'] }],
  states: ['Enabled','Hovered'],
  tokens: [{ part: 'Container', property: 'fill', token: 'color/bg', conditions: {} }],
  related: ['Icon'], gaps: [],
} as unknown as IntermediateSpec;

const prose = { definition: 'A button.', accessibility: '- **Keyboard:** focusable', dos: ['Do A'], donts: ["Don't B"] };

describe('buildDocModel', () => {
  it('emits only selected sections, in canonical order', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['definition','variants']));
    expect(model.sections.map(s => s.id)).toEqual(['definition','variants']);
    expect(model.title).toBe('Button: Guidelines');
  });

  it('uses placeholder text for AI sections when prose is null', () => {
    const model = buildDocModel(spec, null, new Set<SectionId>(['definition']));
    const def = model.sections[0];
    expect(def.kind).toBe('prose');
    expect((def as any).text).toMatch(/To be written/);
  });

  it('shapes tokens as a table block grouped by category', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['tokens']));
    const tok = model.sections[0];
    expect(tok.kind).toBe('table');
    expect((tok as any).rows.length).toBeGreaterThan(0);
  });

  it("renders dos and donts with check/cross markers", () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['dosDonts']));
    const block = model.sections[0] as any;
    expect(block.kind).toBe('bullets');
    expect(block.items.some((i: any) => i.text.startsWith('✅'))).toBe(true);
    expect(block.items.some((i: any) => i.text.startsWith('❌'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/plugin/test/docModel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `docModel.ts`**

Define the model types and the builder. Key shapes (kept minimal):

> Imports: the extractor entry (`packages/extractor/src/index.ts`) already `export *`s from `extract`, `tokens`, `prose/prompt`, and `prose/client`, so `IntermediateSpec`, `ProseDrafts`, `draftProse`, `proseCacheKey`, and `formatConditions` are all importable directly from `@spec-layer/extractor` — no new exports needed.

```ts
import type { IntermediateSpec, ProseDrafts } from '@spec-layer/extractor';

export type SectionId =
  | 'definition' | 'anatomy' | 'configuration' | 'variants'
  | 'states' | 'tokens' | 'accessibility' | 'dosDonts' | 'related';

export const ALL_SECTIONS: { id: SectionId; label: string; ai: boolean }[] = [
  { id: 'definition',    label: 'Definition',    ai: true  },
  { id: 'anatomy',       label: 'Anatomy',       ai: false },
  { id: 'configuration', label: 'Configuration', ai: false },
  { id: 'variants',      label: 'Variants',      ai: false },
  { id: 'states',        label: 'States',        ai: false },
  { id: 'tokens',        label: 'Tokens used',   ai: false },
  { id: 'accessibility', label: 'Accessibility', ai: true  },
  { id: 'dosDonts',      label: "Do's & Don'ts", ai: true  },
  { id: 'related',       label: 'Related atoms', ai: false },
];

/** An inline run of text; `bold` marks bold lead-ins parsed from **markers**. */
export interface TextRun { text: string; bold?: boolean }
export interface Bullet { runs: TextRun[]; text: string } // text = plain fallback

export type SectionBlock =
  | { id: SectionId; heading: string; kind: 'prose'; text: string }   // markdown-ish; builder parses runs
  | { id: SectionId; heading: string; kind: 'bullets'; items: Bullet[] }
  | { id: SectionId; heading: string; kind: 'table'; columns: string[]; rows: string[][] };

export interface DocFrameModel { title: string; sections: SectionBlock[] }

const AI_PLACEHOLDER = '_To be written._';

export function buildDocModel(
  spec: IntermediateSpec,
  prose: ProseDrafts | null,
  selected: Set<SectionId>,
): DocFrameModel {
  const out: SectionBlock[] = [];
  for (const { id, label } of ALL_SECTIONS) {
    if (!selected.has(id)) continue;
    out.push(buildSection(id, label, spec, prose));
  }
  return { title: `${spec.name}: Guidelines`, sections: out };
}
```

Implement `buildSection` per id:
- `definition` / `accessibility`: `{ kind: 'prose', text: prose?.X ?? AI_PLACEHOLDER }`.
- `dosDonts`: `{ kind: 'bullets', items: [...dos.map(d => bullet('✅ ' + d)), ...donts.map(d => bullet('❌ ' + d))] }` — or placeholder bullet when prose null.
- `anatomy`: bullets from `spec.anatomy` (`name (component)` when `nested`).
- `configuration`: table from non-variant props → columns `['Name','Kind','Options','Default']`. Reuse the logic from `render.ts:renderConfiguration` (options = `true / false` for boolean, `·`-joined for options, else `—`).
- `variants`: bullets — one per non-state/non-modifier axis (`**Style**: Filled · Text`), default marked; trailing `Modifiers` bullet. Mirror `render.ts:renderVariants` but emit `Bullet`s. (For the prototype, you may simplify: list axes and values, mark default.)
- `states`: bullets from `spec.states`.
- `tokens`: a single `table` block, columns `['Part','Property','Token','Condition']`, rows from `spec.tokens` using `formatConditions(t.conditions)` (import from `@spec-layer/extractor` if exported, else inline `Object.entries`). Group order Color/Typography/Measurements is nice-to-have; a flat table satisfies the test.
- `related`: bullets from `spec.related` (or a single "None." bullet).

Add a small `parseRuns(md: string): TextRun[]` helper that splits on `**...**` into bold/non-bold runs (used later by the frame builder for prose and bold lead-ins). Keep `Bullet.text` as the plain (markers-stripped) string and `Bullet.runs` for styled rendering.

> Imports: `ProseDrafts` and `formatConditions` are already re-exported from `@spec-layer/extractor` (the entry `export *`s from `prose/prompt` and `tokens`), so import them from the package entry like `extract`/`renderSpec` in `actions.ts`. No new exports needed.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/plugin/test/docModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/test/docModel.test.ts
git commit -m "feat(plugin): add DocFrameModel + buildDocModel pure section builder"
```

---

## Task 3: Message protocol additions

Add the four new message variants the AI/frame flow needs. Type-only change; verified by the compiler and by downstream tasks.

**Files:**
- Modify: `packages/plugin/src/messages.ts`

- [ ] **Step 1: Add variants**

`UiToMain` += :
```ts
| { type: 'setAnthropicKey'; value: string | null }
| { type: 'requestComponentImage'; nodeId: string }
| { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string }
```
`MainToUi` += :
```ts
| { type: 'anthropicKey'; value: string | null }
| { type: 'componentImage'; base64: string; mediaType: string }
| { type: 'componentImageError'; message: string }
| { type: 'docFrameDone'; frameName: string }
| { type: 'docFrameError'; message: string }
```
Add `import type { DocFrameModel } from './ui/docModel';` at the top.

> The plugin already exposes the component node id to the UI: the `selection` message carries `node: SerializedNode`, and `SerializedNode.id` is the node id (it becomes `spec.figmaNode`). So the UI passes `state.currentNode.id` as `nodeId` — no change to the `selection` message needed.

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/plugin && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (the switch statements in `main.ts`/`ui.ts` don't yet handle the new types, but unhandled cases are allowed; they're added in later tasks).

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/src/messages.ts
git commit -m "feat(plugin): add AI-key, component-image and doc-frame message types"
```

---

## Task 4: Main thread — component PNG export → base64

Handle `requestComponentImage`: resolve the node, export PNG, cap size, base64-encode, reply. Also persist/echo the Anthropic key alongside the existing `docsEndpoint` handling.

**Files:**
- Modify: `packages/plugin/src/main.ts`

- [ ] **Step 1: Implement the image handler**

In the `figma.ui.onmessage` switch add:

```ts
case 'requestComponentImage': {
  try {
    const node = await figma.getNodeByIdAsync(msg.nodeId);
    if (!node || !('exportAsync' in node)) {
      figma.ui.postMessage({ type: 'componentImageError', message: 'Component not found' } as MainToUi);
      break;
    }
    // Cap the long edge ~1568px to stay within vision limits. Pick a scale that
    // keeps the larger dimension under the cap (never upscale beyond 2x).
    const w = 'width' in node ? (node as SceneNode & { width: number }).width : 1;
    const h = 'height' in node ? (node as SceneNode & { height: number }).height : 1;
    const longEdge = Math.max(w, h, 1);
    const scale = Math.min(2, 1568 / longEdge);
    const bytes = await (node as SceneNode & { exportAsync: (s: ExportSettings) => Promise<Uint8Array> })
      .exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
    const base64 = figma.base64Encode(bytes);
    figma.ui.postMessage({ type: 'componentImage', base64, mediaType: 'image/png' } as MainToUi);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    figma.ui.postMessage({ type: 'componentImageError', message } as MainToUi);
  }
  break;
}
```

- [ ] **Step 2: Add Anthropic key persistence**

Mirror the `docsEndpoint` pattern:
- On boot, after the `docsEndpoint` load, also read `anthropicKey` from `clientStorage` and post `{ type: 'anthropicKey', value }`.
- Add a `case 'setAnthropicKey':` that `await figma.clientStorage.setAsync('anthropicKey', msg.value)`.

- [ ] **Step 3: Verify build**

Run: `cd packages/plugin && node build.mjs`
Expected: `Built dist/main.js` and `Built dist/ui.html`, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/main.ts
git commit -m "feat(plugin): export component PNG to base64 + persist Anthropic key"
```

---

## Task 5: `docFrame.ts` — build the Guidelines frame

Pure Figma-write module. Input `DocFrameModel`, output a frame with auto-layout, headings, prose (with bold runs), bullets, and token tables. Manual-verify in Figma (touches `figma.*`).

**Files:**
- Create: `packages/plugin/src/docFrame.ts`

- [ ] **Step 1: Implement**

Export `async function buildDocFrame(model: DocFrameModel): Promise<FrameNode>`. Requirements:
- Load fonts first: `await Promise.all([Regular, Medium, Bold].map(style => figma.loadFontAsync({ family: 'Inter', style })))`.
- Root frame: vertical auto-layout, padding 32, itemSpacing 24, fixed width ~520, fill near-white, corner radius 8. `name = model.title`.
- Title text node: Inter Medium ~20.
- For each section: a vertical auto-layout group with a heading (Inter Medium ~14, `section.heading`) and the body:
  - `prose`: a text node; set the string from runs, then apply Inter Bold over each bold run's range via `setRangeFontName(start, end, { family:'Inter', style:'Bold' })`. Split on newlines into paragraphs; bullet lines (`- `/`* `) render as bullet text nodes.
  - `bullets`: one text node per bullet (prefix `• `), bold runs applied like prose.
  - `table`: a vertical auto-layout; a header row (Medium) then one row per data row. Each row is a horizontal auto-layout of cell text nodes with `layoutGrow`/fixed widths; add a thin bottom border (rectangle or a 1px frame) for legibility. Keep it simple — even fixed-width columns are fine for the prototype.
- Helper `makeText(chars, style, size, color)` to cut repetition.
- Return the frame (caller positions and inserts it).

Keep this file focused on node construction only; **no** message handling, **no** model assembly.

- [ ] **Step 2: Typecheck**

Run: `cd packages/plugin && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (Behavior is verified in Task 10's manual pass.)

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/src/docFrame.ts
git commit -m "feat(plugin): add docFrame builder (auto-layout sections, bold runs, token tables)"
```

---

## Task 6: Main thread — `renderDocFrame` handler

Resolve the node, build the frame via `buildDocFrame`, replace any existing `<Component>: Guidelines` frame, position it to the right of the component, select+scroll to it, reply.

**Files:**
- Modify: `packages/plugin/src/main.ts`

- [ ] **Step 1: Implement**

Placement rule (resolve order, no contradictions): if a prior frame with the same name exists, reuse its position and remove it; otherwise position to the right of the component resolved **by `msg.nodeId`** (re-resolved, since selection may have changed — matches the spec); otherwise fall back to `(0,0)`.

```ts
case 'renderDocFrame': {
  try {
    const frame = await buildDocFrame(msg.model);
    // Replace an existing frame with the same name on the current page.
    const existing = figma.currentPage.findOne(
      n => n.type === 'FRAME' && n.name === msg.model.title,
    ) as FrameNode | null;
    let x = 0, y = 0;
    if (existing) {
      x = existing.x; y = existing.y;
      existing.remove();
    } else {
      // Re-resolve the component by id (selection may have changed since extract).
      const comp = await figma.getNodeByIdAsync(msg.nodeId);
      if (comp && 'x' in comp && 'width' in comp) {
        const c = comp as SceneNode & { x: number; y: number; width: number };
        x = c.x + c.width + 80; y = c.y;
      }
    }
    frame.x = x; frame.y = y;
    figma.currentPage.appendChild(frame);
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);
    figma.ui.postMessage({ type: 'docFrameDone', frameName: frame.name } as MainToUi);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
  }
  break;
}
```
Add `import { buildDocFrame } from './docFrame';` at the top. (`runCreateDocFrame` in Task 9 must include `nodeId: state.currentNode.id` in the `renderDocFrame` message.)

- [ ] **Step 2: Build**

Run: `cd packages/plugin && node build.mjs`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/src/main.ts
git commit -m "feat(plugin): handle renderDocFrame — build, place, and replace guidelines frame"
```

---

## Task 7: UI — AI orchestration (`ai.ts`)

Wrap `draftProse`: read the key from state, request the component PNG (await the round-trip), call Anthropic, return `ProseDrafts`. In-memory `Map` cache so repeat clicks don't re-bill.

**Files:**
- Create: `packages/plugin/src/ui/ai.ts`
- Modify: `packages/plugin/src/ui/ui.ts` (resolve the image round-trip — wired in Task 9)

- [ ] **Step 1: Implement `ai.ts`**

```ts
import { draftProse } from '@spec-layer/extractor';
import type { IntermediateSpec, ProseDrafts } from '@spec-layer/extractor';
import { send } from './actions';

// One in-flight image request at a time; resolved by ui.ts on 'componentImage'.
// The timer is cleared on resolve so a stale timeout can never null-resolve a
// newer request (see plan review). settle() is idempotent and self-clearing.
type ImageResult = { base64: string; mediaType: string } | null;
let pendingImage: ((r: ImageResult) => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function settle(r: ImageResult): void {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  const fn = pendingImage; pendingImage = null;
  fn?.(r);
}
export function resolveComponentImage(r: ImageResult): void { settle(r); }

function requestImage(nodeId: string): Promise<ImageResult> {
  return new Promise((resolve) => {
    pendingImage = resolve;
    send({ type: 'requestComponentImage', nodeId });
    pendingTimer = setTimeout(() => settle(null), 15000); // fail open → text-only
  });
}

const cache = new Map<string, string>();
const cacheStore = {
  get: async (k: string) => cache.get(k) ?? null,
  set: async (k: string, v: string) => { cache.set(k, v); },
};

export async function generateProse(
  spec: IntermediateSpec, apiKey: string, nodeId: string,
): Promise<ProseDrafts | null> {
  const img = await requestImage(nodeId);
  return draftProse(spec, {
    apiKey, fetcher: window.fetch.bind(window), cacheStore,
    imageBase64: img?.base64 ?? null,
    imageMediaType: img?.mediaType,
  });
}
```


- [ ] **Step 2: Typecheck**

Run: `cd packages/plugin && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/src/ui/ai.ts
git commit -m "feat(plugin): add AI orchestration (image round-trip + draftProse + Map cache)"
```

---

## Task 8: UI — DOM restructure (checklist, buttons, API-key field)

Add the section checklist, **Generate with AI** + **Create doc frame** buttons, a collapsed "Also" area for Download/Send, and an Anthropic API-key field in Settings. New `Refs` entries + markup; keep existing ids so current handlers still resolve.

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts`

- [ ] **Step 1: Markup**

In the Selected panel's `#main-area`, after the component head:
- Replace the single "Extract spec" button with a **section checklist**: render one `.check-row` per `ALL_SECTIONS` entry (id `sec-<id>`, checked by default except `related`), with an `(AI)` badge on AI sections. (Static markup is fine — hardcode the 9 rows to avoid importing `docModel` into `dom.ts`, or build the rows in `mount()` from `ALL_SECTIONS`.)
- Two primary actions: `#generate-btn` ("Generate with AI") and `#create-frame-btn` ("Create doc frame").
- A collapsed `<details>` "Also" block wrapping the existing `#review-area` (textarea + `#send-btn` + `#download-btn`) so they remain but de-emphasized.

In the Settings panel, add an **AI** section above or below Docs platform:
```html
<h2>AI</h2>
<p class="hint">Your Anthropic API key. Stored locally in this plugin only; used to write guideline prose.</p>
<label class="field-label" for="anthropic-key-input">Anthropic API key</label>
<input type="password" id="anthropic-key-input" placeholder="sk-ant-…" />
```
(Add a `input[type="password"]` rule mirroring `input[type="text"]`.)

- [ ] **Step 2: Refs**

Add to `Refs` and `mount()`: `generateBtn`, `createFrameBtn`, `anthropicKeyInput`, and a ref per checkbox (e.g. a `sectionChecks: Record<SectionId, HTMLInputElement>` built in `mount()`), plus the `<details>` element if you need to toggle it.

- [ ] **Step 3: Typecheck + build**

Run: `cd packages/plugin && npx tsc --noEmit -p tsconfig.json && node build.mjs`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/ui/dom.ts
git commit -m "feat(plugin): restructure UI — section checklist, generate/create buttons, API key field"
```

---

## Task 9: UI — state + actions (implicit extract, generate, create frame)

Add state fields and the `runGenerate` / `runCreateDocFrame` handlers. Both auto-extract first (implicit). Plumb the API key.

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts`

- [ ] **Step 1: Extend `UiState`**

Add: `anthropicKey: string | null` (init null), `generatedProse: ProseDrafts | null` (init null). Keep `currentSpec` as the extraction result.

- [ ] **Step 2: `ensureExtracted` helper**

```ts
function ensureExtracted(state: UiState): boolean {
  if (state.currentSpec) return true;
  if (!state.currentNode) return false;
  const { spec, markdown, extractedAt } = renderOne(state.currentNode, state.currentFileKey);
  state.currentSpec = spec; state.renderedMd = markdown; state.currentExtractedAt = extractedAt;
  return true;
}
```

- [ ] **Step 3: `runGenerate`**

Reads selected sections (from refs); if none are AI sections, no-op with a hint. Requires `state.anthropicKey` — else show inline banner "Add your Anthropic API key in Settings." Calls `ensureExtracted`, then `generateProse(state.currentSpec, key, state.currentNode.id)`; stores `state.generatedProse`; banners success/failure. Disable the button while in flight.

- [ ] **Step 4: `runCreateDocFrame`**

`ensureExtracted`; read selected `Set<SectionId>` from refs; `const model = buildDocModel(state.currentSpec, state.generatedProse, selected)`; `send({ type: 'renderDocFrame', model, nodeId: state.currentNode.id })`; banner "Building frame…". (Success/failure banners come from the `docFrameDone`/`docFrameError` handlers in Task 10.)

- [ ] **Step 5: API-key setter** — small handler that updates `state.anthropicKey` and `send({ type: 'setAnthropicKey', value })`.

- [ ] **Step 6: Typecheck + build**

Run: `cd packages/plugin && npx tsc --noEmit -p tsconfig.json && node build.mjs`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/actions.ts
git commit -m "feat(plugin): add implicit extract, runGenerate, runCreateDocFrame, API-key plumbing"
```

---

## Task 10: UI — wiring + new message handlers, then manual verify

Wire the new buttons/inputs and handle the new `MainToUi` messages in `ui.ts`. Then run the full manual smoke test in Figma.

**Files:**
- Modify: `packages/plugin/src/ui/ui.ts`

- [ ] **Step 1: Event listeners**

- `refs.generateBtn` → `runGenerate(refs, state)`.
- `refs.createFrameBtn` → `runCreateDocFrame(refs, state)`.
- `refs.anthropicKeyInput` `change` → set state + `setAnthropicKey`.

- [ ] **Step 2: Message handlers** in `window.onmessage`:
- `case 'anthropicKey'`: set `state.anthropicKey`, reflect into `refs.anthropicKeyInput.value`.
- `case 'componentImage'` / `'componentImageError'`: call `resolveComponentImage(...)` from `ai.ts` (pass `null` on error so generation proceeds text-only).
- `case 'docFrameDone'`: success banner ``Created ${msg.frameName}``; re-enable `createFrameBtn`.
- `case 'docFrameError'`: error banner; re-enable button.

- [ ] **Step 3: Build**

Run: `cd packages/plugin && node build.mjs`
Expected: clean.

- [ ] **Step 4: Manual smoke test in Figma** (throwaway-scope verification)

Load the dev plugin (Plugins → Development → Import from manifest → `packages/plugin/manifest.json`), then:
1. Select a component set → checklist appears, deterministic sections present.
2. Settings → paste Anthropic key. Back on Selected → **Generate with AI** → success banner; no errors.
3. **Create doc frame** → a `<Component>: Guidelines` frame appears to the right, with formatted sections + a token table; bold lead-ins are bold.
4. **Create doc frame** again → the frame is replaced in place (not duplicated).
5. Uncheck some sections → regenerate frame reflects the selection.
6. Without a key: AI sections show `_To be written._`; frame still builds.
7. "Also" area: Download still produces a `.zip`; Send to docs still works against a running docs app.

Record the result in the PR/commit description. Fix any issues found, rebuild, re-verify.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/ui.ts
git commit -m "feat(plugin): wire generate/create actions + AI and doc-frame message handlers"
```

---

## Task 11: Manifest — allow Anthropic

**Files:**
- Modify: `packages/plugin/manifest.json`

- [ ] **Step 1:** Add `https://api.anthropic.com` to both `networkAccess.allowedDomains` and `devAllowedDomains`. Update `reasoning` to mention the in-plugin AI guideline generation (BYO key calling Anthropic directly).

- [ ] **Step 2: Commit**

```bash
git add packages/plugin/manifest.json
git commit -m "chore(plugin): allow api.anthropic.com for in-plugin AI generation"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full gate**

Run: `npm run check`
Expected: lint, tsc, unit tests, web build, and plugin build all pass. (The new tests in Tasks 1–2 run here; Figma-write modules are excluded from unit tests by design.)

- [ ] **Step 2: Confirm `main` untouched & branch state**

Run: `git log --oneline main..plugin-standalone` (review the task commits) and `git status` (clean).

- [ ] **Step 3: Finish the branch** — use superpowers:finishing-a-development-branch to decide merge vs PR vs leave-for-experimentation. Given throwaway scope, leaving it on the branch for hands-on iteration is the likely choice.

---

## Notes / known limitations (throwaway scope)

- Token tables are flat (Color/Typography/Measurements grouping is a nice-to-have, not required by tests). Faithful pivot tables from `render.ts` are out of scope.
- The frame uses hardcoded Inter + a neutral palette, not the user's own design tokens.
- Plugin-generated prose lives only in the Figma frame; "Send to docs" still sends the structured spec and the docs app re-derives its own prose.
- `docFrame.ts` and the main-thread handlers are verified manually, not unit-tested.
