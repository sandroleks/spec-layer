# Usage prose rebalance — Definition vs Variants

**Date:** 2026-07-09
**Branch:** plugin-2.0
**Status:** Approved (design), pending implementation plan

## Problem

In the generated **Usage** frame, three surfaces tell the same story:

- **Header subtitle** — the whole opening Definition paragraph, which the prompt
  packs with "what it is, when to use it, the key constraint," so it already
  enumerates every type (Primary/Outline/Ghost) and mentions icons + loading.
- **Definition body** — a bulleted "when to use each type" guide (Primary /
  Outline / Ghost), duplicating what the header just said.
- **Variants summary** — re-describes the same types by visual weight ("Primary
  is solid, Outline has a border, Ghost is minimal").

The reader sees the type rundown three times and each section adds little beyond
the others.

## Decision: one job per surface

| Surface | Owns | Must NOT contain |
|---|---|---|
| **Header subtitle** | *What it is* — one sentence | type enumeration, icon/loading detail |
| **Definition** | *What it is* (fuller) + key constraint / core behavior | per-type content, "when to use which" |
| **Variants** | *What varies* (type, size, states, icons) **+ the type decision guide** (which type, when) | restating the plain definition |

So: **header = what it is · Definition = what it is + constraints · Variants =
types + what's adjustable.** The "when to use which type" decision guide moves
out of Definition and becomes the single responsibility of Variants.

## Changes

### 1. Prose prompt (`packages/extractor/src/prose/prompt.ts`)

- **Definition instruction**: remove the "follow with a bulleted 'when to use
  which' guide" clause. New shape: a short paragraph whose **first sentence** is
  a standalone definition of what the component is, followed by 1-2 sentences on
  its core purpose and key constraint. No per-type enumeration, no "when to use
  which."
- **Variants summary instruction** (becomes the "variants guide"): 1-2 sentence
  orientation to what varies across the options (the axes: type, size, states,
  icon slots), **then** a bulleted "when to use which type" guide, one per line,
  bold type name first (e.g. `- **Primary**: the single most important action.`).
  This is now the only home for type selection.
- Update the few-shot exemplar (`FEW_SHOT_RESPONSE` / prompt text) so its
  `definition` no longer carries a type guide and its `variantsSummary` carries
  the orientation + bulleted type guide.
- Bump `PROSE_PROMPT_VERSION` v5 → v6 in `client.ts` so cached v5 drafts (old
  shape) are never served after this change.

### 2. Header extraction (`packages/plugin/src/docFrame.ts`)

- The header subtitle currently takes the first **line** of the Definition
  (`splitLead`), so a single-paragraph Definition lands entirely in the header.
  Change the lead to the first **sentence** of the Definition: the header shows
  one sentence; the remainder (rest of the paragraph + any following content)
  renders in the Definition body.
- Keep the existing placeholder handling (`_To be written._` stays a body
  section, no subtitle) and the `liftDefinitionLead` fallback behavior.

### 3. Variants rendering (`packages/plugin/src/statesSection.ts` + `docFrame.ts`)

- The variants matrix summary is rendered today as a single flat text node
  (`makeText(block.summary, …)`), which would print literal `- **Primary**:`
  markers. Render it through the bullet-and-bold-aware prose path (`buildProse`)
  instead, so the orientation paragraph and the bulleted type guide render
  correctly above the matrix.
- `buildProse` lives in `docFrame.ts`. Options (decide in the plan): pass a
  prose-rendering callback into `buildMatrixSection`, or render the summary in
  `docFrame.ts` (before calling `buildMatrixSection`) and drop summary rendering
  from `statesSection.ts`. Prefer whichever keeps `statesSection.ts` free of a
  `docFrame` import cycle.
- The **States** matrix also carries a `summary` through the same
  `buildMatrixSection` path, but States summaries are plain sentences (no
  bullets), so they must keep rendering correctly under the new path.

## Non-goals

- No change to the three-frame structure, grouping, or config window.
- No change to Accessibility, Do's & Don'ts, Anatomy, or the matrices themselves.
- No new prose fields; this reshapes `definition` and `variantsSummary` content
  and where the type guide lives, not the `ProseDrafts` schema.

## Testing

- Extractor prose tests: update/extend `packages/extractor/test/prose.test.ts`
  for the reshaped few-shot (definition has no type guide; variantsSummary
  carries the bulleted type guide) and the v6 version bump.
- Plugin tests: header now yields a one-sentence subtitle from a multi-sentence
  definition (unit-test the sentence-split helper); variants summary containing
  bullets renders through the prose path (assert the model/render wiring, at the
  level the existing tests operate).
- Full suite stays green; plugin build succeeds.
- Manual: regenerate a component (e.g. Button) in Figma and confirm header =
  one sentence, Definition = what-it-is + constraints only, Variants = axes
  orientation + bulleted type guide, with no cross-section repetition.

## Risk

Prompt wording is the main lever; the model may still leak a little. Mitigate
with explicit "do not" clauses on both Definition (no type guide) and Variants
(don't restate the plain definition), plus a clear few-shot exemplar showing the
split. The sentence-split for the header must handle abbreviations gracefully
(don't cut "e.g." mid-sentence) — keep it simple and conservative.
