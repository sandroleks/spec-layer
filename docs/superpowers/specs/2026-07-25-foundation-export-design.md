# Foundation export v1 — design

*New backlog item. Written 2026-07-25 on branch `foundations-1.0`. Extends the product from "documents one component" to "documents the whole foundation": variable collections and text styles, on canvas and as markdown.*

## Problem

Every extraction path in the product today hangs off a **selection**. The plugin serializes the selected component, derives an `IntermediateSpec`, and renders a doc frame or a `.md` file. Nothing documents the layer underneath components: variable collections, their modes, and text styles.

Variables are touched, but only shallowly. `tokenResolve.ts` reads local `COLOR` and `FLOAT` variables and text styles for one purpose — resolving a token *name* found in a component spec into a swatch, a number, or a typography summary. It reads the **default mode only** and deliberately drops any name that appears in more than one collection, because a spec token is a bare string with no collection context. That is the right call for its job and useless as a foundation model: no modes, no alias chains, no descriptions, no collection structure.

So a user who documents twelve components with this plugin still has no document for the color ramp those components are built from, and no way to hand a developer the token values.

## Goals

- Extract the file's full local foundation: every variable collection, every mode, every variable (`COLOR`, `FLOAT`, `STRING`, `BOOLEAN`) with alias chains and author-written descriptions, plus every local text style with full metrics.
- Render it as on-canvas doc frames that mirror the file's own structure.
- Render it as markdown documents that download, ZIP, and display in the docs app.
- Track foundation frames the same way component frames are tracked: durable `pluginData` link, drift detection, My Library rows, Update / Detach / Remove.
- Optional AI usage notes, one per output unit, metered by the existing quota.
- Leave the component path — and every already-generated component doc — completely unchanged.

## Non-goals (explicitly deferred)

- **Paint, effect, and grid styles.** Variables are the primary color and dimension layer in modern Figma files. Effects are already tracked separately as backlog 3.3.
- **Code exporters** (DTCG JSON, CSS custom properties, Tailwind, SCSS). The data model is designed so these are additive renderers over the same `FoundationSpec`, but v1 ships documentation only.
- **Per-variable AI prose.** Quota-hostile and low value.
- **The px / rem unit setting.** Backlog 2.3, orthogonal, applies to both paths.
- **Library / remote collection browsing.** v1 documents the *local* foundation. Aliases pointing into a library are surfaced explicitly (see Alias resolution) but library collections are not enumerated.
- **Swatch rendering in the docs app.** v1 markdown carries hex text. The `.spec-data` sidecar is written so a real swatch grid is possible later without re-extraction.

## Decisions taken during design

| Question | Decision | Why |
|---|---|---|
| Output kind | Documentation first, code exporters later, one shared model | Doc renderer forces the extraction to be complete; exporters are then nearly free |
| v1 sources | Variable collections + text styles | The real token layer; paint/effect/grid deferred |
| Grouping | Mirror the file exactly — one unit per collection | Zero interpretation, no name-pattern guessing |
| Modes | One table column per mode, capped at 4 | Readable and comparison-friendly at real-world mode counts |
| Link tracking | Full — `pluginData`, drift, My Library | Feeds the Tier 4.1 drift bet |
| Markdown | In v1, alongside frames | Docs app and ZIP export stay coherent with the component path |
| AI | Optional usage notes per output unit | Matches the component flow's feel without inventing per-token fiction |
| Gating | Free; only AI notes metered | Preserves the standing line: anything Figma already knows is free |
| Large collections | Auto-split at ~150 rows by top-level group | Readable frames, bounded build chunks, still faithful |

A file that keeps its color in **paint styles** rather than color variables will produce no Colors content in v1. The empty state must say *why* (no color variables in this file) rather than implying the file has no color.

## Data model

### `packages/extractor/src/foundation.ts` (new, pure)

```ts
export type FoundationValue =
  | { kind: 'color';   hex: string; alpha: number }
  | { kind: 'number';  value: number }
  | { kind: 'string';  value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'alias';   targetName: string; targetCollection: string;
                       external: boolean; resolved: FoundationValue | null }
  | { kind: 'unresolved'; reason: 'cycle' | 'missing' | 'external' | 'depth' };

export interface FoundationMode { modeId: string; name: string }

export interface FoundationVariable {
  name: string;              // full path, e.g. "color/bg/brand"
  group: string;             // top-level segment, e.g. "color"
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  description: string;       // author-written, from Figma
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, FoundationValue>;   // keyed by modeId
}

export interface FoundationCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variables: FoundationVariable[];
}

export interface FoundationTextStyle {
  name: string;
  group: string;
  description: string;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: { unit: 'AUTO' | 'PIXELS' | 'PERCENT'; value?: number };
  letterSpacing: { unit: 'PIXELS' | 'PERCENT'; value: number };
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: string;
  textDecoration: string;
  boundVariables: Record<string, string>;   // property → variable name
}

export interface FoundationSpec {
  fileKey: string;
  collections: FoundationCollection[];
  textStyles: FoundationTextStyle[];
  extractedAt: string;       // ISO 8601, not hashed
}

export type FoundationScope =
  | { target: 'collection'; collectionId: string; collectionName: string;
      group?: string; modeIds: string[] }
  | { target: 'textStyles'; group?: string };
```

`FoundationScope` lives in the extractor rather than in `docLink.ts`, because unit planning and hashing both need it and both are pure. `docLink.ts` already imports `contentHash` from `@spec-layer/extractor`, so the dependency direction is unchanged.

`group` is derived as the substring of `name` before the first `/`, or the whole name when there is no `/`. It drives both subgrouping inside a frame and the split threshold.

### Purity split

Mirrors the existing `serialize.ts` → `extract.ts` boundary.

`packages/plugin/src/serializeFoundation.ts` (new) dumps the raw foundation. It follows the **injected-resolver pattern already used by `serialize.ts`**: it takes a `FoundationReader` interface rather than calling Figma globals, so `main.ts` supplies the real Figma-backed implementation and the tests supply a fake. This keeps the dump builder itself unit-testable instead of being untestable glue. It dumps:

- every local collection via `getLocalVariableCollectionsAsync()` — id, name, modes, `defaultModeId`
- every variable via `getVariableByIdAsync` over `collection.variableIds` — name, `resolvedType`, `description`, `codeSyntax`, and **raw** `valuesByMode` with aliases still as `{ type: 'VARIABLE_ALIAS', id }`
- every local text style via `getLocalTextStylesAsync()`
- for each alias id **not** present in the local dump, one hop of `getVariableByIdAsync` to capture its **name and collection name only**, recorded as an external reference

No value is captured for external references. A remote variable's `valuesByMode` is keyed by the *remote* collection's mode ids, which cannot be mapped onto local modes, so any resolved value would be a guess about which remote mode corresponds to which local one. The arrow and the target name are real; the value is honestly absent.

`foundation.ts` (pure, synchronous) then resolves alias chains by id lookup within the dump.

Two consequences, and they are the reason for the split:

1. **Alias resolution is fixture-testable.** Cycles, depth limits, and dangling targets get unit tests rather than hope.
2. **Cross-file aliases stop being silent.** A semantic variable aliasing a *library* variable is not in the local dump. Resolved external references render as `→ name (library)`; anything still unreachable renders as an explicit note, never a blank cell.

This is the same instinct as the ambiguous-name handling already in `tokenResolve.ts`: refuse to guess, and say so visibly.

### Alias resolution rules

- Follow `VARIABLE_ALIAS` up to depth 4, matching `resolveVariableColor`'s existing limit.
- A repeated id on the current chain is a cycle → `{ kind: 'unresolved', reason: 'cycle' }`.
- Exceeding depth 4 → `reason: 'depth'`.
- Target absent from the dump but resolvable externally → `{ kind: 'alias', external: true, resolved: null }`, rendered as `→ name (library)`.
- Target absent from the dump and not resolvable at all → `reason: 'missing'`.
- Target in a remote collection whose name could not be fetched → `reason: 'external'`.
- A resolved alias keeps **both** hops: `targetName` for the arrow, `resolved` for the swatch or value.
- Alias hops are followed **per mode**. A variable can alias different targets in different modes.

**Which mode of the target to read.** An alias crossing collections lands in a collection with its own, unrelated mode ids, and Figma resolves that at render time from the consuming context — it is not statically determinable. The rule: use the target collection's mode whose **name matches** the source mode's name when one exists, otherwise the target collection's **default mode**. In the overwhelmingly common real setup (a single-mode Primitives collection aliased from a Light/Dark Semantic collection) the default-mode branch is exactly right; the name-match branch covers symmetric multi-mode collections. This is a documented approximation, not a claim of exactness.

### Hashing

`foundationContentHash(spec, scope)` joins `specContentHash` in `packages/extractor/src/hash.ts`, reusing the existing `contentHash` canonical-JSON helper. It hashes the projection of `spec` **restricted to `scope`** — the named collection (optionally narrowed to one group, and to the scope's `modeIds`), or the text styles. Two frames from the same file therefore have independent baselines.

Governing rule: **the hash covers exactly what gets rendered.** Excluded:

- `extractedAt`
- all ids (`collection.id`, variable ids) — the doc is about names and values; ids are internal
- anything extracted but not rendered in v1 (`hiddenFromPublishing`, variable `scopes`)

So "Update available" always corresponds to a change the user can see in the frame. Same reasoning as the existing `rawValues` exclusion from `specContentHash`.

**The rule is enforced mechanically, not by discipline.** A single pure function `unitContent(spec, scope)` produces the rows and mode columns for one output unit. The canvas renderer, the markdown renderer, and the hash all consume its result. There is no second path by which something could be rendered but not hashed, or hashed but not rendered.

The hash is computed **per scope**, not per file, so adding a variable to one collection does not mark every foundation frame stale.

`specContentHash` is not touched. No existing committed component spec can flip.

**One deliberate exception:** AI usage notes are *not* in `contentHash`. They are generated, not extracted, so regenerating prose must not read as source drift. They are covered by `selfHash` instead, matching how component prose already behaves.

## Output units

"Mirror the file" plus the split threshold:

| Source | Frames / documents produced |
|---|---|
| Collection with ≤ `SPLIT_THRESHOLD` (150) variables | `Foundations · Semantic` |
| Collection with > `SPLIT_THRESHOLD` variables | `Foundations · Primitives · color`, `· space`, `· radius` — one per top-level group |
| Text styles ≤ `SPLIT_THRESHOLD` | `Foundations · Text styles` |
| Text styles > `SPLIT_THRESHOLD` | one per top-level group |

`SPLIT_THRESHOLD` is 150, a named constant in `foundation.ts`. Splitting is pure and unit-tested. When a split happens, every frame's header states which group it covers and how many units the set contains, so a reader can tell the set is complete.

An oversized collection whose variables are *all* in one top-level group cannot be split further; it renders as one tall frame. This is an accepted, faithful outcome, not a bug.

## Canvas rendering

`packages/plugin/src/foundationFrame.ts` (new). Reuses `frameKit.ts` — `palette`, `makeText`, `vstack`, `hstack`, `radius`, `font`, `solidFill` — so foundation frames inherit the user's brand theme, fonts, and corner style with no new theming code.

It does **not** live in `docFrame.ts`. That file is already 1279 lines and owns the component document; a second document type belongs beside it.

Each output unit becomes a Section, laid out in a labelled row to the right of existing content, using the same placement approach as `docFrame`.

Frame body:

- Header band: eyebrow, title (`Semantic`), subtitle (`46 variables · 2 modes`).
- Table: Name → description → one column per included mode.
- Color cells: swatch, hex, alpha when below 1.
- Alias cells: `→ color/blue/500` chip plus the resolved swatch, so the semantic layer reads as a layer.
- Number / string / boolean cells: the value, rendered plainly.
- Unresolved cells: the explicit reason, never blank.
- Text style rows: a live specimen line in the actual font, plus a metrics line (family, style, size, line height, letter spacing, case, decoration) and bound-variable names where present.

**Mode cap.** At most 4 mode columns. A collection with more than 4 modes gets mode checkboxes in the UI so the user picks; the frame footer names any modes not shown. Never a silent truncation.

**Font loading.** `loadFontAsync` once per unique family/style pair before building specimens. A failure falls back to Inter **and prints a note on the row**, because a specimen silently rendered in the wrong font is worse than an acknowledged fallback.

**Progress.** Build proceeds unit by unit, posting progress to the UI between units so a large file shows movement rather than appearing hung.

## Link tracking

`DocLinkData` in `docLink.ts` becomes a discriminated union, extended by **discriminator, not version bump**:

```ts
export interface ComponentDocLink {
  v: 1;
  kind?: 'component';        // absent on every existing blob
  sourceNodeId: string;
  contentHash: string;
  selfHash: string;
  config: DocConfig;
  generatedAt: number;
  pluginVersion: string;
}

export interface FoundationDocLink {
  v: 1;
  kind: 'foundation';
  scope: FoundationScope;
  contentHash: string;
  selfHash: string;
  config: FoundationConfig;
  generatedAt: number;
  pluginVersion: string;
}

export type DocLinkData = ComponentDocLink | FoundationDocLink;

export interface FoundationConfig {
  includeDescriptions: boolean;
  aiNotes: boolean;
}
```

`parseDocLink` branches on `kind` **first**. A blob with no `kind` takes today's validation path unchanged, so every already-generated frame in every user's file keeps working. Foundation blobs get their own defensive normalization in the same style: unknown scope target → `null`, non-string `modeIds` filtered out.

`DocRegistry` is unchanged — foundation Sections are just more `docIds`.

**Scope resolution stores both id and name** and resolves by id with a name fallback. Renaming a collection therefore reads as *Update available* (the rendered content genuinely changed) instead of falsely reading as *Source missing*. A collection that is truly gone reads as *Source missing*.

**Drift** re-serializes the foundation **once** per library refresh and compares each tracked scope's hash against its stored baseline. N foundation entries, one extraction.

`LibraryEntry` gains a `kind` and a display label (`Foundations · Semantic`). The four existing badges apply unchanged: In sync / Update available / Manually edited / Source missing. Update, Detach, and Remove reuse the existing message flow with foundation-shaped source requests.

## Plugin UI — the Foundations tab

A 4th peer tab beside Selected component / My Library / Settings. It needs no selection, so the sticky action footer becomes per-tab rather than assuming the first tab.

On tab open the UI requests a summary from the main thread:

- Header line: `3 collections · 2 modes · 46 text styles`
- One checkbox row per collection: name, variable count, mode count
- One checkbox row for Text styles
- Mode checkboxes for any collection with more than 4 modes
- Options: include descriptions (default on), include AI usage notes (default off, quota-metered)
- Actions: Create foundation frames, Download .md

Empty states name the reason rather than shrugging, and each case gets its own line:

| File state | What the tab says |
|---|---|
| No collections, no text styles | This file has no local variable collections or text styles. |
| Text styles only | The Text styles row, plus: this file has no local variable collections. |
| Collections only | The collection rows, plus: this file has no local text styles. |
| Collections exist, none holds `COLOR` | The collection rows, plus: no color variables found, so the docs will have no swatches. |

All new copy follows `docs/plugin-voice-and-copy.md`: plain, honest peer tone, **no em dashes**.

## Markdown and the docs app

### Format package

`parseFrontmatter` is **not** changed. It stays component-only with its current return type, because every web-app caller assumes component identity. A new `parseFoundationFrontmatter` handles the new kind, and a cheap `readKind(md)` helper lets callers dispatch.

```yaml
spec_version: '0.1'
kind: foundation
foundation:
  file_key: abc123
  scope: collection        # | text-styles
  collection: Semantic
  group: color             # optional, present only when split
content_hash: 9f2c…
extracted_at: 2026-07-25T10:12:00.000Z
```

`spec_version` stays `'0.1'`: it describes the container, and adding a document kind is additive. Existing files carry no `kind` and continue through the component path.

### Renderer

`renderFoundationMarkdown(spec, scope)` sits beside `render.ts` in the extractor. One `##` heading per top-level group, then a table with a column per included mode. Descriptions become a column when present and are omitted entirely when the file has none, so files without descriptions do not get a column of blanks. AI usage notes, when enabled, render as a `## Usage` block under the frontmatter.

### Export

`ExportItem` in `exportFiles.ts` becomes a discriminated union: today's shape gains `kind?: 'component'`, and a new `FoundationExportItem` carries `kind: 'foundation'`, `name`, `markdown`, and the scoped `FoundationSpec`. Existing callers pass no `kind` and keep working, exactly as with `DocLinkData`. Foundation items emit `foundations/<slug>.md` plus a `.spec-data/foundations/<slug>.json` sidecar — the same sidecar pattern components already use. Slug collision handling, folder prefixing, and the empty-name fallback are the existing logic, unchanged. v1 renders markdown tables only; the sidecar unblocks a real swatch grid in the docs app later without re-extraction.

### Docs app

The content loader sniffs `kind` and dispatches, so foundation files do not throw "Missing component identity". Foundation files live under `foundations/`, and nav grouping already derives from folders. Tables render through the existing react-markdown + GFM path with no new renderer.

## AI usage notes

- **Granularity:** one short note per *output unit*. Never per variable.
- **Input:** variable names, resolved types, group structure, mode names, and existing descriptions. **No PNG is sent.**
- **Disclosure:** because no image is involved, this needs its own disclosure string rather than reusing the component one (which backlog 1.2 already flags as inaccurate). Shown before first generation.
- **Transport:** the existing proxy `draftProse` path with a new prompt kind. One quota unit per unit generated.
- **Failure:** quota exhausted, offline, or a proxy error builds the frame **without** the note and states that the usage note was not generated. Never a silent gap.
- **Persistence:** recorded in `FoundationConfig` so Update reproduces the same shape; covered by `selfHash`, not `contentHash`.

## Testing

Unit tests (Vitest, existing setup):

- `foundation.ts`: alias chains at depth 1–4, depth overflow, cycles, missing targets, external references, per-mode differing aliases, all four resolved types, `group` derivation including names with no `/`.
- Split logic: under, at, and over threshold; single-group oversized collection; group ordering stability.
- Mode capping: ≤ 4 passthrough, > 4 with an explicit selection, omitted-mode reporting.
- `foundationContentHash`: stable across re-extraction; unaffected by ids and `extractedAt`; changes on a renamed variable, a changed value, a new variable, a renamed mode, a renamed collection; per-scope isolation (a change in collection A leaves collection B's hash alone).
- `parseFoundationFrontmatter` round-trip; regression test that existing component fixtures still parse through `parseFrontmatter`.
- `parseDocLink`: legacy no-`kind` blobs parse identically to today; foundation blobs parse; garbage and partial blobs return `null` without throwing.

Not unit-testable: Figma node construction. Gets a written manual Figma pass following the pattern of commit `4073744` — a real multi-collection multi-mode file, a file with only text styles, a file with neither, a > 150-variable collection, a > 4-mode collection, a missing font, an external alias, then Update / Detach / Remove and the badge transitions.

`npm run check` must stay green. The `verify` CI check is expected red on `npm audit` per the standing decision to wait for Next 16.3.0 stable; unrelated to this work.

## Phasing

Branch `foundations-1.0`.

1. **Extraction model** — `foundation.ts`, `foundationContentHash`, split and mode-cap logic, full unit tests. No UI, no Figma.
2. **Serializer + tab shell** — `serializeFoundation.ts`, new message types, Foundations tab with summary and selection, per-tab footer.
3. **Canvas frames** — `foundationFrame.ts`, progress reporting, font fallback.
4. **Link tracking** — `docLink` union, scope resolution, drift, My Library rows and actions.
5. **Markdown** — format kind, `renderFoundationMarkdown`, export + sidecar, docs-app loader dispatch and nav.
6. **AI usage notes** — prompt kind, proxy path, disclosure, quota and failure handling.
7. **Manual Figma pass**, `CHANGELOG`, `ARCHITECTURE.md` update, backlog entry.

Phases 1 and 2 are the risky ones; 3 through 6 are additive layers over a settled model.

Phases 1 through 4 deliver a complete, shippable feature on their own: foundation docs on canvas, tracked. Phase 5 crosses into `@spec-layer/format` and the web app, and phase 6 into the proxy. If the implementation plan runs long, the 4/5 boundary is the clean split point for a second plan, since nothing in 1 through 4 depends on anything in 5 or 6.

## Backlog interactions

- **2.2 Token display mode toggle** — shares the `codeSyntax` capture this design already extracts. Whichever ships second gets it for free.
- **3.3 Effects & shadows** — the natural v2 addition to `FoundationSpec`; the collection/style shape here is the template.
- **4.1 Drift detection** — foundation hashes give `spec-layer check` a file-level baseline, not just per-component ones.
- **1.2 AI disclosure copy** — this design adds a second disclosure string; fix both together.
