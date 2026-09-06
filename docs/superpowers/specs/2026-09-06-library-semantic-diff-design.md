# Library semantic diff: design

**Date:** 2026-09-06
**Status:** Implemented 2026-09-06 (plan: docs/superpowers/plans/2026-09-06-library-semantic-diff.md). Manual matrix rows 12 and 13 in packages/plugin/TESTING.md pending.
**Reads with:** `docs/reviews/2026-09-05-major-review.md` (findings 8, U2,
X4, U5), `ARCHITECTURE.md`, `packages/plugin/src/docLink.ts`,
`packages/extractor/src/hash.ts`, `docs/plugin-voice-and-copy.md`.

## 1. Goal

Make "Review detected changes" in the Library review something. Today a
drifted row expands to "A detailed comparison isn't available", because the
doc link stores only a hash and a hash cannot be diffed. After this change a
drifted component or foundation row lists what changed, by item, with the
value before and after, and the list explains exactly why the row's badge
says "Update available".

Nothing here changes `specContentHash`, `foundationContentHash`,
`EXTRACTOR_VERSION`, any v5 schema, or any v5 artifact. The diff runs over the
same objects the canvas hashes already consume.

## 2. Principle

**The diff input is the hash input.** The Library badge is derived from
`specContentHash` over a projection of `IntermediateSpec`, and from
`foundationContentHash` over `unitContent`. A change list that compared
anything else could disagree with the badge in either direction: a drifted
row with an empty list, or an in-sync row with a non-empty one. So the stored
baseline is that projection, byte for byte, and the live side is the same
projection computed from the live source. Comparing the v5 artifact instead
was considered and rejected for this reason.

## 3. Storage

A new plugin data key on each generated Section:

```ts
export const DOC_BASELINE_KEY = 'specLayerBaseline';
```

Figma's limit is 100 kB per entry (plugin id, key, and value together), not
per node, so a separate key gets its own budget and cannot crowd out the doc
link or the prose. The value is JSON:

```ts
export interface ComponentDocBaseline {
  v: 1;
  kind: 'component';
  /** Must equal the doc link's contentHash, or the baseline is discarded. */
  contentHash: string;
  projection: SpecHashProjection;
}

export interface FoundationDocBaseline {
  v: 1;
  kind: 'foundation';
  contentHash: string;
  projection: FoundationUnitContent;
}

export type DocBaseline = ComponentDocBaseline | FoundationDocBaseline;
```

`SpecHashProjection` is a new exported type from `hash.ts`, returned by a new
exported function:

```ts
export function specHashProjection(spec: IntermediateSpec): SpecHashProjection
export function specContentHash(spec: IntermediateSpec): string
  // = contentHash(specHashProjection(spec))
```

`specContentHash` is refactored to call `specHashProjection`, so the stored
baseline and the hash share one function and cannot drift apart. The
projection's body is the existing hashable object unchanged, including its
legacy `token` key for the token name. `FoundationUnitContent` needs no new
type: `foundationContentHash` already hashes the whole `unitContent` result.

Budget: `BASELINE_BUDGET_BYTES = 90 * 1024`, measured with the existing
`utf8ByteLength` helper in `docLink.ts`. An over-budget baseline serializes to
`''` and stores nothing, with a `console.warn` naming the size, the same rule
prose follows. Half a baseline presented as complete would make the diff
fabricate "removed" items, so the drop is whole or not at all.

`serializeBaseline`, `parseBaseline`, and `baselineFor(link, raw)` live in
`docLink.ts` beside the prose helpers. `parseBaseline` returns `null` on
empty, malformed, wrong `v`, wrong `kind`, or a `projection` that is not an
object. It does not validate the projection's interior: the diff treats
unknown shapes as absent lists. `baselineFor` is the one main-thread entry
point: it parses, then returns `null` unless the baseline's `kind` matches
the link's and its `contentHash` equals the link's `contentHash`, so a stale
or foreign baseline is rejected in a pure, testable function rather than in
`main.ts`.

Write points, each in the same commit as the link write, after the Section
build succeeded:

- `renderDocFrame` in `main.ts` (component create and Update).
- `renderFoundation` and `updateFoundationDoc` in `main.ts`.

Clear points: `detachDoc` clears it with the link. `removeDoc` deletes the
Section, which takes every key with it.

Docs generated before this ships have no baseline. They show the fallback
until their next Update writes one. No migration, no rebuild request.

## 4. Wire protocol

Writes carry the projection from wherever the hash is computed today.

- The UI computes `specContentHash` for a component build in `actions.ts`
  and sends it on `renderDocFrame`. That message gains
  `baseline: SpecHashProjection`, computed by `specHashProjection` on the
  same spec. Main wraps it with `kind` and the hash and stores it.
- Main computes `foundationContentHash(spec, scope)` for foundation docs.
  It also calls `unitContent(spec, scope)` there already for the frame, so it
  stores that same object as the baseline. No message change.

Reads are lazy: nothing new rides the `library` message, which the review
already identified as a hot path.

```ts
// UiToMain
| { type: 'requestDocBaseline'; docId: string }

// MainToUi
| { type: 'docBaseline'; docId: string; baseline: DocBaseline | null;
    live?: FoundationUnitContent | null }
```

Main handles `requestDocBaseline` by reading the Section's link and baseline.
It replies `baseline: null` when the Section is gone, unlinked, has no
baseline, the baseline fails to parse, or `baseline.contentHash !==
link.contentHash`. For a foundation link it also computes `live` from the
current foundation read using the same `retargetScope` the library
enumeration uses, so the live side of the diff is the object whose hash
produced the badge. `live: null` means the scope no longer resolves. For a
component link `live` is absent: the UI already extracted the live spec
during the drift check and keeps its projection.

The UI keeps `libraryLiveProjection: Map<docId, SpecHashProjection>`,
written in the `driftSource` handler alongside the drift verdict and cleared
with the other library maps at the start of each refresh. The projection is a
few kilobytes per component, so holding it for every drifted row is cheap;
it is stored for every component row regardless of verdict so an in-sync row
that drifts on the next refresh needs no second round trip.

## 5. Diff engine

New module `packages/extractor/src/diff.ts`, pure and Figma-free, exported
from the package index. Two layers.

### 5.1 Keyed-list core

```ts
export interface ListDiff<T> {
  added: T[];
  removed: T[];
  changed: { before: T; after: T }[];
  /** Same key set and equal values, different order. */
  reordered: boolean;
}

export function diffKeyed<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  equal: (a: T, b: T) => boolean = canonicalEqual,
): ListDiff<T>
```

`canonicalEqual` compares two values by the same canonical serialization
`contentHash` uses (sorted keys, `undefined` dropped), so "equal" here means
"would hash the same". Duplicate keys within one list are tolerated: items
after the first with the same key are compared positionally and any surplus
is reported as added or removed, never silently merged. Output order follows
the `after` list for added and changed and the `before` list for removed, so
a caller never sorts, and no `localeCompare` is involved. Where a caller does
need to sort, it uses `compareCodeUnits`.

`diffKeyed` is the piece the later `spec-layer diff` command reuses with its
own v5 key functions. That command is out of scope here (section 9).

### 5.2 Group builders

```ts
export interface ChangeGroup { label: string; items: string[] }

export function componentChangeGroups(
  before: SpecHashProjection, after: SpecHashProjection,
): ChangeGroup[]

export function foundationChangeGroups(
  before: FoundationUnitContent, after: FoundationUnitContent,
): ChangeGroup[]
```

Both return only groups with at least one item, in the fixed order below.
Both return `[]` when nothing differs.

Component groups and identity keys:

| Group | List | Key | Value compared |
|---|---|---|---|
| Name | `name` | scalar | the string |
| Properties | `props` | `name` | kind, options, default |
| Variants | `variants` | `prop` | values |
| Variants | `variantInstances` | `nodeId` | name, values |
| Anatomy | `anatomy` | `id` | name, type, nested |
| States | `states` | the string | set membership |
| Tokens | `tokens` | part, property, conditions | `token` |
| Unbound values | `gaps` | part, property, issue | `value` |
| Layout | `layout` | `part` | `summary` |
| Related | `related` | the string | set membership |

`figmaKey`, `figmaFile`, `figmaNode`, and `anatomyComponentId` are in the
hash and so can move it. They are identity, not content; a change in any of
them is reported under Name as "Source identity changed" so an otherwise
empty list still explains the badge.

Foundation groups and keys:

| Group | List | Key | Value compared |
|---|---|---|---|
| Tokens | `rows` | `name` | per-cell, see below |
| Descriptions | `rows[].description` | row name | the string |
| Modes | `modeNames`, `omittedModeNames` | the string | set membership |
| Part | `part`, `collectionName`, `group` | scalar | the values |

A changed row is broken down further: cells keyed by `modeName`, each
reported as its own item when its value differs; a text style row's
`metrics` reported as one item. A row whose `resolvedType` or `kind`
changed is reported as one "changed type" item and its cells are not
itemized, since comparing a colour to a number cell by cell says nothing.

### 5.3 Value formatting

Item strings are built by one formatter per value kind so the copy is
uniform. `FoundationValue` renders as: colour `#RRGGBB` plus ` at 80%` when
alpha is below 1; number and string as is; boolean `true`/`false`; alias as
`{Collection/target name}` followed by ` resolving to <resolved>` when
resolved; unresolved as `unresolved (<reason>)`. Nothing is invented: an
unresolved value never shows a guessed number.

## 6. Presentation and copy

`LibraryRowModel.changeGroups` becomes `ChangeGroup[] | null` and gains

```ts
changeState: 'idle' | 'pending' | 'ready' | 'unavailable';
```

`idle` is every row that is not expanded. Expanding a drifted row sets
`pending` and sends `requestDocBaseline`. The reply resolves to `ready` with
groups, or `unavailable`. The UI caches the result per doc for the current
refresh pass; a new refresh clears it.

Rendering inside the existing details panel, all sentence case, no em
dashes, per `docs/plugin-voice-and-copy.md`:

- `pending`: "Comparing…" in the panel body.
- `ready` with groups: the groups, one `<section>` each, as the screen
  already renders `ChangeGroup[]`.
- `ready` with no groups: the alert row "Source changed" with
  "No itemized differences were found." This should not occur (section 2),
  and it is preferable to an empty panel if it does.
- `unavailable`: the existing alert row "Source changed" with a second line
  that names the reason the UI knows:
  - no baseline: "Update this doc once to enable change lists."
  - anything else: the current "A detailed comparison isn't available.
    Review the source from the row menu."

  There is no rebuild-specific line, because a row marked Rebuild needed
  never expands: the menu item and the disclosure are limited to rows whose
  status is Update available. So the reasons are no baseline and anything
  else.

Item copy, one line each, verb first for additions and removals, the value
transition spelled out with "changed to" rather than an arrow:

- "Added Label / fill: color.brand.500"
- "Removed Icon / padding"
- "Label / fill: color.primary changed to color.brand.500"
- "Label / fill when Size is Large: color.primary changed to color.brand.500"
  (conditions render as "when <axis> is <value>", joined with "and")
- "Added Description property"
- "Size: values were Small, Medium changed to Small, Medium, Large"
- "color/brand/500 in Light: #0055FF changed to #0044EE"
- "Added color/brand/600"
- "Description of color/brand/500 changed"
- "Added mode Dark"
- "Order changed, values unchanged" (only `reordered` fired for that list)
- "Source identity changed"

The menu item keeps its label pair "Review detected changes" and "Hide
detected changes". It stays limited to rows whose status is
`updateAvailable`, as today.

## 7. Errors

Every failure resolves to `unavailable` and the fallback, never to a partial
list:

- Section gone, unlinked, no baseline key, parse failure, hash mismatch,
  over budget at write time (nothing was stored), main-thread read error.
- Component row with no cached live projection (the drift check failed or
  has not landed): the menu item is not offered for non-drifted rows, so
  this is only reachable in a race; treat as `unavailable`.
- Foundation reply with `live: null`: the row is orphaned by then, so the
  panel is not shown; treat as `unavailable` if it is.
- A diff that throws: caught in the UI handler, `unavailable`.

Nothing in this design writes to the canvas or to plugin data outside the
existing create and Update commits, so no failure can leave a doc in a new
state.

## 8. Testing

Unit, all under Vitest:

- `packages/extractor/test/diff.test.ts`: `diffKeyed` for added, removed,
  changed, reordered, duplicate keys, empty lists; `componentChangeGroups`
  and `foundationChangeGroups` over hand-built projections for every group
  in section 5.2, the empty case, the identity-only case, the changed-type
  row, and the alpha and alias formatters.
- `packages/extractor/test/specHash.test.ts`: for every fixture,
  `contentHash(specHashProjection(spec)) === specContentHash(spec)`, and
  the existing golden hashes are unchanged.
- `packages/plugin/test/docLink.test.ts`: baseline serialize and parse,
  budget drop with the `TextEncoder` global deleted, and `baselineFor`
  rejecting a kind or hash mismatch.
- `packages/plugin/test/libraryViewModel.test.ts`: the four change states,
  and that only `updateAvailable` rows expand.
- Screen tests for the three panel bodies and the three fallback lines.

Manual, in `packages/plugin/TESTING.md`, since `main.ts` and `ui-vnext.ts`
are outside coverage: one row per doc kind. Generate a doc, change one bound
token, one unbound value, and one variant value in the source, refresh the
Library, review the row, and check that each edit appears once with the right
before and after. A second row confirms a doc generated before the branch
shows the "Update this doc once" line, and that one Update makes the list
appear on the next drift.

## 9. Out of scope

- `spec-layer diff <a> <b>` over v5 artifacts. It reuses `diffKeyed` and is
  its own plan under the phase 4 command tooling.
- A per-doc changelog across generations (review U5). The baseline makes it
  cheap later, but this plan stores one baseline, the latest.
- A compacted baseline tier for foundation units over 90 kB. Such a unit
  shows the fallback. If real files hit this, the next step is splitting
  large collections into more units, which is how docs already scale.
- Diffing hand edits (`selfHash`). That is a different question with a
  different answer, and the "Manually edited" badge already covers it.
- Any change to the hashes, `EXTRACTOR_VERSION`, or the v5 contract.

## 10. Documents that change

- `CHANGELOG.md`: one Added entry under Unreleased.
- `ARCHITECTURE.md`: the drift detection paragraph gains the baseline key
  and the "diff input is the hash input" rule.
- `docs/plugin-knowledge-map.md`: `diff.ts` and `DOC_BASELINE_KEY`.
- `docs/reviews/2026-09-05-major-review.md`: finding 8 and U2 marked
  addressed, with a pointer here.
- `packages/plugin/TESTING.md`: the rows in section 8.
