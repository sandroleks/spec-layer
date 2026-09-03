# Preserve hand edits on Update

**Date:** 2026-09-03
**Status:** implemented 2026-09-03
**Scope:** component documentation Sections in the Figma plugin

## Problem

A designer generates a component doc, lets the AI fill the writing sections,
then rewrites some of that text by hand on the canvas. Later the component
changes, or the extractor version moves, and the Library offers an Update.
Update builds a brand new Section from the live component and deletes the
old one. Every hand edit is lost. Update also re-runs the AI, so even the
untouched prose comes back different and the run spends quota.

The Library already tells "Manually edited" apart from "Update available".
The failure is not status. It is that Update treats the whole Section as
derived output when part of it is authored content.

## Decision

A component doc has two lanes.

- **Generated lane.** Tables, token bindings, variant and state matrices,
  measurements, the anatomy diagram and legend structure, headers, chrome.
  Derived from the component. Always rebuilt from the live source.
- **Editorial lane.** The writing sections. Authored, first by the AI or a
  placeholder, then by whoever edits the canvas. The canvas is the source of
  truth for this lane.

Update reads the editorial lane back from the existing Section, rebuilds the
generated lane from the live component, and renders the two together. It
never calls the model.

Only edits to the generated lane can be lost by an Update, so only those
count as "Manually edited" and only those raise the confirm dialog.

## Editorial slots

Each slot maps to one field of `ProseDrafts`.

| Slot | `ProseDrafts` field | Rendered as |
|---|---|---|
| `definitionLead` | first line of `definition` | header subtitle in the Usage frame |
| `definition` | remaining lines of `definition` | prose block |
| `accessibility` | `accessibility` | prose block |
| `interactions` | `interactions` | prose block |
| `contentConsiderations` | `contentConsiderations` | prose block |
| `dos` | `dos` | bullet rows with a check marker |
| `donts` | `donts` | bullet rows with a cross marker |
| `variantsSummary` | `variantsSummary` | prose block above the variants matrix |
| `anatomySummary` | `anatomySummary` | single text node in the anatomy section |
| `anatomyPart` | one entry of `anatomyParts`, keyed by part name | legend row `Name: description` |

`designConsiderations` has a prose key but no section renders it, so it has
no slot. Stored values for it pass through untouched.

## Tagging at render time

`docFrame.ts` tags nodes with pluginData. Tags are invisible, survive
duplicate and copy, and cannot be renamed away in the layers panel.

- **Slot container.** Key `specLayerSlot`, value the slot name. For prose
  slots this is a new vertical auto-layout frame that wraps the nodes
  `buildProse` returns for that slot. For `dos` and `donts` it wraps that
  slot's bullet rows. For `anatomySummary` and `definitionLead` the text node
  itself carries the tag. For `anatomyPart` the legend row carries the tag
  and a second key `specLayerSlotKey` holding the part name.
- **Line kind.** Key `specLayerLine` on each node inside a prose container:
  `paragraph`, `heading`, `bullet`, or `placeholder`.

Wrapping prose in a container is a layout no-op: the container fills the
column and uses the same item spacing as the body it sits in. Wrapping is
what lets a text layer the designer adds inside a section be read back as a
new paragraph, since anything untagged inside a slot container is treated as
a paragraph.

## Reading the canvas back

New Figma-free module `packages/plugin/src/canvasProse.ts`, following the
`docLink.ts` pattern: it operates on a minimal node interface (type,
characters, children, `getPluginData`, `getStyledTextSegments`) so it is
unit-tested with fakes and the main thread passes real nodes.

`readCanvasProse(section) → CanvasProse` where every field of `ProseDrafts`
is optional. A field is absent when its slot is not on the canvas or when
its only content is the untouched placeholder text. Rules:

- Walk the Section in document order, never descending into component
  instances.
- A prose container yields one markdown line per child. `paragraph` and any
  untagged text node give the text with bold segments wrapped in `**`.
  `heading` gives `### text`. `bullet` gives `- text` from the row's content
  node, ignoring the marker node. `placeholder` is skipped when its text
  equals the placeholder copy, and otherwise read as a paragraph, because
  a designer who typed over the placeholder wrote real content.
- `definition` is `definitionLead` followed by the `definition` container's
  lines. Either half may be missing.
- `dos` and `donts` yield one string per bullet row in order. A duplicated
  row adds an item. A deleted row removes one.
- `anatomyPart` yields `{ name: slotKey, description }` where description
  is the text after the first `: `. A row with no `: ` yields nothing. The
  name comes from the tag, not from the row text, so bolding or a typo in
  the name cannot detach the description from its part.
- Bold reconstruction uses `getStyledTextSegments(['fontName'])` and wraps
  segments whose style is Bold. Other styling is dropped.

`mergeProse(stored: ProseDrafts | null, canvas: CanvasProse) → ProseDrafts | null`:
canvas wins per field, stored fills the rest, and the result is null when
the merged prose carries no content at all (no non-blank string, no non-empty
list), so a doc that never had guidelines still reports none. Sections the
config does not render keep their stored text this way, so unchecking
Interactions and updating does not erase the AI's interactions prose.

`docModel.ts` treats an empty string as absent (renders the placeholder) and
renders the placeholder when both `dos` and `donts` are empty, so a merged
prose object with blank required fields renders honestly.

## Lane-aware self hash

`collectText` in `main.ts` becomes lane-aware: text under any slot-tagged
node is editorial, everything else is generated. `selfHash` is computed over
the generated lane only. Docs written before tagging carry no tags, so their
recomputed hash covers all text, exactly as their stored hash did. No
existing doc changes status because of this.

`selfEdited` therefore means "generated content was edited by hand and
Update will replace it". Editorial edits are silent and read as "In sync".

The confirm copy changes to say what is actually at stake:

> You edited generated content in this frame by hand. Updating replaces
> those edits. Your text in the writing sections is kept.

Batch form:

> N selected documents have hand edits to generated content. Updating
> replaces those edits. Text in the writing sections is kept.

## Update flow

1. UI sends `requestDocSource` as today.
2. Main thread serializes the source, reads `DOC_PROSE_KEY`, reads the
   canvas, merges, and adds `prose: ProseDrafts | null` to the `docSource`
   reply.
3. `updateFromSource` builds the model from `src.prose`. The AI branch is
   removed. It no longer needs a license, a user id, or quota.
4. `renderDocFrame` carries that prose, and the main thread stores it in
   `DOC_PROSE_KEY` as it does today. Stored prose is therefore resynced to
   the canvas on every Update.

Rebuild needed, Update available, and Update all go through the same path
and all preserve editorial text.

## Copy for AI and Publish

`requestDocProse` and `requestPublishSources` return the merged prose
instead of the stored blob. A designer's canvas edits reach the coding
agent's brief and the published library. An old untagged doc merges to its
stored prose, unchanged from today.

## Out of scope

- **Create over an existing doc.** Creating documentation again from the
  component screen still replaces the Section and runs the AI fresh. That is
  the one deliberate way to get new AI prose. It does not warn about hand
  edits today; adding a warning needs a new main-to-UI round trip and is a
  follow-up.
- **Foundation docs.** Group descriptions edited on canvas are still lost on
  a foundation Update. The same tagging approach applies and is a follow-up.
- **Structural edits.** Added frames, images, moved or deleted generated
  blocks. Not preserved, by agreement.
- **Non-bold text styling** inside editorial text. Dropped on read-back.

## Testing

- `canvasProse.test.ts`: round trip for every slot through fakes, including
  bold runs, subheadings, bullets, placeholder skipped, placeholder edited
  into content, duplicated bullet row, deleted bullet row, untagged added
  text node, anatomy part with and without a description, definition with
  lead only, body only, and both. `mergeProse` precedence and null result.
- `docFrame` round trip with the fake Figma: build from a `ProseDrafts`,
  read back, expect equality for every slot present in the model. This is
  the lossless-cycle guard.
- Lane-aware `collectText`: editorial edits leave the hash unchanged,
  generated edits move it, an untagged legacy Section hashes all text.
- `updateFromSource`: never calls the AI, uses `src.prose`.
- Library view model: unchanged, since `selfEdited` semantics move in the
  main thread.
- Manual matrix in `packages/plugin/TESTING.md`: row 5 rewritten to cover
  an editorial edit surviving Update with "In sync", and a generated-lane
  edit showing "Manually edited" with the new confirm copy.

## Documentation to update

`CHANGELOG.md`, `docs/plugin-knowledge-map.md` (drift and update section),
`packages/plugin/TESTING.md`, and the backlog entry 4.2, which this
supersedes with a narrower design.
