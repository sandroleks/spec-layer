# Grouped sections → three output frames

**Date:** 2026-07-08
**Branch:** plugin-2.0
**Status:** Approved (design), pending implementation plan

## Summary

Reorganize the plugin's ten flat doc sections into three groups — **Usage**,
**Specifications**, **Accessibility** — and make that grouping govern **both**
surfaces:

1. **Output:** the generator emits **three separate Figma frames** (one per
   group), wrapped in a single Figma **Section** named after the component.
   Today it emits one long frame.
2. **Config window:** the ten-checkbox list becomes three **collapsible groups**,
   each with a tri-state master checkbox and a live count.

A single grouping map is the source of truth for both surfaces, so the config
window and the output always agree.

## Motivation

The ten-section frame is undifferentiated and mixes content for three different
audiences on one scroll: designers/PMs (usage), engineers (specs), and a11y/QA.
Splitting into three named, self-contained frames lets each reader grab the one
frame they need, screenshot it, and drop it in a ticket. The Section wrapper
keeps them together so "the Button doc" is still one thing on the canvas.

Grouping the config window is the mirror change: 10 flat checkboxes are hard to
scan, and a per-group master checkbox lets the user steer a whole frame with one
click.

## The grouping map

Three groups, fixed order. Mapping of the existing ten sections:

| Group | id | Sections (existing `SectionId`s, in order) |
|---|---|---|
| **Usage** | `usage` | `definition` · `variants` · `dosDonts` · `related` |
| **Specifications** | `specs` | `anatomy` · `measurements` · `configuration` · `states` · `tokens` |
| **Accessibility** | `a11y` | `accessibility` |

Notes:
- Group order in both surfaces: Usage → Specifications → Accessibility.
- Section order **within** a group matches the table above (which is the current
  `ALL_SECTIONS` order, re-partitioned — no section moves relative to its group
  peers).
- The Accessibility group intentionally has a single member for now. Splitting
  it into real subsections (Interactions / Design / Dev / Content considerations,
  à la Salesforce) is **out of scope** — a later change.

## Non-goals (this change)

- Splitting the Accessibility group into subsections (later).
- Group descriptions / audience hints in the config headers (explicitly dropped).
- Changing any section's **internal** rendering (anatomy, measure, matrices,
  token tables render exactly as today).
- Grouping the Markdown export / textarea preview. `renderSpec` in the extractor
  stays flat for now, consistent with the prior "variantsSummary is Figma-only"
  scope decision. Optional fast-follow.
- New AI calls or new component instancing.

## Design

### 1. Shared grouping map (source of truth)

In `packages/plugin/src/ui/docModel.ts`:

- Add a `GroupId = 'usage' | 'specs' | 'a11y'` type.
- Add `group: GroupId` to every entry in `ALL_SECTIONS`.
- Add an ordered `GROUPS: { id: GroupId; label: string }[]` constant
  (`Usage` / `Specifications` / `Accessibility`).

Both the config window and the output builder derive their structure from these
two constants. Changing the map updates both surfaces.

### 2. Doc model becomes grouped

`buildDocModel()` currently returns `{ title, sections: SectionBlock[] }`. New
shape:

```ts
interface DocGroupModel { id: GroupId; label: string; sections: SectionBlock[] }
interface DocFrameModel {
  componentName: string;          // e.g. "Button"
  groups: DocGroupModel[];        // only groups with ≥1 selected section
}
```

- `buildDocModel` partitions the selected `SectionBlock[]` by each section's
  `group`, preserving group order and within-group order.
- A group with zero selected sections is **omitted** from `groups` (drives
  empty-frame skipping downstream — see §4).
- The `definition`-lead-as-subtitle logic moves into the Usage frame's header
  (see §3); the model itself no longer special-cases title/subtitle.

### 3. Output: three frames in a Section

Refactor `docFrame.ts`:

- Extract the current per-frame body (header band + content vstack of sections)
  into `buildGroupFrame(group: DocGroupModel, ctx, opts): Promise<FrameNode>`.
  `ctx` carries the already-loaded fonts/palette/width so the one-time setup runs
  once, not per frame.
- New top-level `buildDocFrames(model, theme, logo): Promise<SectionNode>`:
  1. One-time setup (unchanged): `resetTokenResolveCaches()`, palette from theme,
     font loading, and `fitFrameWidthToTokens` computed **across all groups'
     sections** so all three frames share one `CARD_WIDTH` (visual alignment).
  2. Build one `FrameNode` per group via `buildGroupFrame`.
  3. Create a `figma.createSection()`, name it after the component, append the
     frames, and lay them out **side by side** with a consistent gap.
  4. Return the `SectionNode`.
- **Frame headers:**
  - Every frame header shows `${componentName}` + the group label
    (e.g. "Button — Specifications") so a stray frame is self-explanatory.
  - The **Usage** frame additionally carries the definition-lead subtitle and the
    component **preview** instance. Specs and A11y headers are **text-only** (no
    preview) — avoids extra instancing cost (the one "don't repeat expensive
    work" rule from the sizing discussion).
- **Empty-group skipping:** `model.groups` already excludes empty groups (§2), so
  the builder simply iterates what it's given. If exactly one group is present,
  it is still wrapped in a Section (consistent re-find + "one thing" grouping).

### 4. main.ts placement + re-find

`renderDocFrame` handler in `main.ts` currently searches top-level children for a
`FRAME` whose name matches `model.title`, reuses its position, else places right
of the source component.

Changes:
- Search top-level children for a **`SECTION`** whose name matches the component
  (same defensive per-child `try/catch` for unresolvable node types).
- Reuse the section's position if found; else place right of the source component
  (existing `x + width + 80` logic).
- `buildDocFrames` returns a `SectionNode`; append it, position it, select + zoom.
- Section-internal instances still get `matchVariableModes()` exactly as today
  (unchanged — the past offset/overhang bug class is not reopened).

### 5. Config window: three collapsible groups

`packages/plugin/src/ui/dom.ts` (markup + styles) and `ui.ts` (behavior):

- **Markup:** wrap the section rows in three group containers, each with a header
  row: master checkbox + collapse chevron + group label + count badge
  (`n/total`). No group descriptions.
- **Reparented disclosures:** the Anatomy view toggle and Measure lens row still
  nest under their own section row (the existing
  `sectionChecks['anatomy'].closest('.sec-group').appendChild(...)` pattern works
  unchanged once the row lives inside a group body).
- **Behavior (`ui.ts`):**
  - Group master checkbox is **tri-state**: checked when all group sections on,
    `indeterminate` when partial, unchecked when none. Toggling it sets all
    sections in that group.
  - A child change recomputes its group's master state + count.
  - Chevron collapses/expands the group body; collapsing never changes selection.
  - Existing top-level **Select all / Clear** operate across all groups.
  - **AI-dim** still toggles on the whole list (unchanged).
- **Selection state (`state.ts`):** stays a flat `Record<SectionId, boolean>`.
  Grouping is presentational + drives which frames are emitted. No state reshape.
- **Generate button:** disabled when total selected is 0 (as today); its count
  reflects total sections. Optionally also surface frame count.

## Risk

The one genuinely new code path is **frame layout inside the Section** (§3.3) —
positioning three frames with a consistent gap. Per project history, the nastiest
past `docFrame`/`measureSection` bugs were layout offset/overhang from variable-
mode drift and shared layout constants. This change adds a layout *layer above*
the sections; section-internal rendering is untouched, so the fix (`matchVariableModes`
after each `createInstance`) still holds. New risk is confined to inter-frame
positioning and the Section wrapper, which manual Figma verification must cover.

## Testing

- Unit: `buildDocModel` partitioning (group order, within-group order, empty-group
  omission). Grouping map completeness (every `SectionId` has a `group`).
- Existing tests that assert the old `DocFrameModel` shape (`{ title, sections }`)
  must be updated to the grouped shape.
- Manual Figma matrix (required before release): three-frame output positioning,
  Section naming + re-find/replace on regenerate, empty-group skipping (clear all
  of one group → that frame absent), single-group case, preview appears only in
  Usage, themed + default builds, variable-mode fidelity across frames.

## Open questions

- Frame layout orientation: **side-by-side** (assumed) vs stacked. Side-by-side
  matches the "tabs" mental model; confirm during implementation against canvas
  ergonomics.
- Section name: `${componentName}` alone vs `${componentName} — Guidelines`.
  Leaning to the bare component name for the Section, group label in each frame.
