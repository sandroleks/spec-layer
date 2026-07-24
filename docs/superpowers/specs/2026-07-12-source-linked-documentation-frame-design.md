# Source-linked documentation frame v1 — design

*Backlog item 2.1. Written 2026-07-12 on branch `plugin-3.0`. Headline differentiator: "docs that stay connected to your components." On-canvas prerequisite for the Tier 4 drift-detection bet (4.1).*

## Problem

Today a generated doc Section is tied to its source component only by **name** (`"<Name>: Documentation"`), discovered by scanning the **current page**, and the source node id — though passed into `renderDocFrame` — is **never stored**. There is no durable link, no way to tell whether a doc is still in sync with its component, no way to see all the docs you have made, and regenerating relies on a fragile name match on one page.

This feature gives every generated Section a durable identity, a small read-time status model, and a management surface ("My Library") to see and act on all connected docs.

## Goals

- Each generated Section carries a durable link to its source (`sourceNodeId`) plus the data needed to detect drift and hand-edits, and to faithfully regenerate.
- A doc's status (in sync / update available / edited / orphaned) is computable at read time.
- Explicit **Update** (regenerate in place), **Detach** (keep frame, stop tracking), **Remove** (delete frame).
- A **My Library** tab listing every connected doc, with row-click navigation and per-row actions.
- Pre-2.1 docs are adopted into the system on their next regenerate — no migration script.

## Non-goals (explicitly deferred)

- **Manual-edit merge** on Update (three-way merge). Deferred to Tier 4.2. v1 Update overwrites, warning first only when the doc was hand-edited.
- **Bulk "Update all."** Deferred. v1 updates one doc at a time.
- **Multiple docs per source.** v1 keeps one doc per source, matching today's single-Section behavior.
- **Full-structure edit detection.** v1 detects text-content edits only (see Status model).

## Data model

### On each generated Section (node `pluginData`)

One JSON blob under a namespaced key (e.g. `specLayer:doc`). `pluginData` values are strings, so store `JSON.stringify` of:

```
{
  v: 1,                         // schema version
  sourceNodeId: string,         // the documented COMPONENT / COMPONENT_SET
  contentHash: string,          // extractor spec hash at generation (drift baseline)
  selfHash: string,             // text-content hash of the built Section (hand-edit baseline)
  config: {                     // enough to reproduce the doc on Update
    sections: string[],         // checked section ids
    variantIds: string[],       // selected variant node ids
    aiEnabled: boolean
  },
  generatedAt: number,          // Date.now() at build
  pluginVersion: string
}
```

`config` is the load-bearing addition: without it, Update cannot reproduce the doc it is replacing.

### Registry (`figma.root` pluginData)

A minimal index — an array of doc Section ids only:

```
{ v: 1, docIds: string[] }
```

Everything displayable is read back from each Section's own `pluginData`, so the **Section is the single source of truth** and the registry is a pure lookup index. Stored on `figma.root` (not `clientStorage`) so it **travels with the file** and is **shared across the whole team**; `clientStorage` would be per-user-per-device, which is wrong for this.

## Identity & discovery

- **No document scan.** To enumerate, resolve each `docId` via `figma.getNodeByIdAsync(id)`, which resolves a node by id across the document and lazily loads only the page it lives on (first access only). Cost is O(number of docs), not O(document). `loadAllPagesAsync()` is explicitly avoided — it is the operation Figma discourages and the reason the dynamic-page APIs exist.
- **Self-healing.** A `docId` that resolves to `null` (Section deleted) is pruned from the registry on read. Dangling entries never accumulate. The registry is a hint; the Section's `pluginData` is authoritative.

## Status model

A doc's status is not one enum — it is three independent facts computed at read time, resolved to one displayed badge.

| Fact | Computation | Cost |
|---|---|---|
| **source exists?** | `getNodeByIdAsync(sourceNodeId)` → non-null | cheap |
| **self edited?** | text-content hash of Section vs stored `selfHash` | cheap (walk text nodes) |
| **source drifted?** | re-serialize source → re-extract → `contentHash` vs stored | moderate (serialize + extract, deterministic, no AI, no quota) |

Displayed badge, priority order:

1. **Orphaned** — source gone. Actions: Detach / Remove only.
2. **Update available** — source drifted. Action: Update.
3. **Edited** — hand-edited, source unchanged. Informational; drives the Update warning.
4. **In sync** — all clear.

"Update available" and "Edited" can both be true; that is exactly the case the hand-edit warning guards — Update would overwrite manual work.

### Hand-edit detection (`selfHash`)

Text content only. After building the Section, walk its text nodes in document order, concatenate their characters, hash, store as `selfHash`. On read, recompute and compare. This catches the overwhelmingly common edit (someone rewrote the copy) cheaply and stably. It will not catch moved / restyled / deleted nodes; the warning copy is honest about scope ("the text in this doc was changed since it was generated"). Full-structure hashing is rejected for v1: expensive per doc (bad for enumerating many in My Library) and brittle against Figma value normalization (false "edited" flags).

## Create flow changes (`main.ts` `renderDocFrame`)

- Match the prior doc for a source by **registry / `sourceNodeId`** first. Keep **name-match as a fallback** so pre-2.1 docs are **adopted** (stamped with `pluginData` + added to the registry) the first time they are regenerated. This is the migration path; no data-migration script is needed.
- One doc per source. On every build: stamp Section `pluginData`, update the registry, preserve the replaced Section's x/y (as today).

## My Library tab

- **Three tabs total**, same pill/`role="tab"` pattern and right-aligned theme button as today: **Selected component** (untouched generate flow) · **My Library** (new) · **Settings** (untouched). New panel id `tab-panel-library`. Verify the three labels + theme button fit at 480px; shorten if the row overflows.
- **List rows**: component name (title); page name + status badge (subtitle). **Row click → select and zoom to the Section** on canvas, switching page if needed. Overflow menu per row: *Go to source component*, *Update*, *Detach*, *Remove*.
- **Header summary**: e.g. "4 connected docs · 1 update available".
- **Drift is the one expensive check**, so rows render **instantly** with the cheap facts (exists / edited), and drift resolves **progressively** per row — sources re-extracted one at a time, throttled. Automatic on tab open (not a manual "Check for updates" button).
- **Empty state**: points back to Selected component ("No connected docs yet. Generate one from the Selected component tab.").

## Actions

- **Update** — regenerate in place from the current source, reusing stored `config`. AI sections re-run exactly like an initial generation: counts against the freemium quota, same AI disclosure. Preserves x/y. If **self edited**, warn first ("This will overwrite manual changes you made to this doc." — merge is Tier 4). Rewrites `pluginData` (new hashes, new `generatedAt`).
- **Detach** — clear the Section's `pluginData` link and drop its id from the registry. The frame stays as a plain Section, no longer tracked.
- **Remove** — delete the Section node and its registry entry.
- **Orphaned** docs offer only Detach / Remove (no live source to update from).

## Message protocol additions

`packages/plugin/src/messages.ts`. Names indicative:

- **UI → Main**: `requestLibrary` (enumerate + prune, return per-doc cheap facts), `requestDriftCheck { docId }` (serialize source, return `SerializedNode` for the UI to extract+hash), `updateDoc { docId }`, `detachDoc { docId }`, `removeDoc { docId }`, `focusNode { nodeId }` (select + zoom).
- **Main → UI**: `library { docs: [...] }`, `driftSource { docId, node }`, `docUpdated` / `docDetached` / `docRemoved`, error variants.

Drift check keeps serialize on the main thread and extract+hash in the UI (the extractor is pure JS bundled into the UI), consistent with the existing boundary.

## Testing

Pure units where the logic lives, keeping Figma-API glue thin (extractor-purity invariant):

- Status resolution from the three facts → displayed badge (priority order, combined flags).
- Registry add / prune / self-heal (dangling id removed on read).
- Text-content `selfHash` canonicalization (document order, stability across no-op rebuilds).
- `config` round-trip (serialize → parse → reproduces the same `DocFrameModel` inputs).

Extractor `contentHash` is already covered. Figma glue (`getNodeByIdAsync`, zoom, pluginData I/O) stays out of the pure core.

## Invariants respected

- **Extractor purity / boundary**: serialize on main, extract+hash in UI; no new Figma globals in pure code.
- **Hash stability**: reuses the existing `contentHash` projection unchanged; no `render.ts` or projection changes.
- **AI is best-effort garnish**: Update degrades to placeholders on AI failure exactly like Create; drift check itself never calls AI.
- **One grouping map**: `config.sections` are the existing section ids from `docModel.ts`; no fork.

## Deferred / follow-ups

- Manual-edit merge on Update (Tier 4.2).
- Bulk "Update all" with quota-cost preview.
- Multiple docs per source.
- `content_hash` as the seam for CI `spec-layer check` drift detection (Tier 4.1) — this feature is its on-canvas half.
