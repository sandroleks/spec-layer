# Component frame quality, round 1

**Date:** 2026-09-06
**Status:** Approved design, implementation plan pending. Ships in the same plugin release as `2026-09-06-patterns-and-nested-components-design.md`, which shares the extractor version bump.
**Reads with:** `docs/plugin-knowledge-map.md`, `docs/reviews/2026-09-05-major-review.md` (E3 to E6, S6, U3), `packages/plugin/TESTING.md`.

## 1. Why

The September 5 review left three extraction findings and one speed finding open, and a section-by-section look at the component document showed the Specifications group grew one section at a time: Configuration lists properties with no link to the parts they drive, and the Anatomy legend repeats token names that Tokens used already carries per variant. Nobody has measured where a create spends its time in Figma, so speed work has no data.

This spec is the first of a set. It fixes what can be fixed without Figma, and produces the two inputs the later specs need: timing numbers (spec B, create speed) and a list of canvas defects (spec C, canvas fixes). The patterns spec (`2026-09-06-patterns-and-nested-components-design.md`) ships alongside it.

Decisions taken during brainstorming and not revisited here:

- The design conformance proposal (`docs/strategy/2026-09-02-design-conformance-pivot.md`) is parked. Frames stay a first-class surface.
- Variants, States and Tokens used keep their current shape.
- No new extracted facts this round: sizing behavior, strokes, text metrics, effects and non-default raw values stay out.
- Anatomy depth stays at three below the wrappers.

## 2. Scope

In scope:

1. The Configuration section becomes Properties, covering every component property with the anatomy parts each one affects.
2. The Anatomy legend drops its token list and gains a "Controlled by" line.
3. Two extractor defects are pinned by synthetic fixtures and fixed: the asymmetric radius gap check and single-wrapper-only anatomy descent. Nested-instance attribution moved to the patterns spec.
4. `EXTRACTOR_VERSION` goes from `'2'` to `'3'`, and the canvas hash switches to code-unit key ordering in the same change.
5. A debug build with per-phase timings, and a manual canvas checklist to run once in Figma.

Out of scope, deliberately: any speed optimization, any fix to canvas layout or measurement label placement, carrying the new `affects` data into the Component Context v5 artifact, CLI, proxy, or landing changes.

## 3. Extraction: component property references

### 3.1 Serializer

`packages/plugin/src/serialize.ts` reads `node.componentPropertyReferences` for every node inside the component set and writes it to a new optional field on `SerializedNode`:

```ts
/** Which component properties drive this node, as Figma states them.
 *  Keys are the node property driven; values are raw property names. */
propertyRefs?: { visible?: string; characters?: string; mainComponent?: string };
```

The field is omitted when Figma returns `null` or an empty object. Raw property names are stored as Figma gives them, including the `#id` suffix on non-variant properties; the extractor cleans them with the existing `cleanPropName`, the same function `extractProps` uses, so both sides agree.

This is a synchronous property, so it adds no round trips.

A second, smaller change fixes a defect the section review surfaced: for an instance-swap property, Figma's `defaultValue` is a component id, and the Configuration table renders that id verbatim today. The serializer resolves it with one `getNodeByIdAsync` per instance-swap property and stores the component's name in a new optional `defaultLabel` on `PropertyDefinition`. When the lookup fails or the node is not a component, `defaultLabel` is omitted and the table shows a dash. The raw id is kept in `defaultValue` unchanged, so nothing that reads it today moves.

### 3.2 Extractor

`ComponentProp` gains one optional field:

```ts
export interface ComponentProp {
  name: string;
  kind: PropKind;
  options?: string[];
  default?: string | boolean;
  /** Instance-swap only: the default component's name, when the serializer
   *  could resolve it. The table renders this, never the raw id in `default`. */
  defaultLabel?: string;
  /** Cleaned anatomy part names this property drives, sorted by code units.
   *  Absent when no node references the property. Never inferred from names. */
  affects?: string[];
}
```

`extractProps` fills it by walking the default variant, the same variant anatomy and raw values read, with the same walker the anatomy and token passes use, collecting for each referenced property the cleaned name of the referencing node. A referencing node that is an anatomy part uses the part's cleaned name. A referencing node that is not an anatomy part, because it sits below the depth cap or inside a nested instance, still contributes its own cleaned layer name, so the link is reported rather than dropped. Duplicates collapse. Ordering uses `compareCodeUnits`. Variant axes never get `affects`.

A second helper, `propertiesByPart(props)`, inverts the map for the Anatomy legend so the two sections are derived from one source.

### 3.3 Hash and version

`props` is already inside the canvas hash projection in `packages/extractor/src/hash.ts`, so `affects` enters `specContentHash` automatically. A change in what a property controls is a real change to the component, so this is correct.

Because extraction output changes for unchanged source, `EXTRACTOR_VERSION` becomes `'3'`. Every existing document reads "Rebuild needed" on its next Library check. That is the documented behavior and the copy already exists.

The same change replaces the single `localeCompare` in `hash.ts` canonicalization with `compareCodeUnits`, imported from `v5/diagnostics.ts` where `v5/canonical.ts` already takes it (review finding E6). The rebuild request already asks users to regenerate, so the ordering switch costs nothing extra. `foundationContentHash` uses the same canonicalizer and is covered by the same bump. `semanticContentHash` and the v5 schema are untouched.

## 4. The Properties section

### 4.1 Identity

Section id stays `configuration`. Only the label changes, to "Properties". `DocLinkData.config.sections` stores ids and `parseDocLink` filters them through `KNOWN_SECTION_IDS`, so renaming the id would silently remove the section from every existing document on Update. The stored-config compatibility test in `docLink` pins this.

### 4.2 Content

One table. Rows, in order:

1. Variant axes, in declaration order.
2. Boolean, text and instance-swap properties, in declaration order.

Columns: Name, Kind, Options, Default, Affects.

| Kind | Options | Default | Affects |
|---|---|---|---|
| variant | the axis values, joined with a middle dot | the default variant's value for that axis | a dash |
| boolean | `true / false` | the stated default | parts whose `visible` the property drives |
| text | a dash | the stated default text | text parts whose `characters` it fills |
| instanceSwap | a dash (Figma states preferred values as component keys, and resolving them to names needs a network import, so this round omits them) | the resolved `defaultLabel` when present, else a dash; never the raw id | parts whose `mainComponent` it swaps |

Affects joins the `affects` names with a middle dot. When `affects` is absent the cell is a dash. Nothing is inferred; a dash means Figma states no reference.

### 4.3 Empty state

When the component has no variant axes and no properties, the section renders one line of body text, "No properties", in place of the table. The current code renders an empty table with headers.

### 4.4 Model and renderer

`docModel.ts` `case 'configuration'` builds the rows from `spec.variants` and `spec.props`. The block stays `kind: 'table'`, so `docFrame.ts` needs no new renderer for the section; the empty state uses the existing `kind: 'bullets'` path with a single plain item, matching how Related renders "None."

## 5. The Anatomy legend

Each legend entry keeps: number, cleaned name, type, and description. Removed: the per-part token list. Added: a final muted line, "Controlled by: " followed by the property names from `propertiesByPart`, joined with a middle dot, sorted by code units. The line is omitted when nothing references the part.

`AnatomyPartBlock.tokens` is removed from the model and the renderer. `AnatomyPartBlock` gains `controlledBy?: string[]`. The AI orientation paragraph, the diagram, the numbered callouts and the `'table'` and `'both'` views are unchanged.

The anatomy entries in the hash projection are unchanged; the legend reads `controlledBy` from the props side.

## 6. Extractor correctness

Each defect gets a synthetic fixture under `packages/extractor/test/fixtures/` before any fix, written from the code path rather than from a customer file. Each fixture gets a hash-projection golden, which also pins extractor version 3 output.

### 6.1 Radius gap asymmetry

Fixture: a default-variant container with `topRightRadius` bound to a variable and the other three corners hardcoded to the same number.

Today `tokens.ts` skips the radius gap only when `cornerRadius` or `topLeftRadius` is bound, so this node is reported as a hardcoded radius gap. `rawValues.ts` already checks all five radius bindings.

Fix: the gap scan uses the same five-binding set. A partially bound radius is neither a gap nor a raw row. Expected test: no `border-radius` gap for the fixture; the bound corner still yields its token row.

### 6.2 Multi-wrapper anatomy descent

Fixture: a default variant whose only visible child is a frame, whose only visible child is another frame, whose children are the real parts (a text node and an instance).

Today `anatomy.ts` descends exactly one wrapper and lists the second frame as the sole part.

Fix: descend while the current level has exactly one visible child of type FRAME or GROUP, up to three wrappers. Each skipped wrapper still occupies a level in the shared path namespace, exactly as the single-wrapper case does today, so `tokens.ts` and gap paths for nested parts stay identical. The depth cap of three counts from the first non-wrapper level, as it does today. Expected test: the two real parts at depth 0 with paths that match what `tokens.ts` produces for their bindings.

A fourth wrapper is not skipped; the fixture pins that too, so the bound is explicit.

### 6.3 Nested-instance token attribution

Moved to `2026-09-06-patterns-and-nested-components-design.md`. Reading the walker showed the answer without a fixture: the token walk descends into instance internals with no boundary, so a binding inside a nested Button is attributed to the Button's inner layer, a part Anatomy never lists. The fix is the boundary rule that spec defines, and the fixture lives there so it pins both boundary modes.

## 7. Debug timing build

### 7.1 Build target

`packages/plugin/build.mjs` accepts a `--debug-timing` flag, exposed as `npm run build:plugin:debug`. It defines a compile-time constant `__SPEC_LAYER_TIMING__` as `true`; the normal build defines it `false`, so esbuild removes every timing branch from the shipped bundle. `npm run check:sandbox` runs against the normal build as today; the plan adds one step that also builds and scans the debug bundle, so the timing code itself never introduces a browser global.

### 7.2 What is recorded

The main thread uses `Date.now()`; the Figma sandbox has no `performance` global. One create records, in order:

| Phase | Boundary |
|---|---|
| `serialize` | `serializeNode` of the selection, in the selection handler |
| `awaitRender` | from the `selection` reply to the `renderDocFrame` request, which covers the prose call |
| `fonts` | the font loading pass at the top of `buildDocFrames` |
| `section:<id>` | each `buildSection` call, keyed by section id |
| `group:<id>` | each `buildGroupFrame` excluding its sections |
| `append` | page append and final positioning |

Alongside each phase it counts Figma async calls by wrapping the resolver, `getNodeByIdAsync`, and the token resolution helpers in `tokenResolve.ts`, and counts instances created. The result is one JSON line per create in the plugin console, and the same object posted to the UI as a `timingSummary` message, which the UI shows in a copyable block under the success toast only when the message arrives. The UI has no other knowledge of the flag.

## 8. Canvas checklist

New file `docs/manual-tests/2026-09-06-component-frame-quality.md`, run once against the debug build. It asks for three component shapes, built in a synthetic file or taken from any file whose output can be shared:

1. A button with one enum axis and a state axis.
2. A component with three or more axes, so the held-axis note and row cap trigger.
3. A slot-heavy card with nested instances two levels deep.

For each: the timing summary, a screenshot of the three group frames, and answers to a fixed list of checks.

Layout checks: tables that overflow or clip the token column, uneven card heights in Tokens used, group frames taller than the page viewport at 100%, preview scaling in the Variants and States grids, Properties table width with a long Affects cell, legend line wrapping after the token list is removed.

Measurement checks: labels that overlap each other or the instance, labels pointing at the wrong edge, lenses that render nothing useful for the component, padding labels on a component with no padding, raw values shown where a token exists.

Also: an existing document shows "Rebuild needed" after the version bump, and Update rebuilds it with the Properties section in place of Configuration.

Findings go in a defects section at the bottom of the file. Defects are the input to spec C. Timings are the input to spec B.

## 9. Testing

Unit tests, all in Vitest:

- The two fixtures from section 6 with hash-projection goldens.
- `extractProps` fills `affects` from `propertyRefs`, cleans the `#id` suffix, collapses duplicates, sorts by code units, never sets it on variant axes, and reports a below-cap referencing node by its own name.
- `extractProps` surfaces `defaultLabel` for instance-swap properties and never exposes the raw id as the rendered default.
- `propertiesByPart` inverts correctly.
- `docModel` Properties block: row order, per-kind Options and Default cells, Affects joining and the dash, the empty state.
- `docModel` Anatomy block: no `tokens`, `controlledBy` present and absent.
- `hash.ts`: `affects` moves `specContentHash`; `canonical()` output equals a code-unit sort of keys on every golden; a fixture with axis names that sort differently under a non-English collation hashes identically regardless of locale.
- `docLink`: a stored config naming `configuration` still round-trips.
- `EXTRACTOR_VERSION` is `'3'` and the version-mismatch path reads "Rebuild needed".

Gates: `npm run check`, plus the debug bundle built and passed through the sandbox scan.

Manual: `packages/plugin/TESTING.md` gains rows for the Properties section (all four kinds, the variant-axis dash, the empty state), the trimmed legend with Controlled by, and the "Rebuild needed" path. The checklist in section 8 is separate and runs once.

## 10. Documentation

- `CHANGELOG.md`: Properties section, legend change, the two extractor fixes, the version bump and hash ordering switch, the debug build.
- `docs/plugin-knowledge-map.md`, canvas rendering: Properties and the shared property reference source.
- `docs/reviews/2026-09-05-major-review.md`: E5 and E6 marked addressed with the date; S6 marked addressed by the debug build.
- `CLAUDE.md`: `EXTRACTOR_VERSION` is `'3'`; the `localeCompare` invariant now covers `hash.ts` as well as `src/v5`.

## 11. Follow-ups this spec creates

- Spec B, create speed, from the timing summaries.
- Spec C, canvas fixes, from the checklist defects.
- Carrying `affects` into Component Context v5 as an optional field, a schema minor bump, when the v5 grading work resumes.
