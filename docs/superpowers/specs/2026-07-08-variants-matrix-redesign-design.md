# Variants section redesign — design

**Date:** 2026-07-08
**Branch:** plugin-2.0
**Scope:** `packages/extractor/src/statesMatrix.ts`, `packages/extractor/src/prose/prompt.ts`,
`packages/plugin/src/ui/docModel.ts`, `packages/plugin/src/statesSection.ts`,
`packages/plugin/src/docFrame.ts`, tests in both packages.

## Problem

The Variants section ([docModel.ts:312](../../packages/plugin/src/ui/docModel.ts)) is
a text bullet list built before the States work. Two things are now stale:

1. It renders a bullet list, not a preview matrix like States.
2. Its "Modifiers: hover · focused · pressed · disabled · loading" bullet lists
   the boolean state-flags that the new States detection already promotes into
   the States matrix — so the same axes appear, differently described, in both
   sections.

## Approved design

### 1. Axis partition (correctness fix)

Add one authoritative helper to `statesMatrix.ts`:

```ts
/** The variant props that the States matrix consumes: the enum state axis, or
 *  the boolean state-flag axes. Variants excludes exactly these. */
export function stateAxisProps(variants: VariantAxis[]): Set<string> {
  const info = detectStateMatrix(variants);
  if (!info) return new Set();
  if (info.encoding === 'enum') return new Set(info.axis ? [info.axis] : []);
  // flags: every non-Default column overrides exactly its own flag prop
  const props = new Set<string>();
  for (const col of info.columns) for (const k of Object.keys(col.override)) props.add(k);
  return props;
}
```

Variants axes = `spec.variants.filter(v => !stateAxisProps(spec.variants).has(v.prop))`.
This keeps non-state booleans (`HasIcon`, `FullWidth`) as variant axes and drops
the stale "Modifiers" line entirely.

### 2. Preview matrix (deterministic, always renders)

Generalize the States grid so both sections share it:

- **`statesSection.ts`**: rename `buildStatesSection` → `buildMatrixSection`,
  taking a block with `columns: string[]` (header labels), `rows: { label; cells }[]`,
  `capped: boolean`, and optional `note?: string` (rendered as the muted line
  where the "Showing the first 4…" note currently is; used for held-axis notes
  and the cap note). Keep behavior identical for States.
- **`docFrame.ts`**: handle a new `variantsMatrix` block kind by calling
  `buildMatrixSection` (same call as the states branch).
- **`docModel.ts`**: the `variants` case emits a `variantsMatrix` block:

  ```ts
  | { id: SectionId; heading: string; kind: 'variantsMatrix';
      summary: string | null;                 // AI orientation, or null
      columns: string[];                       // second-axis values, or [''] for 1-axis
      rows: { label: string; cells: (string | null)[] }[];
      capped: boolean;
      note: string | null; }                   // held-axis note, or null
  ```

Axis handling in the `variants` case (let `axes` = the non-state axes above):
- **0 axes**: return a `bullets` block with a single `No variants.` item (section
  stays user-selectable).
- **1 axis** (`A`): `columns = A.values`; `rows = [{ label: spec.name, cells:
  A.values.map(v => findCell({ [A.prop]: v })) }]`. `capped=false`, `note=null`.
- **2 axes** (`A`, `B`, declaration order): `columns = B.values`; row per
  `A.values` (default-first, cap 4); `cells = B.values.map(bv => findCell({
  [A.prop]: av, [B.prop]: bv }))`. `capped` = `A.values.length > 4`.
- **3+ axes**: grid on the first two (`A`, `B`) as above; hold the rest at their
  defaults inside `findCell`; `note` = `Others held at default: shape=Rounded, …`
  listing each held axis and its default value.

`findCell(overrides)` resolves the instance matching
`{ ...defaultAxisValues(spec), ...overrides }` (so state axes / flags and any
extra axes sit at their defaults — previews are the resting state); loose
fallback matches the `overrides` entries only. Returns the instance `nodeId` or
`null`. Mirror the existing States `findCell`/default-first/cap logic.

No "(default)" markers anywhere.

### 3. AI summary line (gated, no fallback)

- **`prose/prompt.ts`**: add optional `variantsSummary?: string` to `ProseDrafts`.
  - `PROSE_SYSTEM_PROMPT`: add a line describing the new section: a 1–2 sentence
    orientation to the component's variant options (what varies, the gist), that
    does NOT repeat Definition's "when to use which" guidance.
  - `buildProsePrompt`: add `variantsSummary` to the requested JSON keys with
    that scoping instruction. Keep the em-dash / short-sentence rules.
  - `FEW_SHOT_RESPONSE`: add a `variantsSummary` value (1–2 sentences, house voice).
  - `parseProseResponse`: parse `variantsSummary` as optional prose text
    (`asProseText` with `joinParagraphs`); when absent or non-string, set to
    `undefined` (NOT fatal — unlike the required fields), then `normalizeProseText`
    if present. Include it in the heading-guard scan when present.
- **`docModel.ts`** `variants` case: `summary = prose?.variantsSummary ?? null`.
  Render the summary paragraph above the matrix in the frame builder only when
  non-null. Because prose exists only when AI ran, AI-off yields `summary: null`
  → matrix only. No extra branching.
- **`docModel.ts`** `ALL_SECTIONS`: set `variants` to `ai: true` so the checklist
  shows the AI badge. The matrix still renders without AI (only the summary is
  gated).

### Frame rendering of the summary

`buildMatrixSection` renders an optional leading `summary` paragraph (body text,
full width) above the grid when the block carries one. `variantsMatrix` passes
`block.summary`; `statesMatrix` passes none (States has no summary).

## Out of scope

- The States section's own behavior (unchanged).
- The `.md` renderer (`extractor/src/render.ts`) — separate path, no matrix for
  either section; unchanged.
- Any non-variants prose behavior.
- Combination columns beyond first-two-axes grids.

## Tests

**Extractor:**
- `stateAxisProps`: enum axis → `{State}`; flags → `{Hover, Disabled}`; no state
  → empty set.
- `parseProseResponse`: accepts a payload WITH `variantsSummary` (populates it);
  accepts a payload WITHOUT it (field `undefined`, still valid); array-of-lines
  coerces via `joinParagraphs`.

**Plugin (docModel):**
- 2 axes (`type` × `size`, no state): `variantsMatrix` with `columns` = size
  values, one row per type, a nodeId per cell.
- 1 axis: single row labeled with component name, one cell per value.
- 3+ axes: grid on first two + `note` naming the held axis/default.
- State-flag component (`Hover`/`Disabled` + `size`): Variants matrix contains
  only `size` (flags excluded); States still owns the flags.
- Summary: `prose.variantsSummary` present → `summary` set; prose null →
  `summary` null.
- 0 non-state axes → `bullets` block "No variants."
