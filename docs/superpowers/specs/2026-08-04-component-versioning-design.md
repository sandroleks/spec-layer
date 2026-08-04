# Component versioning and dev readiness — design

*New backlog item. Written 2026-08-04 on `main`. Extends source-linked docs from a binary "in sync / drifted" badge into a per-component revision history, optional named releases, and a dev-readiness state that expires when the component changes.*

## Problem

Every generated doc already stores its source node id and a `specContentHash` ([`docLink.ts`](../../../packages/plugin/src/docLink.ts)). That buys drift detection: a doc resolves to `inSync`, `updateAvailable`, `edited`, or `orphaned`. It is a genuinely useful signal and it is also the entire extent of what the product knows about change.

Three things it cannot answer:

1. **What changed.** `updateAvailable` means "the hash moved." It does not say a variant was added, a token was swapped, or a state was removed. The designer has to diff by eye.
2. **What changed when.** There is one baseline hash, overwritten on every Update. No history exists, so "what has this component done over the last month" is unanswerable.
3. **Whether this is safe to build.** Nothing distinguishes a doc that is a work in progress from one that engineering should implement.

Field research (see Prior art) says the third is the loudest complaint in practice, and that the reason existing signals fail is not that they are absent but that they carry no content. Figma's own library-update indicator is described on Figma's forum as a signal designers dismiss reflexively, because clicking it rarely explains anything. A version system that only adds another badge repeats that mistake.

## Prior art

Consulted during design, and where each pushed the decisions:

- **Nathan Curtis, [Versioning Design Systems](https://medium.com/eightshapes-llc/versioning-design-systems-48cceb5ace4d)** — doc versions should be decoupled from code versions; versioning must be "made evident in the designer's tools." Drove the on-frame version block over a panel-only display.
- **Brad Frost, [single library or individual components](https://bradfrost.com/blog/post/design-system-versioning-single-library-or-individual-components/)** — favors library-level versioning, warns per-component versioning produces "version sprawl." Noted and deliberately not followed; see Decisions.
- **[hdennison, Figma versioning strategies](https://hdennison.com/blog/figma-versioning/)** — argues semver belongs in code and forcing it into Figma "can create unnecessary complexity." Drove free-form version strings with semver suggested rather than enforced.
- **[Figma forum: allow designers to use previous versions of a library](https://forum.figma.com/t/allow-designers-to-use-previous-versions-of-a-library/56564)** — highly requested, unshipped. The stated reason is that engineering lags the design system team, so designers need to work against the version developers actually have. This is the demand signal for readiness state.
- **[Figma forum: library update notifications](https://forum.figma.com/suggest-a-feature-11/please-revert-decision-to-remove-library-update-notifications-20319)** — the update indicator is characterized as something designers wave away without reading. The lesson: a contentless signal is worse than none.
- **Deprecation practice in the wild** — teams rename components to `Button [deprecated]` or `🔄 Button v1.0 (old)` and use a ⚠️ emoji to make them searchable. These are workarounds for Figma having no deprecation primitive, and they exploit the one channel that propagates into consuming files: the component's name and description.

## Goals

- Record an automatic, monotonic revision per doc on every Generate and Update, with a structured fingerprint sufficient to diff against any other retained revision.
- Render a deterministic, human-readable "what changed" between two revisions. No AI, no quota, nothing leaving the file.
- Let a designer promote a revision to a named release, per component, with an optional breaking flag and notes.
- Let a designer mark a doc ready for dev, and have that mark **automatically expire when the component changes**, so the label can never describe a stale shape.
- Surface all of it on the doc frame (visible without the plugin open) and in the My Library panel.
- Leave every already-generated doc working, and leave `specContentHash` and the frozen Markdown body contract untouched.

## Non-goals (explicitly deferred)

- **Writing to source components.** Stamping version and readiness into a component's `description` is the only channel that propagates to designers in consuming files who are not running the plugin. It is deliberately out of scope: today the plugin writes only to frames it created, and editing library component metadata is a materially different trust posture. This leaves the handoff-visibility gap partly open, and that is an accepted trade, not an oversight. Candidate for a later opt-in.
- **Reading Figma's version history.** The Plugin API exposes `saveVersionHistoryAsync()` (write) and no read equivalent; reading requires the REST API and an auth token, which would break the no-account, nothing-leaves-your-file posture. All history here is history Spec Layer keeps itself.
- **Rolling a doc back to an old revision.** Fingerprints are summaries, not snapshots. Rollback is impossible by construction, which is the intended trade for staying inside the pluginData budget.
- **A library-level release object.** Per-component only; see Decisions.
- **Auto-deprecating anything.** `deprecated` is a state a designer sets. The tool never decides a component is obsolete.
- **Diffing arbitrary historical pairs indefinitely.** Fingerprints are pruned; the timeline is not. See Retention.

## Decisions taken during design

| Question | Decision | Why |
|---|---|---|
| Who assigns versions | Both: automatic revisions as the substrate, optional deliberate releases on top | The auto layer cannot go stale because nobody maintains it; the release layer is what designers ask for out loud. Either alone fails |
| Versioning unit | Per component. No library release object | Confirmed against how the consuming engineering side tracks the system. Frost's sprawl warning is real but applies to distributing code packages, not to labelling docs |
| Version string format | Free-form, semver suggested, never enforced | Practitioners actively disagree about semver inside Figma. Teams may need to mirror whatever engineering calls it |
| Where versions are visible | Doc frame plus panel. Not source components | Frame renders into the file and survives a screenshot. Source-component writes rejected on trust grounds |
| Revision payload | Structured fingerprint, not hash-only and not a full snapshot | Hash-only cannot say what changed, which is the whole feature. Full snapshots exceed the 100 kB budget within a few revisions |
| Readiness lifetime | Granted at a revision, auto-expires on drift | Makes "Ready for dev" a guarantee about the current shape rather than a claim someone forgot to update |
| Readiness values | Reuse existing `draft` / `approved` / `deprecated`, label `approved` as "Ready for dev" | `SpecFrontmatter.status` is validated against a closed list ([`frontmatter.ts:15`](../../../packages/format/src/frontmatter.ts)); a new value would make older parsers throw |
| Breaking detection | Heuristic suggestion from removals, pre-checked and explained, always overridable | Removals are the signature of a breaking change. The tool suggests; it never asserts |
| Storage location | New pluginData key on the doc Section | Keeps the existing `specLayerDoc` blob byte-stable and gives history its own 100 kB budget |

## Constraints verified during design

- **`content_hash` excludes frontmatter.** `specContentHash` hashes a projection of `IntermediateSpec` ([`hash.ts:29`](../../../packages/extractor/src/hash.ts)). New frontmatter fields cannot move it, so the frozen-format hash-stability rule is not at risk.
- **`SpecFrontmatter.status` is a closed enum**, rejected on parse if unrecognized. Adding a fourth value is a breaking format change; adding new optional *keys* is not.
- **pluginData is 100 kB per `(pluginId, key, value)` entry**, enforced since March 2025. Multiple keys are permitted, so a separate history key gets its own budget.
- **The Plugin API cannot read version history.** Only `saveVersionHistoryAsync()` exists.

## Data model

### `packages/extractor/src/fingerprint.ts` (new, pure)

No Figma runtime, fixture-tested, mirroring the extractor purity boundary.

```ts
/** A compact, canonical summary of a spec, sufficient to diff but not to rebuild. */
export interface Fingerprint {
  v: 1;
  /** Sorted "Prop=Value" strings across the component set. */
  variants: string[];
  /** Sorted depth-0 anatomy part names. */
  parts: string[];
  /** Role to token name, keys sorted. */
  tokens: Record<string, string>;
  /** Named measurement to value, keys sorted. */
  metrics: Record<string, number>;
}

export function fingerprint(spec: IntermediateSpec): Fingerprint;

export type ChangeKind = 'added' | 'removed' | 'changed';
export type ChangeArea = 'variant' | 'part' | 'token' | 'metric';

export interface Change {
  kind: ChangeKind;
  area: ChangeArea;
  label: string;
  from?: string | number;
  to?: string | number;
}

export function diffFingerprints(from: Fingerprint, to: Fingerprint): Change[];

/** Deterministic sentence for one change. No AI. */
export function describeChange(c: Change): string;

/** True when the diff contains removals, which is the breaking-change signature. */
export function hasRemovals(changes: readonly Change[]): boolean;
```

Arrays are sorted and map keys are sorted so a fingerprint is canonical: the same component always produces the same fingerprint, and a diff never reports spurious reordering. `parts` uses the same depth-0 filter `specContentHash` applies, so the fingerprint and the drift baseline agree about what counts as structure.

### `packages/plugin/src/docHistory.ts` (new, pure)

Figma-free, unit-testable, directly mirroring how [`docLink.ts`](../../../packages/plugin/src/docLink.ts) is structured.

```ts
export const DOC_HISTORY_KEY = 'specLayerHistory';

export interface Release {
  version: string;      // free-form; semver suggested
  breaking: boolean;
  notes?: string;
  at: number;
}

/** A revision that still carries its fingerprint and can be diffed. */
export interface Revision {
  n: number;            // monotonic per doc, 1-based
  at: number;
  hash: string;         // specContentHash at this revision
  pluginVersion: string;
  fp: Fingerprint;
  release?: Release;
}

/** A pruned revision: timeline only, no longer diffable. */
export interface RevisionStub {
  n: number;
  at: number;
  hash: string;
  release?: Release;
}

export type Readiness = 'draft' | 'approved' | 'deprecated';

export interface ReadinessMark {
  state: Readiness;
  /** The revision at which this was granted. */
  atRev: number;
}

export interface DocHistory {
  v: 1;
  /** Newest last. Stubs precede full revisions. */
  revs: (Revision | RevisionStub)[];
  readiness?: ReadinessMark;
}

export function isStub(r: Revision | RevisionStub): r is RevisionStub;

export function serializeHistory(h: DocHistory): string;
/** Defensive parse: returns an empty history on empty/garbage/wrong-shape, never throws. */
export function parseHistory(raw: string): DocHistory;

/** Append a revision, then prune. Idempotent when hash and fingerprint are unchanged.
 *  `release` is excluded: a revision is never born released, only promoted later. */
export function appendRevision(
  h: DocHistory,
  entry: Omit<Revision, 'n' | 'release'>,
): DocHistory;

export function promote(h: DocHistory, n: number, release: Release): DocHistory;
export function setReadiness(h: DocHistory, state: Readiness, atRev: number): DocHistory;
```

### `packages/format/src/types.ts` (additive)

```ts
export interface SpecFrontmatter {
  // ...unchanged...
  /** Named release covering this doc, if one has been cut. */
  version?: string;
  /** Revision number at export. */
  revision?: number;
}
```

Both optional and both new keys, so no `spec_version` bump and no parser change. `status` continues to carry readiness using its existing three values.

## Behavior

### Appending revisions

On Generate, the doc starts at `r1`. On every Update, a revision is appended with the new hash and fingerprint.

`appendRevision` is **idempotent on unchanged content**: if the incoming hash and fingerprint match the newest revision, it returns the history unchanged rather than recording an `r8` identical to `r7`. Regenerating an unmodified component is a documented no-cost operation (it hits the prose cache), so it must not inflate the timeline either.

A hand-edited doc that is then Updated records one revision. The `edited` status already covers hand edits and is not part of history; history tracks the *source component*, not the frame's text.

### Retention

Fingerprints are the cost (~1 kB each); stubs are not (~50 B).

- Keep full fingerprints for the most recent **40** revisions and for **every released revision**, regardless of age.
- Prune older revisions to stubs. Never prune the newest revision.
- Stubs are never removed, so the timeline is complete for the life of the doc.

At 40 fingerprints plus stubs, worst-case serialized size sits well under the 100 kB entry limit. `appendRevision` recomputes retention on every call, so a history that predates a retention change converges on the current policy at the next Update. If serialization would still exceed the limit, retention drops the oldest unreleased fingerprint and retries; write failure is never silent.

### Readiness expiry

`ReadinessMark.atRev` is what makes the label trustworthy.

- Setting **Ready for dev** records `{ state: 'approved', atRev: <current revision> }`.
- When the current revision exceeds `atRev`, the doc displays as `draft` with the qualifier "was ready at r7, changed since." The stored mark is **not** rewritten, so the history of who marked what, and when, survives.
- `deprecated` does **not** expire. Deprecation is a decision about the component, not a claim about a shape, and a deprecated component that changes is still deprecated.
- `draft` does not expire either, having nothing to expire into. A doc with no mark at all resolves to `draft`, and the **Back to draft** action records `draft` explicitly; both display identically.

This is the mechanism that answers the handoff complaint: a doc reading Ready for dev is guaranteed to describe the component as it currently exists, because any change to the component demotes it automatically.

### Breaking-change suggestion

The release dialog calls `hasRemovals` on the diff since the previous release (or `r1` if none). When true, the breaking checkbox is pre-checked and the reason is shown, listing the removals. The designer can uncheck it. The tool never records `breaking: true` without the designer having seen and had the chance to reject it.

## Surfaces

### Doc frame

The brand header ([`brandHeader.ts`](../../../packages/plugin/src/brandHeader.ts)) gains a version line, rendered by [`docFrame.ts`](../../../packages/plugin/src/docFrame.ts):

```
Button · v2.1.0 · r7 · Ready for dev
```

Segments are omitted when absent: an unreleased doc shows `Button · r7 · Draft`. Because this renders into the frame, it survives PNG export and a screenshot pasted into Slack, which is the practical route by which most people encounter these docs.

### My Library panel

Each doc row expands to a timeline, newest first:

- Revision number, date, release name when present, breaking marker when set.
- The current readiness state, with the expiry qualifier when applicable.
- Selecting two retained revisions renders the diff as sentences.
- Actions: **Mark ready for dev**, **Cut a release**, **Mark deprecated**, **Back to draft**.

Stub revisions display in the timeline with diffing unavailable, labelled honestly rather than hidden.

### Markdown export

`version` and `revision` land in frontmatter; `status` carries readiness. The Markdown **body is unchanged** — no new sections, per the frozen-format rule.

## UI copy

Following [`docs/plugin-voice-and-copy.md`](../../plugin-voice-and-copy.md): plain, honest, peer tone, no em dashes.

| Context | Copy |
|---|---|
| Readiness, ready | `Ready for dev` |
| Readiness, expired | `Draft. Was ready at r7, changed since.` |
| Readiness, draft | `Draft` |
| Readiness, deprecated | `Deprecated` |
| Empty timeline | `One revision so far. Changes show up here after the next update.` |
| Stub revision | `r3 · Jun 12 · too old to compare` |
| Breaking pre-check reason | `Removals since v2.0.0, so this looks breaking. Uncheck if it is not.` |
| Diff, added variant | `Added variant Size=XL` |
| Diff, changed token | `padding-md changed to padding-lg` |
| Diff, removed part | `Removed Loading state` |
| Release dialog hint | `Any label works. Semver if your engineers use it.` |

## Testing

Unit, in `packages/extractor/test/fingerprint.test.ts`:

- `fingerprint` is canonical: reordered variants, parts, or token keys produce an identical fingerprint.
- `fingerprint` agrees with `specContentHash` about depth-0 anatomy.
- `diffFingerprints` detects each area and kind; an unchanged pair yields `[]`.
- `hasRemovals` is true for removed variants and parts, false for additions and value changes.
- `describeChange` output is stable for every kind and area combination.

Unit, in `packages/plugin/test/docHistory.test.ts`:

- `parseHistory` returns an empty history for `''`, malformed JSON, wrong `v`, and a non-array `revs`, and never throws.
- `appendRevision` assigns monotonic `n`, and is a no-op when hash and fingerprint match the newest revision.
- Retention prunes to stubs beyond the cap, never prunes a released revision, and never prunes the newest.
- A history exceeding the size limit sheds the oldest unreleased fingerprint rather than failing the write.
- Readiness resolves to expired-draft when the current revision exceeds `atRev`, and `deprecated` survives drift.
- `promote` on an unknown revision number is rejected rather than silently ignored.

Round-trip, in `packages/format/test/frontmatter.test.ts`:

- Frontmatter carrying `version` and `revision` round-trips.
- Frontmatter written *without* them still parses, and a doc written before this feature parses unchanged.

## Backward compatibility

- Docs generated before this feature have no `specLayerHistory` key. `parseHistory('')` returns an empty history, and the first Update seeds `r1` from the current state. No migration pass, no rewrite of existing blobs.
- `specLayerDoc` is not touched, so `DocLinkData` stays byte-identical and existing drift detection is unaffected.
- `specContentHash` is unchanged, so no already-committed spec flips its `content_hash`.
- Older parsers read new Markdown files because both new frontmatter keys are optional additions and `status` gains no new values.

## Known limitations

Stated plainly so the spec does not overpromise:

1. A designer in a product file who is not running the plugin sees no version information. Only the doc frame and the panel carry it, and source-component writes are out of scope.
2. Diffs are unavailable between stub revisions. Long-lived docs lose the ability to compare their distant past.
3. The fingerprint covers variants, parts, tokens, and named metrics. A change confined to something outside that projection moves `specContentHash` and produces a revision whose diff is empty. The panel must say "changed, but not in a way this can summarize" rather than "no changes."
4. Version numbers are not reconciled against code. A doc reading `v2.1.0` asserts what a designer typed, not what engineering shipped.
