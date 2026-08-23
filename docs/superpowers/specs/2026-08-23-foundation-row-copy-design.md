# Copy for AI on foundation rows

**Date:** 2026-08-23
**Status:** Proposed
**Packages:** `packages/extractor`, `packages/plugin`
**Builds on:** `2026-08-18-copy-for-ai-v2-design.md`

## Summary

Foundation documents in My Library get the same "Copy for AI" dropdown entry
that component documents already have. Clicking it copies a YAML foundation
brief narrowed to that row's collection.

No new format, no new generated content, no change to the Foundations screen.
This is a surface that exists for components and does not exist for
foundations, plus the narrowing needed to make a row-scoped copy honest.

## Problem

Foundations can already be copied, but only from one place: the "Copy for AI"
button in the Foundations screen footer (`screens/foundations.ts:188`), which
calls `copyFoundationBrief` and always copies the whole file.

My Library lists foundation documents as rows alongside component documents.
Every component row's dropdown offers "Copy for AI" (`screens/library.ts:167`).
No foundation row does, because the capability is gated on a component-shaped
condition:

```ts
canCopy: componentSourceAvailable && status !== 'unavailable',
```

`componentSourceAvailable` requires `entry.kind === 'component'` and a non-empty
`sourceNodeId` (`viewModel/library.ts:166`). A foundation entry carries
`sourceNodeId: ''` by definition, since a foundation doc has no source node:
its source is the file's own collections, addressed by scope
(`docLink.ts:170`). So the expression is structurally false for every
foundation row, and the menu item never renders.

The result is that the one screen listing a user's foundation documents is the
one screen from which those documents cannot be copied.

## Decisions

Three questions were settled before design.

**A row copies its own collection, not the whole file.** `copyFoundationBrief`
documents the opposite doctrine for the footer button: it "deliberately ignores
the scope selection", because "a partial one produces exactly the invented token
names the brief is meant to prevent" (`actions.ts:697`). That reasoning holds
for a file-wide screen. It does not hold for a row the user picked out of a
list, and the risk it names is already mitigated — see *Alias integrity* below.

**Collection granularity, not the stored scope.** A `FoundationScope` can be
narrower than a collection in two ways, and both are artifacts of drawing a
frame rather than statements of intent:

- `modeIds = source.slice(0, MAX_MODE_COLUMNS)` truncates to four modes because
  a frame can only render four columns (`foundation.ts:415`). The code even
  tracks what it dropped, as `omittedModeNames`.
- A collection over `SPLIT_THRESHOLD` (150 variables) splits into one document
  per top-level group (`foundation.ts:427`). A 400-variable "Semantic"
  collection becomes three rows in My Library.

The clipboard has neither a column limit nor a page. Inheriting these would mean
a user copying "Foundations · Semantic · color" never learns that `space/` and
`radius/` tokens exist, or that a fifth mode exists. So the copy widens to the
collection: every mode, every group. All three rows of a split collection copy
the same payload.

**The format stays YAML.** A CSS-custom-property export was considered and
rejected for this change. The YAML brief is the single public contract, and it
carries facts CSS has no place for: contrast findings, group descriptions,
per-mode value tables, alias targets alongside resolved values.

## Alias integrity

The "partial vocabulary" risk is the one real objection to a scoped copy: a
Semantic collection typically aliases into a Primitives collection, and a copy
of Semantic alone leaves those aliases pointing at rows that are not in the
payload.

This is already handled. `valueOf` serialises an alias as both its target name
and its resolved concrete value (`brief.ts:64`):

```yaml
values:
  Light:
    alias: primitives/blue/500
    resolved: "#0A5F3C"
```

An agent reading a scoped brief therefore gets a real value for every alias, and
the name of what it points at. It loses the ability to reference the primitive
token by name, which is the honest cost of asking for one collection.

Aliases that were already unresolvable emit `{ unresolved: <reason> }` exactly
as they do today. Narrowing introduces no new unresolved values, because
resolution happens during `buildFoundation`, upstream of any narrowing.

## Design

### 1. Scope travels with the entry

`LibraryEntry` (`messages.ts:13`) gains one optional field:

```ts
/** Foundation rows only: the scope this doc was generated for, read from its
 *  doc link. Only the main thread can answer it, so it travels with the entry
 *  rather than being re-derived in the UI, exactly as `foundationIcon` does.
 *  Absent on component rows and on any entry an older main thread produced. */
foundationScope?: FoundationScope;
```

The main thread already parses the doc link to derive `foundationIcon`, so the
scope is in hand at that point and costs nothing to forward.

The UI reads only `target` and, for a collection target, `collectionId`. The
`group` and `modeIds` fields are deliberately ignored, for the reason given
under *Decisions*. That narrowing happens at exactly one call site and carries a
comment saying why, so a later reader does not "fix" it back to strict fidelity.

### 2. Narrowing lives in the extractor

A pure helper, rather than a new branch inside `foundationBrief`:

```ts
export type FoundationCopyTarget =
  | { target: 'collection'; collectionId: string }
  | { target: 'textStyles' };

export function narrowFoundation(
  spec: FoundationSpec,
  target: FoundationCopyTarget,
): FoundationSpec | null;
```

- A collection target keeps that one collection and sets `textStyles: []`.
- A text-styles target keeps every text style and sets `collections: []`.
- A collection id that is no longer in the spec returns `null`, which the caller
  turns into a message rather than an empty brief.

`fileKey` and `extractedAt` pass through unchanged.

Keeping this separate from `brief.ts` means `foundationBrief` and
`colorContrast` both run unmodified on the narrowed spec. Contrast is already
scoped per collection (commit `a8b2b6f`, "scope counts per collection"), so
measuring the narrowed spec yields exactly the pairs within that collection,
with no change to `colorContrast` itself. A text-styles target has no colours,
so the contrast block is emitted empty, which is the established behaviour: a
file with no measurable pair still gets the block, saying so
(`actions.ts:721`).

### 3. Group descriptions are filtered, not dropped

`foundationGroupDescriptions` is keyed by collection name, then folder path
(`actions.ts:642`). A collection-scoped copy passes only that collection's
entry. A text-styles copy passes none, since group descriptions describe
variable folders.

The existing empty-map guard in `foundationBrief` (`brief.ts:180`) already omits
the `guidelines` block when nothing survives filtering, so a collection with no
descriptions produces no empty block.

### 4. A new action, beside the existing one

`copyFoundationBrief(ui)` keeps its current whole-file behaviour and its current
caller. A sibling handles the row case:

```ts
export async function copyFoundationBriefForScope(
  scope: FoundationScope,
  ui: BuildPresenter,
): Promise<void>;
```

This function is the one call site referred to in section 1: it takes the
entry's stored `FoundationScope` and reduces it to a `FoundationCopyTarget`,
dropping `group` and `modeIds` with the comment explaining why. Everything
downstream sees only the target.

It then resolves the module-level `foundationSpec`, narrows it, computes
contrast on the narrowed spec, filters group descriptions, serialises, and
copies through the same three-tier `copyText` path with the same size caveat. Two functions
rather than a flag, because the whole-file path's "deliberately ignores scope"
comment is a doctrine that should not acquire an escape hatch.

### 5. The cold-read path

`foundationSpec` is module state populated from two places: the Foundations tab's
`requestFoundation` round trip, and the `selection` message's optional
`foundation` dump (`actions.ts:810`). The second only carries a dump when a
component is selected — with no component selected, `postSelection` posts
`node: null` and no `foundation` field at all (`main.ts:213`).

So a user who opens the plugin with nothing selected and goes straight to My
Library has no spec, and a naive implementation would answer their first click
with "Read the foundations first, then copy" — an instruction whose remedy is on
a different screen.

Two changes:

- **Prefetch on navigation.** Entering the Library view fires `requestFoundation`
  once if `foundationSpec` is null, using the same one-shot guard style as
  `requestFoundations` (`ui-vnext.ts:535`). By the time a user opens a row menu
  and clicks, the dump has landed.
- **Say so on the race.** If the spec is still absent at click time — a
  sub-second window, or a read that failed — the row reports that plainly and
  copies nothing.

The prefetch is what keeps the copy synchronous. An awaited main-thread round
trip between the click and `copyText` destroys the user-gesture call stack, which
is precisely the tier-2 failure `clipboard.ts:9` documents; the copy would then
fall to the tier-3 manual modal every time. Prefetching keeps the common path on
tier 1 or 2.

### 6. Gating

`canCopy` becomes kind-aware:

- Component rows: unchanged.
- Foundation rows: true unless `status` is `unavailable` or `orphaned`, and
  unless `foundationScope` is absent (an entry from an older main thread cannot
  say what to copy, so it does not offer to).

## User-visible copy

Per `docs/plugin-voice-and-copy.md`: plain, honest, no em dashes.

| Situation | Message |
| --- | --- |
| Success | `Copied.` |
| Success, large payload | `Copied. 940 lines, which is large for some chat windows.` |
| Spec not yet read | `Still reading this file's variables. Try again in a moment.` |
| Collection deleted since generation | `That collection is no longer in this file. Nothing was copied.` |
| Read or serialisation failed | `Could not read the foundations. Nothing was copied. <reason>` |

## What this does not change

- The Foundations screen footer button, its whole-file payload, and its copy.
- The brief schema. `narrowFoundation` produces a `FoundationSpec`, so the
  emitted YAML is the existing v2 shape with fewer collections in it.
- Frame generation, drift, hashing, and update. Nothing here touches the canvas
  or any stored metadata, matching the existing copy paths.
- Quota and prose generation. Copy never generates.

## Consequences

"Copy for AI" will mean two payloads behind one label: whole-file from the
Foundations footer, one collection from a Library row. This is accepted. Each
matches the object the user clicked, and the alternative — distinct labels —
would make the row menu inconsistent with the component rows it sits beside.

## Testing

**Extractor** (`narrowFoundation`)
- Collection target keeps only the named collection and empties text styles.
- Text-styles target keeps every text style and empties collections.
- Unknown collection id returns `null`.
- Narrowing preserves every mode and every group of the kept collection,
  including modes beyond `MAX_MODE_COLUMNS` and groups beyond a split.
- Aliases into a dropped collection keep both `alias` and `resolved`.

**Extractor** (brief composition)
- A brief built from a narrowed spec carries contrast for that collection only.
- Group descriptions for other collections do not appear.
- A text-styles brief emits the contrast block with no pairs, not no block.

**Plugin view model**
- A foundation entry with a scope yields `canCopy: true`.
- `unavailable` and `orphaned` foundation rows yield `canCopy: false`.
- An entry with no `foundationScope` yields `canCopy: false`.
- Component-row `canCopy` is unchanged, including the existing false cases.

**Plugin screen**
- A foundation row's menu renders "Copy for AI" with the `copy` glyph, in the
  navigation group, in the same position as a component row's.

**Plugin actions**
- A collection scope copies only that collection.
- All rows of a split collection copy identical payloads.
- A missing spec produces the "still reading" message and no clipboard write.
- A deleted collection produces its message and no clipboard write.
- Entering the Library view with a null spec sends `requestFoundation` once,
  and not again on re-entry.
