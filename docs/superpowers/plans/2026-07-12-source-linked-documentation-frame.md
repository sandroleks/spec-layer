# Source-linked Documentation Frame v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every generated documentation Section a durable link to its source component, a read-time status (in sync / update available / edited / orphaned), and a "My Library" tab to see and manage all connected docs.

**Architecture:** A pure, Figma-free core (`docLink.ts`) owns the data model — the per-Section `pluginData` blob, the root registry, text-content hashing, and status resolution — and is unit-tested. The main thread stamps that data on generate and resolves docs by id (no document scan). The UI gains a third tab that lists docs, navigates to them, and drives Update / Detach / Remove. Drift is computed progressively per row so the tab stays responsive.

**Tech Stack:** TypeScript, esbuild (plugin build), vitest (tests), Figma Plugin API. npm workspaces monorepo (`spec-layer`).

## Global Constraints

- **Extractor / boundary purity:** no Figma globals in `packages/extractor` or in `packages/plugin/src/docLink.ts`. Serialization stays on the main thread; extraction + hashing run in the UI (as today). (Knowledge map invariant #1.)
- **Hash stability:** the drift baseline MUST use the *existing* `content_hash` projection (excludes `rawValues`, reduces anatomy to depth-0 `{id,name,type,nested}`). Do not change the projection or `render.ts` Markdown output. (Invariant #2.)
- **AI is best-effort garnish:** Update must degrade to placeholders on AI failure exactly like Create; the drift check itself never calls AI. (Invariant #3.)
- **One grouping map:** `config.sections` are the existing `SectionId`s from `docModel.ts`; never fork `ALL_SECTIONS` / `GROUPS`. (Invariant #5.)
- **Plugin voice:** all user-facing copy is plain and honest; **no em or en dashes** in UI strings. (`docs/plugin-voice-and-copy.md`.)
- **Node floor:** Node >= 20.9.
- **Run tests from repo root:** `npx vitest run <path>` for one file; `npm test` for the suite.

---

## File Structure

**Created:**
- `packages/plugin/src/docLink.ts` — pure data model: `DocLinkData`, `DocRegistry`, `DocConfig`, `DocStatus`, `DocFacts`, `LibraryEntry`; parse/serialize; registry add/remove/prune; `textContentHash`; `resolveStatus`; storage-key constants.
- `packages/plugin/test/docLink.test.ts` — unit tests for the above.
- `packages/extractor/test/specHash.test.ts` — golden test locking the extracted `specContentHash`.

**Modified:**
- `packages/extractor/src/hash.ts` — add `specContentHash(spec)` (the projection, moved out of `render.ts`).
- `packages/extractor/src/render.ts` — call `specContentHash` instead of an inline projection (no output change).
- `packages/plugin/src/messages.ts` — extend `renderDocFrame`; add library message variants.
- `packages/plugin/src/main.ts` — stamp `pluginData` + registry on render; resolve-by-id enumerate; drift/update/detach/remove/focus handlers; text-node walk + version inject.
- `packages/plugin/build.mjs` — inject `__PLUGIN_VERSION__` from `package.json`.
- `packages/plugin/src/ui/actions.ts` — send `contentHash` + `config` on render; add `runUpdateFromSource`.
- `packages/plugin/src/ui/dom.ts` — third tab button + `My Library` panel markup + `Refs`.
- `packages/plugin/src/ui/render.ts` — 3-tab `switchTab`; `renderLibrary`.
- `packages/plugin/src/ui/ui.ts` — wire the tab, library message handlers, progressive drift, and row actions.

---

## Task 1: Extract `specContentHash` into the extractor (DRY the drift baseline)

The drift baseline and the Markdown frontmatter must use the *identical* hash. Today the projection is inlined in `render.ts`. Move it to `hash.ts` as an exported function and have `render.ts` call it, so drift comparison can reuse it without duplicating (and risking divergence of) the projection.

**Files:**
- Modify: `packages/extractor/src/hash.ts`
- Modify: `packages/extractor/src/render.ts:123-148`
- Test: `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Produces: `specContentHash(spec: IntermediateSpec): string` — SHA-256 over the projection `{...spec without rawValues, anatomy: depth-0 {id,name,type,nested} only}`. Exported from `@spec-layer/extractor`.

- [ ] **Step 1: Write the failing test**

Create `packages/extractor/test/specHash.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/specHash.test.ts`
Expected: FAIL — `specContentHash is not a function` / import error.

- [ ] **Step 3: Add `specContentHash` to `hash.ts`**

Append to `packages/extractor/src/hash.ts` (keep the existing `contentHash`):

```ts
import type { IntermediateSpec } from './extract';

/**
 * The drift baseline hash. Computed over a projection that excludes rawValues
 * (presentation-only) and reduces anatomy to the legacy depth-0 {id,name,type,
 * nested} shape, so canvas-only 2.0 additions never flip the hash for existing
 * committed specs. This is the single source of truth for content_hash; both
 * the Markdown frontmatter and on-canvas drift detection call it.
 */
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

> Note: if `hash.ts` importing from `./extract` creates a circular import at build time, import the type only: `import type { IntermediateSpec } from './extract';` (type-only imports are erased and cannot cycle). The snippet above already does this.

- [ ] **Step 4: Refactor `render.ts` to call it (no output change)**

In `packages/extractor/src/render.ts`, replace the inline projection (lines ~134-146). Change the import on line 2:

```ts
import { contentHash, specContentHash } from './hash';
```

Replace the `const { rawValues ... } = spec;` block and the `content_hash:` line inside `renderSpec` so the frontmatter reads:

```ts
  const fm: SpecFrontmatter = {
    spec_version: '0.1',
    ...(opts.status ? { status: opts.status } : {}),
    component: { name: spec.name, figma_key: spec.figmaKey, figma_file: spec.figmaFile, figma_node: spec.figmaNode },
    content_hash: specContentHash(spec),
    extracted_at: opts.extractedAt,
  };
```

Delete the now-unused `const { rawValues: _rawValues, ...rest } = spec;` and `const hashable = {...}` lines that preceded `fm`. Keep the explanatory comment block (lines 128-133) — it still documents why the projection exists; move it above the `specContentHash` in `hash.ts` if you prefer, but leaving a one-line pointer in `render.ts` is fine.

- [ ] **Step 5: Run the extractor + render tests**

Run: `npx vitest run packages/extractor`
Expected: PASS — `specHash.test.ts` passes and existing `render` tests still pass (frontmatter `content_hash` unchanged: the projection is byte-identical, just relocated).

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/hash.ts packages/extractor/src/render.ts packages/extractor/test/specHash.test.ts
git commit -m "refactor(extractor): extract specContentHash for reuse as drift baseline"
```

---

## Task 2: The pure `docLink` core

All Figma-free logic for the feature, unit-tested. Later tasks are thin glue around this.

**Files:**
- Create: `packages/plugin/src/docLink.ts`
- Test: `packages/plugin/test/docLink.test.ts`

**Interfaces:**
- Consumes: `SectionId`, `MeasureView` (types) from `./ui/docModel`; `contentHash` from `@spec-layer/extractor`.
- Produces:
  - `DOC_LINK_KEY = 'specLayerDoc'`, `DOC_REGISTRY_KEY = 'specLayerDocs'` (string consts)
  - `interface DocConfig { sections: SectionId[]; variantIds: string[]; aiEnabled: boolean; anatomyView: 'diagram'|'table'|'both'; measureViews: MeasureView[] }`
  - `interface DocLinkData { v: 1; sourceNodeId: string; contentHash: string; selfHash: string; config: DocConfig; generatedAt: number; pluginVersion: string }`
  - `interface DocRegistry { v: 1; docIds: string[] }`
  - `type DocStatus = 'inSync' | 'updateAvailable' | 'edited' | 'orphaned'`
  - `interface DocFacts { sourceExists: boolean; sourceDrifted: boolean; selfEdited: boolean }`
  - `serializeDocLink(d: DocLinkData): string`, `parseDocLink(raw: string): DocLinkData | null`
  - `serializeRegistry(r: DocRegistry): string`, `parseRegistry(raw: string): DocRegistry`
  - `addDoc(r: DocRegistry, docId: string): DocRegistry`, `removeDoc(r: DocRegistry, docId: string): DocRegistry`, `pruneRegistry(r: DocRegistry, keep: Set<string>): DocRegistry`
  - `textContentHash(texts: string[]): string`
  - `resolveStatus(f: DocFacts): DocStatus`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/docLink.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  serializeDocLink, parseDocLink, serializeRegistry, parseRegistry,
  addDoc, removeDoc, pruneRegistry, textContentHash, resolveStatus,
  type DocLinkData,
} from '../src/docLink';

const DATA: DocLinkData = {
  v: 1, sourceNodeId: '10:2', contentHash: 'abc', selfHash: 'def',
  config: { sections: ['definition', 'anatomy'], variantIds: ['1:1'], aiEnabled: true, anatomyView: 'diagram', measureViews: ['size', 'padding', 'spacing'] },
  generatedAt: 1720000000000, pluginVersion: '3.0.0',
};

describe('docLink data', () => {
  it('round-trips DocLinkData', () => {
    expect(parseDocLink(serializeDocLink(DATA))).toEqual(DATA);
  });
  it('parseDocLink returns null on garbage / wrong shape / empty', () => {
    expect(parseDocLink('')).toBeNull();
    expect(parseDocLink('not json')).toBeNull();
    expect(parseDocLink(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseDocLink(JSON.stringify({ v: 1, sourceNodeId: 5 }))).toBeNull();
  });
});

describe('registry', () => {
  it('parses empty/garbage to an empty registry', () => {
    expect(parseRegistry('')).toEqual({ v: 1, docIds: [] });
    expect(parseRegistry('{oops')).toEqual({ v: 1, docIds: [] });
  });
  it('round-trips and add is idempotent', () => {
    let r = parseRegistry(serializeRegistry({ v: 1, docIds: ['a'] }));
    r = addDoc(r, 'b');
    r = addDoc(r, 'b'); // no dup
    expect(r.docIds).toEqual(['a', 'b']);
  });
  it('removeDoc drops the id', () => {
    expect(removeDoc({ v: 1, docIds: ['a', 'b'] }, 'a').docIds).toEqual(['b']);
  });
  it('pruneRegistry keeps only surviving ids (self-heal)', () => {
    expect(pruneRegistry({ v: 1, docIds: ['a', 'b', 'c'] }, new Set(['b'])).docIds).toEqual(['b']);
  });
});

describe('textContentHash', () => {
  it('is order-sensitive and stable', () => {
    const h = textContentHash(['One', 'Two']);
    expect(h).toBe(textContentHash(['One', 'Two']));
    expect(h).not.toBe(textContentHash(['Two', 'One']));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveStatus (priority: orphaned > updateAvailable > edited > inSync)', () => {
  const f = (o: Partial<{ e: boolean; d: boolean; s: boolean }>) => ({
    sourceExists: o.e ?? true, sourceDrifted: o.d ?? false, selfEdited: o.s ?? false,
  });
  it('orphaned when source gone (even if drifted+edited)', () => {
    expect(resolveStatus(f({ e: false, d: true, s: true }))).toBe('orphaned');
  });
  it('updateAvailable outranks edited', () => {
    expect(resolveStatus(f({ d: true, s: true }))).toBe('updateAvailable');
  });
  it('edited when only edited', () => {
    expect(resolveStatus(f({ s: true }))).toBe('edited');
  });
  it('inSync when all clear', () => {
    expect(resolveStatus(f({}))).toBe('inSync');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: FAIL — cannot find module `../src/docLink`.

- [ ] **Step 3: Write `docLink.ts`**

Create `packages/plugin/src/docLink.ts`:

```ts
/**
 * docLink.ts — the pure, Figma-free data model for source-linked docs.
 *
 * Owns the per-Section pluginData blob (DocLinkData), the document-root
 * registry (DocRegistry), text-content hashing for hand-edit detection, and
 * status resolution. No Figma globals: the main thread reads/writes nodes and
 * calls into these helpers, keeping the logic unit-testable (mirrors the
 * extractor-purity boundary).
 */
import { contentHash } from '@spec-layer/extractor';
import type { SectionId, MeasureView } from './ui/docModel';

/** pluginData key on each generated Section. */
export const DOC_LINK_KEY = 'specLayerDoc';
/** pluginData key on figma.root holding the registry index. */
export const DOC_REGISTRY_KEY = 'specLayerDocs';

/** Everything needed to faithfully regenerate a doc on Update. */
export interface DocConfig {
  sections: SectionId[];
  variantIds: string[];
  aiEnabled: boolean;
  anatomyView: 'diagram' | 'table' | 'both';
  measureViews: MeasureView[];
}

/** The blob stored (JSON string) in a Section's pluginData. */
export interface DocLinkData {
  v: 1;
  sourceNodeId: string;
  contentHash: string;   // specContentHash of the source at generation (drift baseline)
  selfHash: string;      // textContentHash of the built Section (hand-edit baseline)
  config: DocConfig;
  generatedAt: number;
  pluginVersion: string;
}

/** The index stored (JSON string) on figma.root. */
export interface DocRegistry { v: 1; docIds: string[] }

export type DocStatus = 'inSync' | 'updateAvailable' | 'edited' | 'orphaned';

export interface DocFacts {
  sourceExists: boolean;
  sourceDrifted: boolean;
  selfEdited: boolean;
}

export function serializeDocLink(d: DocLinkData): string {
  return JSON.stringify(d);
}

/** Defensive parse: returns null on empty/garbage/wrong-shape (never throws). */
export function parseDocLink(raw: string): DocLinkData | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<DocLinkData>;
    if (
      j && j.v === 1 &&
      typeof j.sourceNodeId === 'string' &&
      typeof j.contentHash === 'string' &&
      typeof j.selfHash === 'string' &&
      j.config && Array.isArray(j.config.sections) &&
      typeof j.generatedAt === 'number' &&
      typeof j.pluginVersion === 'string'
    ) {
      return j as DocLinkData;
    }
  } catch { /* fall through */ }
  return null;
}

export function serializeRegistry(r: DocRegistry): string {
  return JSON.stringify(r);
}

export function parseRegistry(raw: string): DocRegistry {
  if (raw) {
    try {
      const j = JSON.parse(raw) as Partial<DocRegistry>;
      if (j && j.v === 1 && Array.isArray(j.docIds)) {
        return { v: 1, docIds: j.docIds.filter((x): x is string => typeof x === 'string') };
      }
    } catch { /* fall through */ }
  }
  return { v: 1, docIds: [] };
}

export function addDoc(r: DocRegistry, docId: string): DocRegistry {
  return r.docIds.includes(docId) ? r : { v: 1, docIds: [...r.docIds, docId] };
}

export function removeDoc(r: DocRegistry, docId: string): DocRegistry {
  return { v: 1, docIds: r.docIds.filter((id) => id !== docId) };
}

/** Keep only ids present in `keep` (drop dangling entries → self-heal). */
export function pruneRegistry(r: DocRegistry, keep: Set<string>): DocRegistry {
  return { v: 1, docIds: r.docIds.filter((id) => keep.has(id)) };
}

/** Hash of a Section's text runs, in document order. Reuses the extractor's
 *  canonical hash so behavior matches the rest of the codebase. */
export function textContentHash(texts: string[]): string {
  return contentHash(texts);
}

/** Displayed status from the three facts. Priority: orphaned > updateAvailable
 *  > edited > inSync. */
export function resolveStatus(f: DocFacts): DocStatus {
  if (!f.sourceExists) return 'orphaned';
  if (f.sourceDrifted) return 'updateAvailable';
  if (f.selfEdited) return 'edited';
  return 'inSync';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck the plugin package**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/docLink.ts packages/plugin/test/docLink.test.ts
git commit -m "feat(plugin): pure docLink core (pluginData model, registry, status)"
```

---

## Task 3: Stamp identity on generate + resolve-by-source replacement

Extend `renderDocFrame` to carry the drift baseline and config; stamp `pluginData` + register on build; replace the prior doc by resolving the registry for a matching `sourceNodeId` (with the legacy name match as an adoption fallback); place/zoom on the doc's own page.

**Files:**
- Modify: `packages/plugin/src/messages.ts:21-32`
- Modify: `packages/plugin/src/ui/actions.ts:272-328`
- Modify: `packages/plugin/src/main.ts` (imports; `renderDocFrame` handler 271-317; add helpers)
- Modify: `packages/plugin/build.mjs`

**Interfaces:**
- Consumes: `DocConfig`, `DocLinkData`, `parseDocLink`, `serializeDocLink`, `parseRegistry`, `serializeRegistry`, `addDoc`, `textContentHash`, `DOC_LINK_KEY`, `DOC_REGISTRY_KEY` from `../docLink` / `./docLink`; `specContentHash` from `@spec-layer/extractor`.
- Produces (message shape):
  `{ type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; config: DocConfig }`

- [ ] **Step 1: Extend the `renderDocFrame` message type**

In `packages/plugin/src/messages.ts`, add the import and change the `renderDocFrame` variant:

```ts
import type { DocConfig } from './docLink';
```

```ts
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; config: DocConfig };
```

- [ ] **Step 2: Send `contentHash` + `config` from the UI**

In `packages/plugin/src/ui/actions.ts`:

Add to the extractor import (line 9-10 region):

```ts
import { extract, renderSpec, ProseProxyError, specContentHash } from '@spec-layer/extractor';
```

Add a docLink import near the other UI imports:

```ts
import type { DocConfig } from '../docLink';
```

In `runCreateDocFrame`, replace the `buildDocModel(...); send({ type: 'renderDocFrame', ... })` block (lines ~313-320) with:

```ts
    const model = buildDocModel(
      state.currentSpec!,
      state.generatedProse,
      selected,
      variantIds,
      { anatomyView: state.anatomyView, measureViews: state.measureViews },
    );
    const config: DocConfig = {
      sections: [...selected],
      variantIds: [...variantIds],
      aiEnabled: state.aiEnabled,
      anatomyView: state.anatomyView,
      measureViews: state.measureViews,
    };
    send({
      type: 'renderDocFrame',
      model,
      nodeId: state.currentNode!.id,
      contentHash: specContentHash(state.currentSpec!),
      config,
    });
```

- [ ] **Step 3: Inject `__PLUGIN_VERSION__` at build time**

In `packages/plugin/build.mjs`, after the imports add:

```js
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const define = { __PLUGIN_VERSION__: JSON.stringify(pkg.version) };
```

Add `define,` to *both* `esbuild.build({...})` option objects (the `main.js` build and the `ui.ts` build).

- [ ] **Step 4: Rewrite the `renderDocFrame` handler in `main.ts`**

Add imports at the top of `packages/plugin/src/main.ts`:

```ts
import {
  DOC_LINK_KEY, DOC_REGISTRY_KEY,
  parseDocLink, serializeDocLink, parseRegistry, serializeRegistry, addDoc,
  textContentHash, type DocLinkData,
} from './docLink';
```

Add the build-time version declaration near the top (after the imports):

```ts
declare const __PLUGIN_VERSION__: string;
```

Add these helpers above `figma.ui.onmessage`:

```ts
// Collect a node subtree's TEXT characters in document order (DFS). Used to
// compute the self-hash that detects hand-edits to a generated Section.
function collectText(node: BaseNode): string[] {
  const out: string[] = [];
  const visit = (n: BaseNode): void => {
    if (n.type === 'TEXT') out.push((n as TextNode).characters);
    if ('children' in n) {
      for (const c of (n as BaseNode & ChildrenMixin).children) visit(c);
    }
  };
  visit(node);
  return out;
}

// The PageNode a node lives on, or null. Walks parents until a PAGE.
function pageOf(node: BaseNode): PageNode | null {
  let cur: BaseNode | null = node;
  while (cur) {
    if (cur.type === 'PAGE') return cur as PageNode;
    cur = (cur as SceneNode).parent ?? null;
  }
  return null;
}

// Read the registry off figma.root.
function readRegistry() {
  return parseRegistry(figma.root.getPluginData(DOC_REGISTRY_KEY));
}
function writeRegistry(r: { v: 1; docIds: string[] }): void {
  figma.root.setPluginData(DOC_REGISTRY_KEY, serializeRegistry(r));
}

// Resolve the existing doc Section for a source, preferring the registry
// (by sourceNodeId, any page); falling back to a legacy name match on the
// current page so pre-2.1 docs are adopted on their next regenerate.
async function findExistingDoc(
  sourceNodeId: string,
  sectionName: string,
): Promise<SectionNode | null> {
  const reg = readRegistry();
  for (const docId of reg.docIds) {
    try {
      const node = await figma.getNodeByIdAsync(docId);
      if (node && node.type === 'SECTION') {
        const data = parseDocLink((node as SectionNode).getPluginData(DOC_LINK_KEY));
        if (data && data.sourceNodeId === sourceNodeId) return node as SectionNode;
      }
    } catch { /* dangling id; enumerate task prunes these */ }
  }
  // Legacy adoption fallback: name match on the current page.
  for (const child of figma.currentPage.children) {
    try {
      if (child.type === 'SECTION' && child.name === sectionName) return child;
    } catch { /* skip unresolved child */ }
  }
  return null;
}
```

Replace the entire `case 'renderDocFrame': { ... }` block (lines 271-317) with:

```ts
    case 'renderDocFrame': {
      try {
        const sectionName = `${msg.model.componentName}: Documentation`;
        const existing = await findExistingDoc(msg.nodeId, sectionName);

        // Regenerate in place: reuse the old doc's position AND its page.
        let targetPage: PageNode = figma.currentPage;
        let x = 0, y = 0;
        if (existing) {
          x = existing.x; y = existing.y;
          const p = pageOf(existing);
          if (p) targetPage = p;
        } else {
          try {
            const comp = await figma.getNodeByIdAsync(msg.nodeId);
            if (comp && 'x' in comp && 'width' in comp) {
              const c = comp as SceneNode & { x: number; y: number; width: number };
              x = c.x + c.width + 80; y = c.y;
            }
          } catch { /* source gone since extract — fall back to origin */ }
        }

        if (targetPage.id !== figma.currentPage.id) {
          await figma.setCurrentPageAsync(targetPage);
        }

        const section = await buildDocFrames(msg.model, resolveTheme(brandTheme), brandLogo);

        // Stamp the durable link BEFORE removing the old one, so a failure
        // mid-way never leaves an unstamped orphan replacing a good doc.
        const data: DocLinkData = {
          v: 1,
          sourceNodeId: msg.nodeId,
          contentHash: msg.contentHash,
          selfHash: textContentHash(collectText(section)),
          config: msg.config,
          generatedAt: Date.now(),
          pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '',
        };
        section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));

        if (existing) existing.remove();
        targetPage.appendChild(section);
        section.x = x; section.y = y;

        // Register (idempotent), dropping the replaced doc's id if it changed.
        let reg = readRegistry();
        if (existing && existing.id !== section.id) reg = { v: 1, docIds: reg.docIds.filter((id) => id !== existing.id) };
        reg = addDoc(reg, section.id);
        writeRegistry(reg);

        figma.currentPage.selection = [section];
        figma.viewport.scrollAndZoomIntoView([section]);
        figma.ui.postMessage({ type: 'docFrameDone', frameName: section.name } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
      }
      break;
    }
```

> The self-hash is computed *after* `buildDocFrames` returns but *before* the Section is re-parented, so it reflects exactly the generated text. `section.id` is stable once the node is created (appendChild does not change it).

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build:plugin`
Expected: both clean. (`__PLUGIN_VERSION__` resolves via the esbuild `define`; the `declare const` satisfies tsc.)

- [ ] **Step 6: Manual Figma verification**

Per `packages/plugin/TESTING.md`, import `packages/plugin/manifest.json` in Figma desktop. Select a component, Create frame. Then in the console (Plugins → Development → Open console) confirm the stamp:

```js
// with the generated Section selected:
figma.currentPage.selection[0].getPluginData('specLayerDoc')
// → JSON with sourceNodeId, contentHash, selfHash, config, generatedAt, pluginVersion
figma.root.getPluginData('specLayerDocs')
// → {"v":1,"docIds":["<section id>"]}
```
Regenerate for the same component and confirm it replaces in place (no duplicate) and the registry still holds one id.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/ui/actions.ts packages/plugin/src/main.ts packages/plugin/build.mjs
git commit -m "feat(plugin): stamp durable source link + registry on generate"
```

---

## Task 4: Library backend — enumerate, navigate, detach, remove

Main-thread handlers that resolve docs by id (no scan), prune dangling ids, and act on a single doc. Cheap facts only (existence + self-edit); drift is Task 5.

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/main.ts` (message switch; helpers from Task 3 reused)

**Interfaces:**
- Consumes: `DOC_LINK_KEY`, `parseDocLink`, `pruneRegistry`, `readRegistry`/`writeRegistry`, `collectText`, `pageOf`, `textContentHash` (Task 3).
- Produces (message shapes):
  - UI→Main: `{ type: 'requestLibrary' }`, `{ type: 'focusNode'; nodeId: string }`, `{ type: 'detachDoc'; docId: string }`, `{ type: 'removeDoc'; docId: string }`
  - Main→UI: `{ type: 'library'; entries: LibraryEntry[] }`, `{ type: 'docDetached'; docId: string }`, `{ type: 'docRemoved'; docId: string }`
  - `interface LibraryEntry { docId: string; componentName: string; pageName: string; sourceNodeId: string; sourceExists: boolean; selfEdited: boolean; storedContentHash: string }`

- [ ] **Step 1: Add the message types**

In `packages/plugin/src/messages.ts`, define and export `LibraryEntry`, then add the variants.

```ts
export interface LibraryEntry {
  docId: string;
  componentName: string;
  pageName: string;
  sourceNodeId: string;
  sourceExists: boolean;
  selfEdited: boolean;
  storedContentHash: string;
}
```

Add to `MainToUi`:

```ts
  | { type: 'library'; entries: LibraryEntry[] }
  | { type: 'docDetached'; docId: string }
  | { type: 'docRemoved'; docId: string }
```

Add to `UiToMain`:

```ts
  | { type: 'requestLibrary' }
  | { type: 'focusNode'; nodeId: string }
  | { type: 'detachDoc'; docId: string }
  | { type: 'removeDoc'; docId: string }
```

- [ ] **Step 2: Add `import type { LibraryEntry }` usage + handlers in `main.ts`**

`LibraryEntry` is referenced only structurally via `MainToUi`, so no extra import is needed. Add these `case`s to the `figma.ui.onmessage` switch:

```ts
    case 'requestLibrary': {
      const reg = readRegistry();
      const entries: LibraryEntry[] = [];
      const alive = new Set<string>();
      for (const docId of reg.docIds) {
        let node: BaseNode | null = null;
        try { node = await figma.getNodeByIdAsync(docId); } catch { node = null; }
        if (!node || node.type !== 'SECTION') continue; // pruned below
        const section = node as SectionNode;
        const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
        if (!data) continue; // detached/foreign section still in the index → prune
        alive.add(docId);

        let sourceExists = false;
        try { sourceExists = (await figma.getNodeByIdAsync(data.sourceNodeId)) != null; } catch { sourceExists = false; }
        const selfEdited = textContentHash(collectText(section)) !== data.selfHash;
        const page = pageOf(section);

        entries.push({
          docId,
          componentName: section.name.replace(/: Documentation$/, ''),
          pageName: page?.name ?? '',
          sourceNodeId: data.sourceNodeId,
          sourceExists,
          selfEdited,
          storedContentHash: data.contentHash,
        });
      }
      // Self-heal: keep only ids that resolved to a real, still-linked doc.
      const pruned = pruneRegistry(reg, alive);
      if (pruned.docIds.length !== reg.docIds.length) writeRegistry(pruned);
      figma.ui.postMessage({ type: 'library', entries } as MainToUi);
      break;
    }

    case 'focusNode': {
      try {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (!node) { figma.notify('That item no longer exists'); break; }
        const page = pageOf(node);
        if (page && page.id !== figma.currentPage.id) await figma.setCurrentPageAsync(page);
        if ('x' in node) {
          const sn = node as SceneNode;
          figma.currentPage.selection = [sn];
          figma.viewport.scrollAndZoomIntoView([sn]);
        }
      } catch { figma.notify("Couldn't open that item"); }
      break;
    }

    case 'detachDoc': {
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (node && node.type === 'SECTION') (node as SectionNode).setPluginData(DOC_LINK_KEY, '');
      } catch { /* gone already */ }
      writeRegistry({ v: 1, docIds: readRegistry().docIds.filter((id) => id !== msg.docId) });
      figma.ui.postMessage({ type: 'docDetached', docId: msg.docId } as MainToUi);
      break;
    }

    case 'removeDoc': {
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (node) node.remove();
      } catch { /* gone already */ }
      writeRegistry({ v: 1, docIds: readRegistry().docIds.filter((id) => id !== msg.docId) });
      figma.ui.postMessage({ type: 'docRemoved', docId: msg.docId } as MainToUi);
      break;
    }
```

Add `import type { LibraryEntry } from './messages';` only if your tsconfig flags the structural use; the existing `MainToUi`/`UiToMain` imports already cover the payloads. (Add it if `npm run typecheck` complains; otherwise omit.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:plugin`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/main.ts
git commit -m "feat(plugin): library backend — enumerate/prune, focus, detach, remove"
```

---

## Task 5: Drift backend + update-source

Two more handlers: `requestDrift` serializes a source so the UI can re-extract and hash it (drift compare); `requestDocSource` returns a serialized source + stored `config` + `selfEdited` so the UI can drive Update.

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/main.ts` (message switch)

**Interfaces:**
- Consumes: `serializeNode` + `resolver` (existing), `resolveFileKey` (existing), `parseDocLink`, `collectText`, `textContentHash`, `DOC_LINK_KEY`.
- Produces (message shapes):
  - UI→Main: `{ type: 'requestDrift'; docId: string; sourceNodeId: string }`, `{ type: 'requestDocSource'; docId: string }`
  - Main→UI: `{ type: 'driftSource'; docId: string; node: SerializedNode; fileKey: string }`, `{ type: 'driftError'; docId: string }`, `{ type: 'docSource'; docId: string; node: SerializedNode; fileKey: string; config: DocConfig; selfEdited: boolean }`, `{ type: 'docSourceError'; docId: string; message: string }`

- [ ] **Step 1: Add the message types**

In `packages/plugin/src/messages.ts` add to `MainToUi`:

```ts
  | { type: 'driftSource'; docId: string; node: SerializedNode; fileKey: string }
  | { type: 'driftError'; docId: string }
  | { type: 'docSource'; docId: string; node: SerializedNode; fileKey: string; config: DocConfig; selfEdited: boolean }
  | { type: 'docSourceError'; docId: string; message: string }
```

Add to `UiToMain`:

```ts
  | { type: 'requestDrift'; docId: string; sourceNodeId: string }
  | { type: 'requestDocSource'; docId: string }
```

- [ ] **Step 2: Add the handlers in `main.ts`**

```ts
    case 'requestDrift': {
      try {
        const src = await figma.getNodeByIdAsync(msg.sourceNodeId);
        if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
          figma.ui.postMessage({ type: 'driftError', docId: msg.docId } as MainToUi);
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, resolver);
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        figma.ui.postMessage({ type: 'driftSource', docId: msg.docId, node, fileKey } as MainToUi);
      } catch {
        figma.ui.postMessage({ type: 'driftError', docId: msg.docId } as MainToUi);
      }
      break;
    }

    case 'requestDocSource': {
      try {
        const docNode = await figma.getNodeByIdAsync(msg.docId);
        if (!docNode || docNode.type !== 'SECTION') {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc no longer exists.' } as MainToUi);
          break;
        }
        const section = docNode as SectionNode;
        const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
        if (!data) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc is no longer linked.' } as MainToUi);
          break;
        }
        const src = await figma.getNodeByIdAsync(data.sourceNodeId);
        if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'The source component is gone, so this doc cannot be updated.' } as MainToUi);
          break;
        }
        const selfEdited = textContentHash(collectText(section)) !== data.selfHash;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, resolver);
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        figma.ui.postMessage({ type: 'docSource', docId: msg.docId, node, fileKey, config: data.config, selfEdited } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
      }
      break;
    }
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:plugin`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/main.ts
git commit -m "feat(plugin): drift + update-source backend handlers"
```

---

## Task 6: Add the "My Library" tab shell (markup + Refs + 3-tab switching)

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts` (tab bar 641-645; panels; `Refs` 868-1116; `mount()` byId block)
- Modify: `packages/plugin/src/ui/render.ts` (`TabId` 295; `switchTab` 297-308)

**Interfaces:**
- Produces (Refs additions): `tabLibrary: HTMLButtonElement`, `panelLibrary: HTMLElement`, `libraryList: HTMLElement`, `libraryEmpty: HTMLElement`, `librarySummary: HTMLElement`.
- Produces: `TabId` gains `'library'`.

- [ ] **Step 1: Add the tab button**

In `packages/plugin/src/ui/dom.ts`, in the `<div class="tabs" role="tablist">` block (641-645), insert the Library tab button between the two existing ones:

```html
    <button class="tab" id="tab-selected" role="tab" aria-selected="true"
            aria-controls="tab-panel-selected">Selected component</button>
    <button class="tab" id="tab-library" role="tab" aria-selected="false"
            aria-controls="tab-panel-library">My Library</button>
    <button class="tab" id="tab-settings" role="tab" aria-selected="false"
            aria-controls="tab-panel-settings">Settings</button>
```

- [ ] **Step 2: Add the panel markup**

Immediately after the closing `</section>` of the Selected-component panel and before the Settings panel (`<!-- ============ Settings panel ============ -->`, ~line 758), insert:

```html
    <!-- ============ My Library panel ============ -->
    <section class="panel" id="tab-panel-library" role="tabpanel"
             aria-labelledby="tab-library">
      <p class="lib-summary" id="lib-summary"></p>
      <div class="lib-empty" id="lib-empty" style="display:none">
        No connected docs yet. Generate one from the Selected component tab.
      </div>
      <div class="lib-list" id="lib-list"></div>
    </section>
```

- [ ] **Step 3: Add minimal styles**

In the `<style>` block (near the `.panel` rules, ~166), add:

```css
    .lib-summary { color: var(--figma-color-text-secondary); font-size: 11px; margin: 4px 2px 10px; }
    .lib-empty { color: var(--figma-color-text-secondary); font-size: 12px; padding: 24px 8px; text-align: center; }
    .lib-row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; cursor: pointer; }
    .lib-row:hover { background: var(--figma-color-bg-hover); }
    .lib-row-main { flex: 1 1 auto; min-width: 0; }
    .lib-row-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lib-row-sub { font-size: 11px; color: var(--figma-color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lib-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
    .lib-badge.insync { background: var(--figma-color-bg-success-tertiary, #e6f4ea); color: var(--figma-color-text-success, #1e7a3c); }
    .lib-badge.update { background: var(--figma-color-bg-brand-tertiary, #e8f0fe); color: var(--figma-color-text-brand, #1a56db); }
    .lib-badge.edited { background: var(--figma-color-bg-warning-tertiary, #fef7e0); color: var(--figma-color-text-warning, #9a6700); }
    .lib-badge.orphaned { background: var(--figma-color-bg-danger-tertiary, #fce8e6); color: var(--figma-color-text-danger, #b3261e); }
    .lib-badge.checking { background: var(--figma-color-bg-secondary); color: var(--figma-color-text-secondary); }
    .lib-menu-btn { flex: 0 0 auto; border: none; background: transparent; cursor: pointer; padding: 4px 6px; border-radius: 4px; color: var(--figma-color-text-secondary); }
    .lib-menu-btn:hover { background: var(--figma-color-bg-secondary); }
    .lib-actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 8px 8px 8px; }
    .lib-actions button { font-size: 11px; padding: 3px 8px; }
```

- [ ] **Step 4: Add the `Refs` fields + `byId` wiring**

In the `Refs` interface (after `panelSettings`, ~875):

```ts
  tabLibrary: HTMLButtonElement;
  panelLibrary: HTMLElement;
  libraryList: HTMLElement;
  libraryEmpty: HTMLElement;
  librarySummary: HTMLElement;
```

In the object returned by `mount()` (after the `panelSettings` byId line, ~1087):

```ts
    tabLibrary: byId<HTMLButtonElement>('tab-library'),
    panelLibrary: byId<HTMLElement>('tab-panel-library'),
    libraryList: byId<HTMLElement>('lib-list'),
    libraryEmpty: byId<HTMLElement>('lib-empty'),
    librarySummary: byId<HTMLElement>('lib-summary'),
```

- [ ] **Step 5: Update `TabId` + `switchTab` in `render.ts`**

Replace lines 295-308:

```ts
export type TabId = 'selected' | 'library' | 'settings';

export function switchTab(refs: Refs, tab: TabId): void {
  const tabs: Array<[TabId, HTMLButtonElement, HTMLElement]> = [
    ['selected', refs.tabSelected, refs.panelSelected],
    ['library', refs.tabLibrary, refs.panelLibrary],
    ['settings', refs.tabSettings, refs.panelSettings],
  ];
  for (const [id, btn, panel] of tabs) {
    const active = id === tab;
    btn.setAttribute('aria-selected', String(active));
    panel.classList.toggle('active', active);
  }
  syncFooter(refs);
}
```

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck && npm run build:plugin`
Expected: clean. (`syncFooter` already hides the footer off the Selected tab, so it stays hidden on Library.)

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/dom.ts packages/plugin/src/ui/render.ts
git commit -m "feat(plugin): My Library tab shell (markup, refs, 3-tab switching)"
```

---

## Task 7: Render the library list

A `renderLibrary(refs, entries, drift)` that paints rows (title, page + badge), an overflow menu that expands per-row actions, and the header summary. Drift is a per-doc map the UI owns.

**Files:**
- Modify: `packages/plugin/src/ui/render.ts`

**Interfaces:**
- Consumes: `LibraryEntry` from `../messages`; `resolveStatus`, `type DocStatus` from `../docLink`.
- Produces: `type DriftState = 'pending' | 'inSync' | 'drifted'`; `renderLibrary(refs: Refs, entries: LibraryEntry[], drift: Map<string, DriftState>): void`. Rows carry `data-doc-id`, `data-source-id`; action buttons carry `data-act` in `'focus'|'source'|'update'|'detach'|'remove'` and `data-doc-id`.

- [ ] **Step 1: Add imports + the render function to `render.ts`**

At the top of `packages/plugin/src/ui/render.ts`, add:

```ts
import type { LibraryEntry } from '../messages';
import { resolveStatus, type DocStatus } from '../docLink';
```

Append:

```ts
// ---------------------------------------------------------------------------
// My Library
// ---------------------------------------------------------------------------

/** Per-doc drift, computed progressively after enumerate. `pending` shows a
 *  "checking" chip; once known it feeds resolveStatus. */
export type DriftState = 'pending' | 'inSync' | 'drifted';

const BADGE: Record<DocStatus, { cls: string; label: string }> = {
  inSync: { cls: 'insync', label: 'In sync' },
  updateAvailable: { cls: 'update', label: 'Update available' },
  edited: { cls: 'edited', label: 'Edited' },
  orphaned: { cls: 'orphaned', label: 'Source deleted' },
};

/** The status to show. Orphaned needs no drift; otherwise a pending drift keeps
 *  the row in a neutral "checking" state so we never flash a wrong badge. */
function rowStatus(e: LibraryEntry, drift: DriftState | undefined): DocStatus | 'checking' {
  if (!e.sourceExists) return 'orphaned';
  if (drift === undefined || drift === 'pending') return 'checking';
  return resolveStatus({ sourceExists: true, sourceDrifted: drift === 'drifted', selfEdited: e.selfEdited });
}

export function renderLibrary(
  refs: Refs,
  entries: LibraryEntry[],
  drift: Map<string, DriftState>,
): void {
  refs.libraryList.textContent = '';
  refs.libraryEmpty.style.display = entries.length ? 'none' : 'block';

  const updatable = entries.filter((e) => e.sourceExists && drift.get(e.docId) === 'drifted').length;
  refs.librarySummary.textContent = entries.length
    ? `${entries.length} connected ${entries.length === 1 ? 'doc' : 'docs'}${updatable ? ` · ${updatable} to update` : ''}`
    : '';

  for (const e of entries) {
    const st = rowStatus(e, drift.get(e.docId));
    const badge = st === 'checking'
      ? { cls: 'checking', label: 'Checking…' }
      : BADGE[st];

    const row = document.createElement('div');
    row.className = 'lib-row';
    row.dataset.docId = e.docId;
    row.dataset.sourceId = e.sourceNodeId;
    row.innerHTML = `
      <div class="lib-row-main">
        <div class="lib-row-title"></div>
        <div class="lib-row-sub"><span class="lib-page"></span> <span class="lib-badge ${badge.cls}"></span></div>
      </div>
      <button class="lib-menu-btn" data-act="menu" aria-label="Actions">⋯</button>`;
    (row.querySelector('.lib-row-title') as HTMLElement).textContent = e.componentName;
    (row.querySelector('.lib-page') as HTMLElement).textContent = e.pageName ? `${e.pageName}` : '';
    (row.querySelector('.lib-badge') as HTMLElement).textContent = badge.label;
    refs.libraryList.appendChild(row);

    // Collapsed action bar (revealed by the overflow menu; wired in ui.ts).
    const actions = document.createElement('div');
    actions.className = 'lib-actions';
    actions.dataset.docId = e.docId;
    actions.style.display = 'none';
    const canUpdate = e.sourceExists;
    actions.innerHTML = `
      <button data-act="focus" data-doc-id="${e.docId}">Go to doc</button>
      ${e.sourceExists ? `<button data-act="source" data-doc-id="${e.docId}">Go to source</button>` : ''}
      ${canUpdate ? `<button data-act="update" data-doc-id="${e.docId}">Update</button>` : ''}
      <button data-act="detach" data-doc-id="${e.docId}">Detach</button>
      <button data-act="remove" data-doc-id="${e.docId}">Remove</button>`;
    refs.libraryList.appendChild(actions);
  }
}
```

> Row titles/page names are set via `textContent` (never interpolated into `innerHTML`) so a component or page named with `<`/`>` can't break layout. The `data-doc-id` on buttons is a Figma node id (safe charset), used only as an action key.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build:plugin`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/src/ui/render.ts
git commit -m "feat(plugin): render the My Library list (rows, badges, actions)"
```

---

## Task 8: Wire the library + Update flow

Wire the tab click, enumerate-on-open, progressive drift, row actions (focus / go-to-source / update / detach / remove) with the hand-edit confirm, and the self-contained `runUpdateFromSource` that rebuilds a doc without disturbing the Selected-component tab's state.

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts` (add `runUpdateFromSource`)
- Modify: `packages/plugin/src/ui/ui.ts` (tab wiring; message cases; list interactions)

**Interfaces:**
- Consumes: `renderLibrary`, `type DriftState` (Task 7); `specContentHash`, `extract` from `@spec-layer/extractor`; `buildDocModel`, `proseKeysForSections` (existing); `generateProse` (existing); `effectiveAuth` (existing); message types (Tasks 4-5).
- Produces: `runUpdateFromSource(refs: Refs, state: UiState, src: { docId: string; node: SerializedNode; fileKey: string; config: DocConfig }): Promise<void>`.

- [ ] **Step 1: Add `runUpdateFromSource` to `actions.ts`**

Add imports:

```ts
import type { SerializedNode } from '@spec-layer/extractor';   // already imported — extend the existing line if present
import { proseKeysForSections } from './docModel';             // add proseKeysForSections to the existing docModel import
import { generateProse } from './ai';                          // already imported
```

(These are already imported in `actions.ts`; just ensure `proseKeysForSections` is included in the `./docModel` import list and `SerializedNode` in the extractor type import.)

Append the function:

```ts
// ---------------------------------------------------------------------------
// Update from source (My Library) — regenerate a doc in place using its stored
// config, WITHOUT touching the Selected-component tab's live state. Extraction
// is deterministic; prose runs only when the stored config had AI on. Dispatches
// renderDocFrame, which replaces the existing doc (matched by sourceNodeId).
// ---------------------------------------------------------------------------
export async function runUpdateFromSource(
  refs: Refs,
  state: UiState,
  src: { docId: string; node: SerializedNode; fileKey: string; config: DocConfig },
): Promise<void> {
  clearBanners(refs);
  startLoader(refs, ['Reading the component', 'Composing sections', 'Placing the frame on the canvas']);
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey });
    const selected = new Set<SectionId>(src.config.sections);

    let prose = null as Awaited<ReturnType<typeof generateProse>>;
    const requested = proseKeysForSections(selected);
    if (src.config.aiEnabled && requested.size > 0 && (state.licenseKey || state.figmaUserId)) {
      try {
        prose = await generateProse(
          spec,
          effectiveAuth(state.licenseKey, state.figmaUserId, state.licenseActive),
          src.node.id,
          requested,
          (q) => { state.quota = q; },
        );
      } catch {
        // AI is best-effort garnish: fall through to placeholders on any failure.
        prose = null;
      }
    }

    const variantIds = new Set<string>(src.config.variantIds);
    const model = buildDocModel(spec, prose, selected, variantIds, {
      anatomyView: src.config.anatomyView,
      measureViews: src.config.measureViews,
    });
    send({
      type: 'renderDocFrame',
      model,
      nodeId: src.node.id,
      contentHash: specContentHash(spec),
      config: src.config,
    });
    // Loader stops on docFrameDone/docFrameError (ui.ts).
  } catch (err) {
    stopLoader(refs);
    const msg = err instanceof Error ? err.message : String(err);
    showBanner(refs, 'error', `Update failed: ${msg}`);
  }
}
```

- [ ] **Step 2: Wire the tab + list in `ui.ts`**

Add to the imports from `./render`: `renderLibrary`, `type DriftState`. Add to the imports from `./actions`: `runUpdateFromSource`. Add `import type { LibraryEntry } from '../messages';` and `import type { DocConfig } from '../docLink';`.

After the existing tab wiring (lines 110-111), add:

```ts
refs.tabLibrary.addEventListener('click', () => {
  switchTab(refs, 'library');
  refreshLibrary();
});
```

Add the library state + orchestration (place near the other module-scope helpers):

```ts
// ---------------------------------------------------------------------------
// My Library
// ---------------------------------------------------------------------------

let libEntries: LibraryEntry[] = [];
const libDrift = new Map<string, DriftState>();
// docId → storedContentHash, so a driftSource reply can compare without a lookup.
const libBaseline = new Map<string, string>();

function refreshLibrary(): void {
  send({ type: 'requestLibrary' });
}

/** Kick off a drift check for every doc whose source still exists. */
function startDriftChecks(): void {
  libDrift.clear();
  libBaseline.clear();
  for (const e of libEntries) {
    if (!e.sourceExists) continue;
    libDrift.set(e.docId, 'pending');
    libBaseline.set(e.docId, e.storedContentHash);
    send({ type: 'requestDrift', docId: e.docId, sourceNodeId: e.sourceNodeId });
  }
}

// Overflow menu toggles the row's action bar; action buttons dispatch.
refs.libraryList.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const btn = t.closest('button') as HTMLButtonElement | null;
  if (!btn) {
    // Row body click (not a button) → go to the doc.
    const row = t.closest('.lib-row') as HTMLElement | null;
    if (row?.dataset.docId) send({ type: 'focusNode', nodeId: row.dataset.docId });
    return;
  }
  const act = btn.dataset.act;
  if (act === 'menu') {
    const row = btn.closest('.lib-row') as HTMLElement | null;
    const bar = row?.nextElementSibling as HTMLElement | null;
    if (bar && bar.classList.contains('lib-actions')) {
      bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
    }
    return;
  }
  const docId = btn.dataset.docId;
  if (!docId) return;
  const entry = libEntries.find((e) => e.docId === docId);
  switch (act) {
    case 'focus': send({ type: 'focusNode', nodeId: docId }); break;
    case 'source': if (entry) send({ type: 'focusNode', nodeId: entry.sourceNodeId }); break;
    case 'update': {
      if (entry?.selfEdited && !confirm('This doc has manual text edits. Updating it will overwrite them with freshly generated content. Continue?')) return;
      send({ type: 'requestDocSource', docId });
      break;
    }
    case 'detach': {
      if (confirm('Detach this doc? It stays on the canvas as a plain frame and stops tracking its component.')) send({ type: 'detachDoc', docId });
      break;
    }
    case 'remove': {
      if (confirm('Remove this doc? This deletes the frame from the canvas.')) send({ type: 'removeDoc', docId });
      break;
    }
  }
});
```

- [ ] **Step 3: Add the message cases in the `window.onmessage` switch**

Inside the `switch (msg.type)` in `ui.ts`, add:

```ts
    case 'library': {
      libEntries = msg.entries;
      renderLibrary(refs, libEntries, libDrift);
      startDriftChecks();
      break;
    }

    case 'driftSource': {
      const baseline = libBaseline.get(msg.docId);
      const spec = extract(msg.node, { figmaFile: msg.fileKey });
      const drifted = specContentHash(spec) !== baseline;
      libDrift.set(msg.docId, drifted ? 'drifted' : 'inSync');
      renderLibrary(refs, libEntries, libDrift);
      break;
    }

    case 'driftError': {
      // Treat an un-checkable source as "in sync" (no false update prompts).
      libDrift.set(msg.docId, 'inSync');
      renderLibrary(refs, libEntries, libDrift);
      break;
    }

    case 'docSource': {
      const src: { docId: string; node: typeof msg.node; fileKey: string; config: DocConfig } = {
        docId: msg.docId, node: msg.node, fileKey: msg.fileKey, config: msg.config,
      };
      void runUpdateFromSource(refs, state, src).finally(() => renderQuota(refs, state));
      break;
    }

    case 'docSourceError': {
      showBanner(refs, 'error', msg.message);
      break;
    }

    case 'docDetached':
    case 'docRemoved': {
      libEntries = libEntries.filter((e) => e.docId !== msg.docId);
      libDrift.delete(msg.docId);
      libBaseline.delete(msg.docId);
      renderLibrary(refs, libEntries, libDrift);
      break;
    }
```

Extend the existing `docFrameDone` case so an Update from the Library refreshes the list (the loader/banner/button logic already there stays):

```ts
    case 'docFrameDone': {
      stopLoader(refs);
      const note = state.pendingAiNote ? `. ${state.pendingAiNote}` : '';
      showBanner(refs, state.pendingAiNote ? 'error' : 'info', `Created ${msg.frameName}${note}`);
      state.pendingAiNote = '';
      refs.createFrameBtn.disabled = false;
      if (refs.panelLibrary.classList.contains('active')) refreshLibrary();
      break;
    }
```

`extract` and `specContentHash` must be imported in `ui.ts` — add them to the `@spec-layer/extractor` import (there is no such import in `ui.ts` yet; add `import { extract, specContentHash } from '@spec-layer/extractor';`).

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build:plugin`
Expected: clean.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all green (new `docLink` + `specHash` tests included).

- [ ] **Step 6: Manual Figma verification (the whole feature)**

Import the plugin (`packages/plugin/TESTING.md`). Then:
1. Generate docs for two different components. Open **My Library** → both listed, badges resolve from "Checking…" to "In sync".
2. Click a row → jumps to the doc on canvas. Menu → "Go to source" → selects the component.
3. Edit the source component (e.g. add a variant / rename a part) → reopen My Library → that row shows **Update available**. Click **Update** → doc regenerates in place, row returns to **In sync**.
4. Hand-edit a doc's text → row shows **Edited**. **Update** shows the overwrite confirm.
5. Delete a source component → its row shows **Source deleted**, offering only Detach / Remove.
6. **Detach** → frame remains, row disappears; reopening confirms it's gone from the list. **Remove** → frame deleted.
7. Put a doc on a different page than the source, Update from Library → it regenerates on the doc's own page and the view navigates there.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/src/ui/ui.ts
git commit -m "feat(plugin): wire My Library — enumerate, drift, update/detach/remove"
```

---

## Self-Review

**Spec coverage:**
- Data model (Section `pluginData` + root registry) → Task 2 (types/serialize), Task 3 (stamp/register). ✓
- No document scan; resolve-by-id; self-heal prune → Task 4 (`requestLibrary`), Task 2 (`pruneRegistry`). ✓
- Three-fact status, priority resolution → Task 2 (`resolveStatus`), Task 7 (`rowStatus` with pending/checking). ✓
- Text-only hand-edit detection → Task 2 (`textContentHash`), Task 3 (`collectText` + selfHash stamp), Task 4/5 (`selfEdited`). ✓
- Create-flow adoption / name fallback / one-per-source → Task 3 (`findExistingDoc`). ✓
- My Library: three tabs, row click nav, per-row actions, header summary, progressive drift, empty state → Tasks 6-8. ✓
- Update reuses config, AI parity + quota, overwrite warn on edit, preserves x/y, in-place on doc's page → Task 3 (placement) + Task 5 (`docSource`) + Task 8 (`runUpdateFromSource`, confirm). ✓
- Detach / Remove semantics → Task 4. ✓
- Hash stability (reuse existing projection) → Task 1. ✓
- Testing: status resolution, registry add/prune/self-heal, selfHash canonicalization, config round-trip → Task 2 tests. ✓
- Deferred (merge, bulk, multi-doc) → not built. ✓

**Placeholder scan:** none — every code step carries full code; manual-verification steps are explicit console/UI checks.

**Type consistency:** `DocConfig` (with `anatomyView`/`measureViews`) is defined once in Task 2 and consumed identically in the message type (Task 3), backend (Task 5), and `runUpdateFromSource` (Task 8). `LibraryEntry` defined once (Task 4), consumed in render (Task 7) and wiring (Task 8). `specContentHash` (Task 1) is the single hash used for both stamping (Task 3) and drift compare (Task 8). `DriftState` defined in Task 7, used in Task 8. Message variant names match across `messages.ts` and both handlers.

**Note on `config.anatomyView`/`measureViews`:** added to `DocConfig` beyond the spec's illustrative "sections, variants, AI on/off" list so Update reproduces the *presentation* faithfully (a doc built as an anatomy table stays a table). Consistent with the spec's stated intent ("enough to reproduce faithfully").
