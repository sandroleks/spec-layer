# Boolean-per-state matrix detection — design

**Date:** 2026-07-08
**Branch:** plugin-2.0
**Scope:** `packages/extractor/src/statesMatrix.ts`, `packages/plugin/src/ui/docModel.ts` (states case), tests in both packages.

## Problem

The States matrix only renders when a component encodes states as a single
enum variant axis (named `State`/`Status`, or an axis whose values are ≥2
state-vocabulary words). Many design systems instead encode each state as its
own boolean variant axis — `Hover: True/False`, `Focused: True/False`,
`Disabled: True/False`. Today `detectStateMatrix` returns `null` for those, so
the States section silently doesn't render, and (after the panel restructure)
the States checkbox is disabled with "· none detected".

## Scope clarification (Figma booleans)

Two distinct Figma concepts:
- **Boolean *variant axes*** — a variant property with values `True`/`False`.
  These ARE in `spec.variants` and `spec.variantInstances` (one instance per
  combo), so each state has a previewable node. `isModifierAxis` currently
  routes them into the Tokens "When X = true" sub-tables. **In scope.**
- **Boolean *component properties*** (Figma `BOOLEAN` prop kind) — toggle a
  layer on/off; never enter `spec.variants`/`variantInstances`, so no separate
  node to preview. **Out of scope — genuinely unbuildable as a matrix.**

This spec handles boolean *variant axes* only.

## Design

### 1. Normalize both encodings to "state columns" (statesMatrix.ts)

Replace the enum-specific `StateMatrixInfo` with a column model both encodings
share:

```ts
export interface StateColumn {
  /** Column header: enum state value, or the flag's prop name. */
  label: string;
  /** Axis→value overrides applied on top of the default variant to reach
   *  this column. Empty for the synthesized flags "Default" column. */
  override: Record<string, string>;
}

export interface StateMatrixInfo {
  encoding: 'enum' | 'flags';
  /** Ordered; the default/base column is first. */
  columns: StateColumn[];
  /** First non-state, non-modifier axis, used as the matrix's row axis. */
  rowAxis: string | null;
  /** Enum: the state-axis prop name. Flags: null. */
  axis: string | null;
}
```

### 2. Detection (`detectStateMatrix`)

Enum-first, then flags:

1. **Enum** (existing behavior): if an axis satisfies `isStateLike`, build
   `columns = orderStates(stateAxis.values).map(v => ({ label: v, override: { [stateAxis.prop]: v } }))`,
   `encoding: 'enum'`, `axis: stateAxis.prop`.
2. **Flags** (new): otherwise, collect **state-flag axes** =
   `variants.filter(v => isModifierAxis(v) && isStateVocabName(v.prop))`.
   - If empty → `return null` (preserves today's behavior for pure-modifier /
     stateless components).
   - Else: order flags by `STATE_ORDER` on prop name (reuse the ranking in
     `orderStates`), and build
     `columns = [{ label: 'Default', override: {} }, ...ordered.map(f => ({ label: f.prop, override: { [f.prop]: trueValueOf(f) } }))]`,
     `encoding: 'flags'`, `axis: null`.
   - `trueValueOf(axis)` = the axis value equal to `"true"` case-insensitively
     (fall back to the value that is NOT the default variant's value for that
     axis, then to `axis.values[1] ?? axis.values[0]`).
3. `rowAxis` (both encodings): first axis that is not a state-flag, not a
   modifier (`!isModifierAxis`), and not `isStateLike`. For enum also exclude
   `stateAxis.prop`. (State-flags are modifiers, so already excluded.)

New helper `isStateVocabName(prop: string): boolean` — `true` when the trimmed,
lowercased prop name is in `STATE_VOCAB` OR `isStateAxisName(prop)` OR
`prop.toLowerCase() === 'status'`. Export it from statesMatrix.ts.

**Precedence:** if an enum state axis exists, enum wins; any boolean flags stay
modifiers (unchanged Tokens output).

### 3. Token deltas (`stateTokenDeltas`) — generalize to columns

Signature changes to take the column model. For each column, resolve
`{ ...defaults, ...column.override }`; the base is the default variant
(`defaults`). Skip the column whose resolved config deep-equals `defaults`
(the default/base column — enum's default value or flags' synthesized
"Default"). For the rest, `changes` = resolved tokens not present in the base
resolution (same keying as today: `part\0property\0token`). Return
`{ label, changes }[]` (renamed from `state` → `label` to fit both encodings;
update the docModel consumer).

```ts
export interface StateDelta { label: string; changes: ResolvedToken[] }

export function stateTokenDeltas(
  tokens: TokenRule[],
  defaults: Record<string, string>,
  info: StateMatrixInfo,
): StateDelta[]
```

### 4. docModel `states` case (docModel.ts:346)

Consume the column model:
- `rowAxisValues` / `capped` / `rowValues`: unchanged (from `info.rowAxis`,
  default-first, cap 4).
- `findCell(rowValue, column)`: want = `{ ...defaults, ...column.override }`
  plus `{ [info.rowAxis]: rowValue }` when `rowAxis` and `rowValue` are set.
  Exact match on all `want` entries; loose fallback = match `column.override`
  entries + rowValue only.
- `rows = rowValues.map(rv => ({ label: rv ?? spec.name, cells: info.columns.map(c => findCell(rv, c)) }))`.
- `deltas = stateTokenDeltas(...).map(d => ({ state: d.label, lines: d.changes.map(c => \`${c.part} ${c.property}: ${c.token}\`).join(' · ') }))`.
- Returned block: `states: info.columns.map(c => c.label)`,
  `axisName: info.axis ?? ''`. (The frame builder only uses `axisName` for the
  single-row corner label; `''` renders an empty corner, which is correct when
  there's no single state axis.)

### 5. UI

No change. `render.ts` `renderStatesHint` and the availability gate already call
`detectStateMatrix(spec.variants)` and branch on null/non-null; flag components
now return non-null, so the checkbox auto-enables for them.

`statesSection.ts` (Figma frame builder): **unchanged** — it consumes
`StatesBlockData` (`axisName`, `states[]`, `rows`, `deltas`), whose shape is
preserved.

## Out of scope

- Boolean *component properties* (no previewable instances).
- `.md` download parity — that renderer (`extractor/src/render.ts`) builds no
  states matrix for either encoding today; unchanged here.
- Removing promoted flags from the Tokens modifier sub-tables (decided: States
  is additive, Tokens stays complete and independently exportable).
- Multi-flag combination columns (only Default + each-single-flag-on).

## Tests

**`packages/extractor/test/` (statesMatrix):**
- Flags-only: axes `Hover{True,False}`, `Disabled{True,False}`, `Size{S,L}` →
  `encoding:'flags'`, columns `[Default, Hover, Disabled]` (STATE_ORDER),
  `rowAxis:'Size'`, `axis:null`.
- Non-state boolean: `HasIcon{True,False}` only → `null` (no matrix).
- Mixed: enum `State{Default,Hover}` + boolean `Disabled{True,False}` →
  `encoding:'enum'`, `Disabled` NOT a column.
- Existing enum cases stay green.
- `stateTokenDeltas` flags case: a token conditioned on `Disabled=True`
  surfaces as a `Disabled` delta; Default column produces none.

**`packages/plugin/test/` (docModel):**
- Flags spec with per-flag token differences → `statesMatrix` block with the
  right column labels, one cell per (row × column), and delta lines.
- `findCell` resolves the correct instance nodeId for a flag-on column.
