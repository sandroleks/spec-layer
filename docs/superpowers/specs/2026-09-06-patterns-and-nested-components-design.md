# Patterns and nested components

**Date:** 2026-09-06
**Status:** Approved design, implementation plan pending. Ships in the same plugin release as `2026-09-06-component-frame-quality-design.md` (spec A) so users rebuild once.
**Reads with:** spec A, `docs/specs/component-context-v5.md`, `packages/extractor/src/naming.ts`, `packages/extractor/src/anatomy.ts`, `packages/extractor/src/tokens.ts`.

## 1. Why

Users document patterns: a Card built from an Avatar, a Button and text. Today the two halves of the document disagree about what the Card is made of.

- Anatomy stops at each nested instance and lists "Button" as one part. Correct for a black-box view.
- The token, gap and raw-value walks descend into everything with no instance boundary, so the Button's inner label fill, container padding and icon color appear as rows under parts named "Label", "Container" and "Icon" that Anatomy never lists. For a real pattern the Tokens table is dominated by sub-component internals.
- Nothing records how the sub-component is used: which Button variant the Card places, which properties it sets. Figma states both on the instance.
- "Related components" is a bare list of names and is the whole composition story.

Decisions taken during brainstorming:

- **Black box.** A nested published component is one part. The document names it, states the configuration used, and links to the sub-component's own document when one exists in the file. Its internal tokens belong to its own document. Overrides are not documented this round.
- **Composition lives in two places.** The Anatomy legend carries per-part configuration; a new Built from table carries the roll-up with counts and links.
- **Properties stays component-only.** Properties exposed upward from nested instances are not listed; the Built from link covers them.
- **The rule applies everywhere.** Canvas, brief, Copy for AI and the v5 artifact all use one boundary, so an agent never reads a sub-component's internals as the pattern's tokens.
- **Unpublished bases are a setting.** Whether instances of local components whose names start with `.` or `_` are descended through is a user setting, on by default.

## 2. Scope

In scope:

1. One boundary rule in the shared parts walker, used by anatomy, tokens, gaps, raw values and layout.
2. A `composition` field on the intermediate spec and in the v5 component artifact.
3. Serializer reads for the main component's id, remote flag, parent set, and the instance's property values.
4. Anatomy legend configuration and hyperlinks; "Related components" becomes "Built from".
5. The Settings toggle, stored per user, recorded per document, and stated in the v5 artifact.
6. v5 component schema 5.2.0.

Out of scope: overrides on nested instances, exposed nested properties, batch documentation of a pattern together with its sub-components, and serializer pruning of instance internals (a speed spec candidate once the timing build from spec A produces numbers).

## 3. The boundary rule

### 3.1 Definition

An instance is a **boundary** when any of these hold:

- its main component is remote (from a library),
- its main component is local and its name does not start with `.` or `_`,
- the setting is off.

An instance that is not a boundary is **transparent**: the walks treat it as a frame and descend into its children. Its main component is not recorded in composition, because it is being treated as structure, not as a component the pattern uses.

The name checked is the main component's own name. When the main component is a variant inside a component set, the set's name is checked instead, since Figma applies the publishing rule to the set.

### 3.2 Where it lives

`walkParts` in `packages/extractor/src/naming.ts` gains a `boundary` predicate parameter. When the predicate returns true for a node, `visit` is still called for that node (it is a part) but its children are not walked. Every pass that walks the tree passes the same predicate, built once from the boundary mode by a small `boundaryPredicate(mode)` factory in a new `packages/extractor/src/boundary.ts`. Anatomy's own walker adopts the same predicate in place of its `!nested` check, so under the default setting anatomy now descends through unpublished bases, and the token walk now stops where anatomy stops.

The boundary mode is a two-value type:

```ts
export type BoundaryMode = 'published' | 'all';
// 'published': unpublished local instances are transparent (setting on, default)
// 'all':       every instance is a boundary (setting off)
```

`extractSpec` takes the mode as an argument. There is no default parameter, so no caller can silently pick one.

### 3.3 What changes in existing passes

- **Tokens, gaps, raw values, layout**: stop at boundaries. Rows for a boundary instance's own bindings (a fill bound on the instance node itself) are kept, attributed to the instance part. Rows for its internals are gone.
- **Anatomy**: descends through transparent instances. The skipped-wrapper path logic is unchanged. Depth counting is unchanged: a transparent instance occupies a level like any frame.
- **Related**: computed from composition (section 4), not from the anatomy walk.
- The spec A nested-instance fixture (its section 6.3) moves here and pins both modes.

## 4. Composition

### 4.1 Serializer

For every `INSTANCE` node, `serialize.ts` extends the existing `mainComponent` object and adds one field:

```ts
mainComponent?: {
  name: string;
  key: string;
  /** Stable node id of the main component. */
  id: string;
  /** True when the component comes from a library. */
  remote: boolean;
  /** Present when the main component is a variant inside a set. */
  set?: { name: string; id: string };
};
/** The instance's component property values as Figma states them, keyed by
 *  raw property name. Variant and text values are strings, booleans are
 *  booleans. An instance-swap value is the swapped component's name, resolved
 *  by id; when the lookup fails the property is omitted rather than shown as
 *  an id. Omitted entirely when Figma states no properties. */
instanceProperties?: Record<string, string | boolean>;
```

`id`, `remote` and `set` come from the resolver's existing main-component lookup, which already holds the node. `instanceProperties` reads `node.componentProperties`, which is synchronous. Resolving an instance-swap value to a name costs one `getNodeByIdAsync` per swap property per instance, the only new round trip, and it goes through the memoized resolver so repeated swaps of the same component are read once.

### 4.2 Extractor

`IntermediateSpec` gains:

```ts
composition: CompositionEntry[];
boundary: BoundaryMode;

export interface CompositionEntry {
  /** Display name: the set name when the component is a variant, else the component name. */
  name: string;
  key: string;
  id: string;
  remote: boolean;
  /** Instances of this component in the default variant, at boundaries only. */
  count: number;
  /** Each distinct configuration used, in first-seen order. Property names are
   *  cleaned with cleanPropName; variant axes appear by axis name. */
  configurations: Record<string, string | boolean>[];
}
```

Entries are built from the default variant's boundary instances, grouped by main component key (falling back to id when the key is empty, which Figma does for unpublished local components), and sorted with `compareCodeUnits` on `name` then `key`. Configurations keep first-seen order because a reader expects the first Button in the Card to be listed first; the order is deterministic since the tree order is. Instance-swap values arrive from the serializer already resolved to names, so configurations never carry an id.

`related` becomes the list of composition names, so the two never disagree.

## 5. Canvas

### 5.1 Anatomy legend

A nested part's legend entry gains, after the description and before the Controlled by line from spec A:

- the component name, as today,
- "Configuration: " followed by the instance's property values as `Name=Value` pairs joined with a middle dot, omitted when the instance sets none,
- a hyperlink on the component name to the sub-component's document, when one exists.

Remote components render "library component" after the name and never link.

### 5.2 Built from

The section with stored id `related` is relabeled "Built from" and moves from the Usage group to the Specifications group, after Properties. It renders one table: Component, Count, Configuration. One row per composition entry; when an entry has several configurations, one row per configuration with the count on the first. The component name carries the hyperlink when a document exists. When composition is empty the section renders "None", as Related components does today.

The stored id stays `related` for the same reason spec A keeps `configuration`: stored configs list ids and drop unknown ones.

### 5.3 Hyperlinks

The main thread resolves links at render time: for each composition entry, it looks for a Section in the file whose component doc link `sourceNodeId` equals the entry's `id` or its set's id, using the same search `renderDocFrame` already uses to find a document for a source node. When found, the text node gets a Figma node hyperlink to that Section. When not found, plain text. Links are not stored in the doc link and are recomputed on Update, so a sub-component documented later gains its link on the next Update of the pattern.

## 6. The setting

### 6.1 Copy and storage

Settings screen toggle, label "Include unpublished components (names starting with . or _)", helper line "Treat them as part of this component instead of a separate one." On by default. Stored per user in Figma client storage under `includeUnpublished`, next to `aiEnabled` and `brandTheme`. Copy follows `docs/plugin-voice-and-copy.md`: sentence case, no em dashes.

### 6.2 What reads it

- Selection extraction, Copy for AI and Publish use the current setting.
- New documents store the mode in `DocConfig.boundary`.
- Update, drift checks and Library rebuild use the document's stored mode, never the current setting. Two collaborators with different settings never see false drift on each other's documents.
- Documents from before this change have no stored mode. They already read "Rebuild needed" under the extractor version bump from spec A, and a rebuild stores the current mode.

Changing the setting never alters an existing document. The confirmation copy on the toggle says existing documents keep the mode they were built with and are rebuilt with the new mode only when created again.

## 7. Hash, version, v5

- `composition` and `boundary` enter the canvas hash projection in `hash.ts`. The extractor version bump to `'3'` from spec A covers the rebuild; no second bump.
- The v5 component artifact gains a top-level `composition` array with the same fields as `CompositionEntry`, and `component.boundary` as a stated fact. Schema 5.2.0 in `packages/extractor/src/v5/schema/component-5.2.0.json`, byte-identical under `apps/landing/schemas/`, published URL serving the committed bytes before release. `semanticContentHash` moves, which is correct: two artifacts built under different modes are different contracts. The direct golden and `componentV5.ts` fixture are updated.
- The AI profile projection includes `composition` (names, counts, configurations) since it changes what an implementer writes; it stays downstream and never feeds a hash.
- Foundation documents, `foundationContentHash` and the DTCG projection are untouched.

## 8. Testing

Fixtures under `packages/extractor/test/fixtures/`:

- `card.json`: a Card with two Buttons in different configurations, one Avatar, and two text layers. Expected: three anatomy parts plus text; composition with Button count 2 and two configurations, Avatar count 1; no rows from Button internals.
- `button-on-base.json`: a Button whose only child is an instance of `.Button base`. Under `'published'` the base's parts and tokens are the Button's; under `'all'` the base is one part with only its own bindings and appears in composition.
- `remote-instance.json`: a component containing a remote instance. Always a boundary, `remote: true` in composition, no link on canvas.

Tests:

- `walkParts` boundary predicate: visit called for the boundary node, children not walked; transparent instance walked like a frame.
- `boundaryPredicate` for both modes, dot and underscore prefixes, set-name precedence, remote precedence.
- Composition grouping, key fallback to id, code-unit sort, first-seen configuration order.
- Hash-projection goldens for all three fixtures in both modes.
- v5: schema 5.2.0 validates the goldens; `composition` and `boundary` present; a mode change moves `semanticContentHash`; both schema copies byte-identical.
- Doc model: legend configuration line present and absent, "library component" for remote, Built from rows and the "None" state, stored id `related` unchanged.
- Doc link: `boundary` round-trips in `DocConfig`; drift uses the stored mode when it differs from the live default.
- Gates: `npm run check`, the sandbox scan, and the landing schema check.

Manual rows in `packages/plugin/TESTING.md`: the setting toggle and its confirmation copy, a pattern document's legend and Built from table, a legend link opening the sub-component document, a sub-component documented after the pattern gaining its link on Update, and a document rebuilt under its stored mode after the setting is flipped.

## 9. Documentation

- `CHANGELOG.md`: boundary rule, composition, Built from, the setting, schema 5.2.0.
- `docs/specs/component-context-v5.md`: `composition` and `boundary` under Component facts; 5.2.0 in Validation and compatibility.
- `docs/plugin-knowledge-map.md`: the boundary predicate as the one place instance descent is decided.
- `docs/reviews/2026-09-05-major-review.md`: U6 partially addressed (composition), batch creation still open.
- `CLAUDE.md`: schema 5.2.0 and the boundary invariant: every tree walk in the extractor takes the boundary predicate; none decides instance descent on its own.

## 10. Follow-ups this spec creates

- Overrides on nested instances, as a Built from column, once a user asks for it.
- Batch documentation of a pattern with its sub-components in one pass.
- Serializer pruning of boundary instance internals, decided by the timing build.
