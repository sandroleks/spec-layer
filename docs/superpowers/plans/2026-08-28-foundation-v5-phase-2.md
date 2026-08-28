# Foundation Context v5 — Phase 2: source identity and references

> **For agentic workers:** execute this plan task by task, with an independent
> review after each task and a whole-branch review before the plugin cutover.
> Phase 1 found its most serious defect only at the whole-branch boundary, where
> one module interpreted another module's output differently.

**Goal:** Make the plugin's foundation Copy for AI path emit a deterministic
Foundation Context v5 artifact whose collection, mode, and token identities are
the stable Figma identities; whose values are keyed by mode id; whose numbers
and colours preserve what Figma actually stated; and whose alias lineage and
extraction completeness are truthful enough for downstream code generation.

**Architecture:** Keep one source read and two projections. Figma is read once
by `serializeFoundation.ts` into `SerializedFoundation`. `buildFoundation`
turns that dump into the shared, Figma-free `FoundationSpec` used by the canvas,
the component brief, and the new v5 exporter. Phase 2 keeps the existing
`FoundationVariable.valuesByMode` as an explicit legacy/render projection and
puts stable token identity, scopes, source-colour precision, stale raw mode
keys, and complete mode-aware alias chains under a separate
`FoundationVariable.provenance` field. `unitContent` reads only the legacy
projection, so none of that non-rendered provenance can enter
`foundationContentHash`. A new pure `src/v5/fromFoundation.ts` converts the
provenance directly into `FoundationArtifactV5`. The production path MUST NOT
emit v4 and then call `normalizeV4`: that would immediately throw away the ids,
scopes, raw colour channels, and full chains Phase 2 exists to preserve.

```text
Figma plugin APIs
      |
      v
serializeFoundation.ts  -- stable ids, raw values, scopes, read failures
      |
      v
buildFoundation()       -- one graph -> provenance + legacy render projection
      | \
      |  \-- existing unitContent()/foundationContentHash() (unchanged)
      |
      v
buildFoundationArtifactV5() -- canonical values, diagnostics, completeness
      |
      v
Copy for AI YAML
```

**Tech stack:** TypeScript, vitest, the existing `js-sha256` runtime dependency,
the existing hand-written YAML emitter, and Figma's local Variables API. No new
runtime or development dependency is required.

---

## Read before implementation

Read these files completely before changing code:

- `docs/specs/foundation-context-v5.md`
- `docs/specs/foundation-v5-status.md`
- `docs/superpowers/plans/2026-08-27-foundation-v5-phase-1.md`
- `packages/plugin/src/serializeFoundation.ts`
- `packages/plugin/src/main.ts` (the `foundationReader` and every
  `serializeFoundation` call site)
- `packages/extractor/src/foundation.ts`
- `packages/extractor/src/brief.ts` (the v4 compatibility projection)
- every file under `packages/extractor/src/v5/`
- `packages/plugin/src/ui/actions.ts` (foundation state and both Copy paths)
- `packages/extractor/src/hash.ts` and
  `packages/extractor/test/foundationHash.test.ts`

Do not begin Phase 2 on top of an uncommitted stabilization wave. The shared
tree currently contains post-review Phase 1 fixes; land or otherwise isolate
them first, then record the Phase 2 base commit in the implementation PR.

### Stabilization behavior that is already correct and must stay correct

The current shared tree fixes five review findings. Phase 2 consumes these as
preconditions; it does not reopen them:

1. `V4AliasValue.external`, not a collection label or a name match, is the
   authority for migrated external aliases. An unnamed external reference that
   shares a path with a local token stays external.
2. The v4 normalizer records the mode v4 actually used for a cross-collection
   resolved snapshot: exact source-mode-name match in the target collection,
   then the target default. It does not write a different default mode into the
   chain beside that snapshot.
3. A scoped v4 input is never reported as a complete whole-file artifact;
   stale v4 mode-name values and duplicate synthetic mode ids are diagnosed.
4. Level 1 deeply validates every shape Level 2 dereferences, checks a token's
   declared type against literal and resolved-alias values, and Level 2 remains
   total even when a caller ignores the Level-1-first contract.
5. Level 2 checks alias target collection/path provenance, chain token/mode
   references, duplicate mode ids, collection/default/replacement/binding
   references, and the package root exports the v5 surface.

Keep the regression tests for all five. A direct Figma export is higher fidelity
than a v4 migration, but it must not make migration less honest.

---

## Scope and definition of done

Phase 2 is done when all of the following are true:

- `ReaderCollection.id`, each `modeId`, and `ReaderVariable.id` survive
  `serializeFoundation` -> `buildFoundation` -> the copied v5 YAML unchanged.
- Renaming or moving an entity changes `name`/`path`, not its `id`.
- Every token has one canonical value record for every declared mode id; no
  production v5 value map is keyed by a display name.
- Figma `Variable.scopes` reaches `TokenV5.scopes`, and every FLOAT token is a
  dimension or number only when the existing `numericValue` policy can state
  that honestly.
- Raw Figma RGBA reaches `canonicalColor`; lossy 8-bit conversions retain
  source `channels`, invalid channels become missing values plus diagnostics,
  and no Phase 2 path clamps a corrupt channel into a plausible colour.
- Every local alias keeps its direct stable target reference and a complete,
  ordered `{token_id, mode_id}` chain to its terminal value. Cycles, missing
  values, ambiguous target-mode choices, type mismatches, and depth exhaustion
  are explicit unresolved results.
- Every non-local target is serialized explicitly as external before graph
  resolution. An external path/name collision can never be resolved to a local
  token. External targets remain unresolved in Phase 2 even when their metadata
  can be read, because their mode/value context is not in the local artifact.
- Read failures and intentional scoping reach the hashed `completeness` block
  and deterministic `unavailable_sources`; a failed read cannot hash like a
  successful empty read.
- Whole-file and collection-row Copy for AI use the direct v5 exporter. The
  legacy v4 projector and `normalizeV4` stay available for migration. A
  text-style-only row stays on the legacy copy path until Phase 3 can emit a
  useful v5 typography payload.
- `EXTRACTOR_VERSION` is bumped exactly once at the user-visible cutover.
- The old canvas drift hashes are byte-for-byte unchanged for equivalent
  rendered content; the new semantic hash moves for identity, scope, raw colour,
  alias lineage, or completeness changes and ignores envelope volatility,
  diagnostics prose, statistics, and generated guidelines.
- Synthetic direct-extraction golden tests pass in CI. Real Company DS
  acceptance is graded only from a reviewed, user-approved real artifact; no
  synthetic fixture is allowed to claim those source-specific criteria.

---

## Non-goals

Do not include any of the following in Phase 2:

- Composite typography or effect-style export, style property bindings,
  publication state, lifecycle inference, archived-style inference, or
  `STYLE_BINDING_DRIFT`. Those are Phase 3.
- Stable style ids in the v5 artifact. The source reader may continue carrying
  the existing style data for v4/canvas use, but Phase 2 does not emit style
  entities. Consequently the combined acceptance criterion "every token and
  style has a stable id" remains open until Phase 3; do not make an empty style
  array pass it vacuously.
- Component Context v5, changes to component token lookup, or changing
  `RefIdentity` semantics for the component brief. Those are Phase 4. Comments
  that currently claim ids never leave the extractor must be narrowed to the
  legacy/component-v4 path, not globally deleted.
- A CLI, semantic diff command, compiler, REST-based Figma extractor, library
  import UI, remote-library value resolution, or network access.
- Inferring units from names, code syntax, values, or neighboring tokens.
- Inferring a cross-collection mode relationship merely because two mode names
  look similar. Phase 2 preserves the current resolver's **exact-name** rule for
  compatibility and records that decision in the chain; it does not add fuzzy,
  case-insensitive, or normalized-name matching.
- Altering `specContentHash`, `foundationContentHash`, `unitContent`, rendered
  frames, doc-link hash baselines, or the v4 `BRIEF_VERSION`.
- Making error diagnostics fatal to artifact construction. The contract says
  extraction finishes with an artifact unless source access fails completely.
- Claiming `source.library_enabled`, `source.file_version`, `modified_at`, or a
  remote library file id when the plugin API did not expose it.

---

## Global invariants

### 1. Stable source ids are opaque

Copy Figma collection, mode, and variable ids exactly. Do not prefix, hash,
normalize, percent-encode, or derive them from names. Synthetic `figma-name:`
ids belong only to `normalizeV4`, whose input genuinely lacks source ids.

### 2. A mode decision has one owner

`AliasReference` states the source alias target. It does not gain a
`target_mode_id`; Figma's `VARIABLE_ALIAS` does not contain one. Each chosen
mode lives only in `ResolutionStep`. For a local hop:

1. same collection -> preserve the current mode id;
2. different collection -> use the one target mode whose display name exactly
   equals the current mode's display name;
3. if there is no exact match -> use the target collection's declared default;
4. if there is more than one exact match, or no valid fallback -> unresolved
   `target_mode_unresolvable`.

This is deliberately the current v4 policy, made observable. It incorporates
the stabilization fix that keeps the chain's `mode_id` aligned with the value
snapshot. A future consumer-context export may use a different explicit mode
assignment, but it must be a separate input to the resolver, not a silent
change to this policy.

For a multi-hop chain, the selected target mode's display name becomes the
current name for the following cross-collection hop, exactly as the existing
`resolveValue` recursion does.

### 3. Externality is established before target resolution

Build the set of local ids from every declared `ReaderCollection.variableIds`
before reading any variable. Do not build it from successful variable reads: a
failed local read must not turn that local id into an "external" id. Every alias
target outside that complete declared set gets an explicit external record,
even if reading its name or collection fails. Graph resolution branches on
that boolean before consulting the local token index.

### 4. Unknown is data, not a default

- Missing scopes -> preserve `scopes: []`, emit `UNIT_METADATA_UNAVAILABLE`, and
  carry the number as `type: number`; do not guess `px`.
- A missing mode value -> `{kind: 'missing', reason: 'no_value_for_mode'}`.
- Invalid RGBA -> `{kind: 'missing', reason: 'invalid_source_value'}` plus
  `INVALID_SOURCE_COLOR`; do not clamp.
- A source field the plugin cannot read -> `null` or absence as allowed by the
  schema, plus completeness/diagnostic state where it affects coverage.
- A local variable read failure -> the id remains known as local, but its token
  is absent and its id is listed in `unavailable_sources`.

### 5. The three hashes stay separate

- `specContentHash` answers whether a component canvas doc's rendered content
  changed.
- `foundationContentHash` answers the same for a foundation canvas doc.
- `semanticContentHash` identifies a v5 interchange artifact.

Do not import `src/hash.ts` from `src/v5/`, and do not add Phase 2 metadata to
`FoundationUnitContent`. Stable token ids, scopes, raw channels, complete alias
chains, stale-mode facts, and extraction issues live only in
`FoundationVariable.provenance` / `FoundationSpec.sourceIssues`; the existing
`FoundationVariable.valuesByMode` remains the explicit legacy/render projection.
`unitContent` must construct its rows field by field from that legacy projection
and must never spread a variable or its provenance. This is the structural
reason `foundationContentHash` stays unchanged, not an expectation that a later
hash function remembers to omit new keys. `semanticContentHash` continues to
cover exactly `completeness`, `collections`, `tokens`, and `styles`, using
code-unit ordering. It excludes `spec_layer`, `diagnostics`, `statistics`, and
the optional generated `guidelines` copy annotation.

### 6. Direct extraction and migration are distinct paths

`normalizeV4` remains a loss-reporting migration. Do not teach it to pretend a
name-derived id is stable, reconstruct channels v4 discarded, or invent scopes
v4 never carried. Direct production Copy uses `buildFoundationArtifactV5`.

### 7. Determinism is structural

- Collections, modes, and tokens retain source order.
- Value entries are inserted in declared mode order and keyed by id.
- Scope arrays and `unavailable_sources` are de-duplicated and sorted with
  `compareCodeUnits`, because their order has no source semantics.
- Alias chains follow hop order.
- Diagnostics use `sortDiagnostics` immediately before artifact construction.
- No `localeCompare` is permitted anywhere under `src/v5/`.

---

## Planned file map

### New production files

| File | Responsibility |
|---|---|
| `packages/extractor/src/v5/fromFoundation.ts` | Direct `FoundationSpec` -> v5 artifact projection, canonical literal conversion, scope selection/dependency closure, extraction diagnostics, and completeness. |
| `packages/extractor/src/v5/statistics.ts` | One shared statistics derivation used by both `normalizeV4` and the direct exporter. |

### Modified production files

| File | Change |
|---|---|
| `packages/plugin/src/serializeFoundation.ts` | Read scopes and remote provenance, inventory local ids before reads, retain metadata for every external alias id, and record exact unavailable sources. |
| `packages/plugin/src/main.ts` | Supply real `Variable.scopes`, `Variable.remote`, file name, and collection lookup data to the injected reader. |
| `packages/extractor/src/foundation.ts` | Carry stable variable ids/scopes/source channels, build full mode-aware alias chains, and propagate unavailable-source detail without changing the render projection. |
| `packages/extractor/src/v5/canonical.ts` | Allow honestly unavailable `library_enabled`; type the optional generated-guidelines annotation while keeping it outside `SemanticPayload`. |
| `packages/extractor/src/v5/value.ts` | Add `target_mode_value_missing` to the unresolved-reason vocabulary; keep reference/mode ownership unchanged. |
| `packages/extractor/src/v5/normalize.ts` | Import shared statistics only; preserve stabilized external/scope/mode behavior byte-for-byte. |
| `packages/extractor/src/v5/validate.ts` | Validate complete chain adjacency/terminal snapshots and numeric/string specialization compatibility without weakening Level 1. |
| `packages/extractor/src/v5/schema/foundation-5.0.0.json` | Mirror the pre-publication nullable source field and optional copy annotation; no other loosenings. |
| `apps/landing/schemas/foundation-context/v5.json` | Byte-for-byte public mirror of the extractor schema; update in the same commit as every schema edit. |
| `packages/extractor/src/v5/index.ts` | Export the direct builder and statistics helper. |
| `packages/extractor/src/brief.ts` | Narrow "ids stay inside" comments to the retained v4/component compatibility projection; do not route production v5 through this module. |
| `packages/extractor/src/tree.ts` | Narrow only the global wording on `RefIdentity`; component-v4 projection still strips ids until Phase 4. |
| `packages/extractor/src/version.ts` | Bump `EXTRACTOR_VERSION` once, at cutover, and update its responsibility comment. |
| `packages/plugin/src/ui/actions.ts` | Build/copy direct v5 for whole-file and collection scopes, preserve generated group descriptions as non-semantic annotations, retain text-style-only v4 fallback. |
| `docs/specs/foundation-context-v5.md` | Record nullable unavailable source metadata and the hash-excluded generated-guidelines annotation before the first production v5 artifact ships. |
| `docs/specs/foundation-v5-status.md` | Mark Phase 2 complete only after cutover and list the precise Phase 3 handoff. |
| `CHANGELOG.md` | Document the user-visible foundation Copy schema change and compatibility boundary. |

### Test and fixture files

- Modify `packages/plugin/test/serializeFoundation.test.ts`
- Modify `packages/extractor/test/foundation.test.ts`
- Modify `packages/extractor/test/foundationHash.test.ts`
- Create `packages/extractor/test/v5/fromFoundation.test.ts`
- Create `packages/extractor/test/v5/statistics.test.ts`
- Modify `packages/extractor/test/v5/fixtures.ts`
- Modify `packages/extractor/test/v5/schemaParity.test.ts`
- Modify `packages/extractor/test/v5/validate.test.ts`
- Modify `packages/extractor/test/v5/canonical.test.ts`
- Modify `packages/extractor/test/v5/normalize.test.ts` only for the statistics
  extraction/refactor regression; do not rewrite stabilized expectations
- Modify `packages/plugin/test/copyFoundation.test.ts`
- Modify `packages/extractor/test/brief.test.ts`
- Modify `packages/extractor/test/briefGolden.test.ts` and
  `packages/extractor/test/fixtures/button-brief.yaml` only for the intentional
  `EXTRACTOR_VERSION` change
- Modify `packages/extractor/test/v5/acceptance.test.ts`
- Modify `packages/extractor/test/v5/phaseCoverage.ts`
- Create `packages/extractor/test/fixtures/v5/synthetic-foundation-serialized.json`
- Create `packages/extractor/test/fixtures/v5/synthetic-foundation-direct-v5.yaml`
- Create `packages/extractor/test/fixtures/v5/company-ds-foundation-v5.yaml`
  only after the real-fixture approval gate in Task 10

---

## Task 0: Freeze the pre-publication contract corrections

The direct plugin exporter is the first path that must fill every envelope
field honestly. Figma's plugin API does not state whether the file itself is
library-enabled, so `library_enabled: false` would be a fabricated fact. The
existing Copy path also carries generated `guidelines.group_descriptions`; a
schema cutover must not silently delete them.

The repository says v5 is **Proposed**, and Phase 1 explicitly did not make the
plugin emit it. Confirm that no v5 artifact has been released. If that is true,
make these corrections within `5.0.0` before first adoption. If a v5 artifact
has in fact shipped, stop: this becomes an additive `5.1.0` contract change and
the schema/version filenames and fixtures must be planned separately.

**Files:**

- Modify `docs/specs/foundation-context-v5.md`
- Modify `packages/extractor/src/v5/canonical.ts`
- Modify `packages/extractor/src/v5/schema/foundation-5.0.0.json`
- Modify `apps/landing/schemas/foundation-context/v5.json`
- Modify `packages/extractor/src/v5/validate.ts`
- Modify `packages/extractor/test/v5/fixtures.ts`
- Modify `packages/extractor/test/v5/schemaParity.test.ts`
- Modify `packages/extractor/test/v5/canonical.test.ts`

### Contract changes

Change `ArtifactSource.library_enabled` from `boolean` to `boolean | null`. `null`
means the sandbox does not expose the fact; it does not mean disabled.

Add an optional, explicitly non-semantic top-level annotation:

```ts
export interface FoundationGuidelinesV5 {
  origin: 'generated';
  group_descriptions: Record<string, Record<string, string>>;
}

export interface FoundationArtifactV5 extends SemanticPayload {
  spec_layer: Envelope;
  diagnostics: Diagnostic[];
  statistics: Record<string, unknown>;
  guidelines?: FoundationGuidelinesV5;
}
```

The spec must say that `guidelines` is generated canvas prose, never measured
source data, and is excluded from the semantic hash. Empty maps are omitted.
The schema and Level 1 validator accept the block only when `origin` is exactly
`generated` and every collection/folder/description level has the declared
string-map shape. Do not weaken unknown-field behavior elsewhere. After editing
the extractor schema, copy those exact bytes to
`apps/landing/schemas/foundation-context/v5.json`; do not hand-edit the two
files independently.

### Required tests

- `library_enabled: null` passes both the JSON Schema and `validateLevel1`.
- A string, missing nested map, or non-string guideline fails both validators.
- Changing only `library_enabled`, export id, generated time, extractor build,
  diagnostics prose, statistics, or guidelines leaves `semanticContentHash`
  unchanged because all live outside `SemanticPayload`.
- Changing any field already inside `SemanticPayload` still moves the hash.
- `schemaParity.test.ts` and a direct byte comparison prove
  `packages/extractor/src/v5/schema/foundation-5.0.0.json` and
  `apps/landing/schemas/foundation-context/v5.json` are byte-identical.
- `SCHEMA_VERSION` remains `5.0.0` only under the confirmed pre-release
  condition above.

Run:

```bash
npx vitest run packages/extractor/test/v5/canonical.test.ts packages/extractor/test/v5/schemaParity.test.ts
cmp packages/extractor/src/v5/schema/foundation-5.0.0.json apps/landing/schemas/foundation-context/v5.json
npm run typecheck
```

Commit boundary:

```bash
git add docs/specs/foundation-context-v5.md packages/extractor/src/v5/canonical.ts packages/extractor/src/v5/schema/foundation-5.0.0.json apps/landing/schemas/foundation-context/v5.json packages/extractor/src/v5/validate.ts packages/extractor/test/v5/fixtures.ts packages/extractor/test/v5/schemaParity.test.ts packages/extractor/test/v5/canonical.test.ts
git commit -m "fix(v5): state unavailable source metadata and copy annotations honestly"
```

---

## Task 1: Preserve identity, scopes, and failed-source detail at serialization

The source dump already carries collection ids, mode ids, and local variable
ids, but `buildFoundation` drops variable ids and the reader does not expose
scopes or remote provenance. The external inventory also omits an alias target
entirely when its variable cannot be read, which loses the one stable fact the
alias itself did state: its target id.

**Files:**

- Modify `packages/plugin/src/serializeFoundation.ts`
- Modify `packages/plugin/src/main.ts`
- Modify `packages/extractor/src/foundation.ts` (raw interfaces only in this task)
- Modify `packages/plugin/test/serializeFoundation.test.ts`

### Source model

Add these fields, using the exact Figma strings rather than a hand-maintained
subset that can go stale:

```ts
export interface ReaderVariable {
  // existing fields...
  scopes: string[];
  remote: boolean;
}

export interface RawVariable {
  // existing fields...
  scopes?: string[]; // optional only for pre-Phase-2 injected/test dumps
}

export interface RawCollection {
  // existing fields...
  /** Complete declared inventory, including ids whose variable read failed. */
  variableIds?: string[]; // optional only for pre-Phase-2 dumps
}

export interface RawExternalRef {
  id: string;                    // always the alias's stable target id
  name: string | null;           // null when metadata could not be read
  collectionId: string | null;
  collectionName: string | null;
  remote: boolean | null;        // null only when target metadata was unreadable
  external: true;
}

export interface SerializedFoundation {
  // existing fields...
  fileName?: string;
  unavailableSources?: string[]; // absent on a complete read, never []
}
```

Extend the serializer signature without breaking three-argument test callers:

```ts
export async function serializeFoundation(
  reader: FoundationReader,
  fileKey: string,
  extractedAt: string,
  fileName?: string,
): Promise<SerializedFoundation>;
```

Every production call site in `main.ts` passes `figma.root.name`; existing
injected callers may omit it and the field then stays absent.

Keep the existing `unavailable?: FoundationRead[]` section-level signal for
backward compatibility. `unavailableSources` adds exact detail; it does not
replace the coarse field during Phase 2.

### Serialization order and failure policy

1. Read collections.
2. Immediately create `declaredLocalIds` from every
   `ReaderCollection.variableIds`, before any `reader.variable` promise runs.
3. Batch-read local variables in the existing argument order.
4. A failed/null local read adds `variables` to `unavailable` and the declared
   variable id to `unavailableSources`; it does not reclassify the id external.
5. Collect alias target ids from every successfully read raw value.
6. For every target outside `declaredLocalIds`, create one `RawExternalRef`.
   If metadata is readable, fill its stable collection id/name and source
   `remote` flag. If not, keep the target id and null the unavailable fields.
   In both cases `external` is true before any later name/path lookup.
7. Because Phase 2 deliberately does not fetch remote mode/value graphs, add
   the external collection name when known, otherwise the target id, to
   `unavailableSources`.
8. A top-level collections/variables, text-style, or effect-style read failure
   adds the stable sentinel `figma:variables`, `figma:textStyles`, or
   `figma:effectStyles`, respectively, to `unavailableSources` as well as its
   existing section marker.
9. Preserve the existing source ordering for collections/variables/externals.
   De-duplicate and code-unit-sort only `unavailableSources`.
10. Pass `figma.root.name` as `fileName`. Do not add a separate Figma call.

`readVariable` may return a discriminated `{value, available}` result internally
so a `null` can be recorded instead of silently filtered. It must keep catching
both synchronous throws and rejected promises.

### Failure-first tests

Add or update tests proving:

- collection, mode, and variable ids are byte-for-byte unchanged;
- raw `valuesByMode` keys remain mode ids, including two modes with the same
  display name;
- each raw collection retains its complete declared variable-id inventory even
  when one variable read fails;
- scopes reach each `RawVariable` in Figma order;
- `{r: 0.5, g: 0.1, b: 0, a: 0.125}` survives serialization exactly;
- an alias into a later local collection stays local because local inventory
  is complete before reads;
- a local target whose `reader.variable` call fails is still local and lists
  its id as unavailable;
- an unreadable non-local target still produces an external record with its id
  and null metadata;
- a readable external target records `remote`, stable collection id, optional
  collection name, and is not given values;
- an external target whose name/path equals a local token remains external;
- a clean dump omits both optional unavailable fields rather than writing empty
  arrays;
- top-level variables, text-style, and effect-style read failures retain their
  existing section markers.

Run:

```bash
npx vitest run packages/plugin/test/serializeFoundation.test.ts
npm run typecheck
npm run check:sandbox
```

Commit boundary:

```bash
git add packages/plugin/src/serializeFoundation.ts packages/plugin/src/main.ts packages/extractor/src/foundation.ts packages/plugin/test/serializeFoundation.test.ts
git commit -m "feat(foundation): retain source identity scopes and unavailable targets"
```

---

## Task 2: Build one truthful, mode-aware local alias graph

Replace the legacy four-level recursive resolver with a memoized, iterative
resolver keyed by `(token_id, mode_id)`. The output still includes the legacy
flattened `resolved` value used by frames and the v4 brief, but now carries the
full provenance the v5 exporter needs. There must not be two resolution
algorithms that can choose different modes.

**Files:**

- Modify `packages/extractor/src/foundation.ts`
- Modify `packages/extractor/test/foundation.test.ts`
- Modify `packages/extractor/test/narrowFoundation.test.ts`
- Modify `packages/extractor/test/brief.test.ts`
- Modify `packages/extractor/test/contrast.test.ts`
- Modify `packages/extractor/test/colorContrast.test.ts`
- Modify `packages/plugin/test/foundationFrame.test.ts` only where additive
  fields change exact object assertions

### Enriched resolved model and legacy render boundary

Use names that distinguish internal camelCase provenance from both the existing
render model and the v5 snake_case contract:

```ts
export interface FoundationResolutionStep {
  tokenId: string;
  modeId: string;
}

export type FoundationProvenanceLiteral =
  | { kind: 'color'; hex: string; alpha: number; channels?: [number, number, number] }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean };

export type FoundationUnresolvedReason =
  | 'cycle' | 'missing' | 'external' | 'depth' | 'type_mismatch'
  | 'target_mode_unresolvable' | 'target_mode_value_missing'
  | 'invalid_source_value';

export type FoundationProvenanceValue =
  | FoundationProvenanceLiteral
  | {
      kind: 'alias';
      targetId: string;
      targetName: string;       // stable id fallback only when name unavailable
      targetPath: string[];
      targetCollectionId: string | null;
      targetCollection: string;
      external: boolean;
      resolved: FoundationProvenanceLiteral
        | { kind: 'unresolved'; reason: FoundationUnresolvedReason }
        | null;
      chain: FoundationResolutionStep[];
    }
  | { kind: 'unresolved'; reason: FoundationUnresolvedReason };

export interface FoundationVariableProvenance {
  id: string;
  scopes: string[];
  /** Declared modes only; keys are stable source mode ids. */
  valuesByMode: Record<string, FoundationProvenanceValue>;
  /** Raw keys not present in the owning collection's declared modes. */
  staleModeIds: string[];
}

export interface FoundationSourceIssue {
  kind: 'stale_mode_value';
  collectionId: string;
  tokenId: string;
  modeId: string;
  declaredModeIds: string[];
}

export interface FoundationVariable {
  // All existing render fields stay unchanged, including:
  valuesByMode: Record<string, FoundationValue>;
  provenance: FoundationVariableProvenance;
}

export interface FoundationSpec {
  // existing fields...
  sourceIssues?: FoundationSourceIssue[]; // absent on a clean source, never []
}
```

Do **not** add ids, scopes, channels, target ids, or chains to the existing
`FoundationValue` union. It is the legacy/render value read by `unitContent`,
`foundationBrief`, contrast helpers, and frames. `buildFoundation` resolves the
graph once into `provenance.valuesByMode`, then a pure `legacyValueOf` projection
strips channels/ids/chains and produces the existing `valuesByMode` shape. It
maps `cycle`, `depth`, and `external` to their existing legacy reasons and all
new source-integrity failures to legacy `missing`; it never resolves again.
Thus the canvas/v4 path and direct-v5 path cannot select different target modes,
while unrendered metadata remains structurally unreachable from `unitContent`.

`buildFoundation` must always fill `provenance.id` and `provenance.scopes`; a
pre-Phase-2 raw dump with no scopes becomes `[]`, which means metadata
unavailable, not px. Update all in-repo hand-built `FoundationVariable`
fixtures so required provenance is compiler-enforced. This package is private
and all callers are in the monorepo; do not make provenance optional merely to
avoid fixing fixtures.

Carry `fileName` and `unavailableSources` from `SerializedFoundation` to
`FoundationSpec`, with the same absent-not-empty convention. Before resolving
declared modes, compare every raw `valuesByMode` key with the owning
collection's declared mode-id set. Preserve unknown keys in
`provenance.staleModeIds` and append one `FoundationSourceIssue` per key in
code-unit order. Task 4 maps those issues to stable `UNRESOLVED_REFERENCE`
diagnostics before any v5 projection can discard the raw key.

### Literal policy

- Route raw RGBA through `canonicalColor`.
- On success, keep optional `channels` in the provenance literal. The
  `legacyValueOf` render projection copies only `hex` and `alpha`.
- On failure, record provenance `unresolved/invalid_source_value` and legacy
  `unresolved/missing`. The direct exporter in Task 4 owns the structured
  `INVALID_SOURCE_COLOR` diagnostic.
- Use `canonicalNumber` for raw numeric values.
- Strings and booleans pass through unchanged.
- Do not call the old `hex2` clamp; delete it once no caller remains.

### Graph algorithm

Build indexes by raw stable id and by declared local id. Use
`RawCollection.variableIds` to retain the owning collection for an unreadable
local target; an id missing from the successfully read token index is not the
same as an id absent from the file. For a pre-Phase-2 dump where the optional
inventory is absent, derive it from `collection.variables.map(v => v.id)` and
treat any extra target according to the dump's explicit external records; this
keeps legacy in-memory fixtures readable without weakening production capture.
First record every stale raw mode key in `staleModeIds`/`sourceIssues`; do not
attach it to a declared mode or attempt to infer which deleted mode it meant.
Then, for every declared token/mode pair:

1. Missing raw entry -> unresolved `missing`.
2. Literal -> canonical legacy literal.
3. External alias -> one alias record with stable target metadata,
   `resolved: null`, `chain: []`, and no local lookup.
4. Internal alias -> select the target mode using the invariant above and add
   the direct target pair as the first chain step.
5. Continue iteratively until a literal or an unresolved terminal. Memoize the
   terminal and suffix chain for each visited pair before moving to the next
   root. Never clone a growing `Set` per hop.
6. Detect cycles on `(tokenId, modeId)`, not token id alone. Rotate diagnostic
   presentation later in validation; the model only needs an honest unresolved
   result and traversed chain.
7. Compare Figma `resolvedType` at every local hop. `COLOR -> FLOAT`, for
   example, becomes `type_mismatch`; do not trust a corrupt fixture simply
   because Figma normally prevents it.
8. Replace the production `MAX_ALIAS_DEPTH = 4`. Let `pairCount` be the number
   of successfully read local `(token, declared mode)` nodes. The default
   `maxAliasDepth` is `Math.max(1, pairCount + 1)`: an acyclic local chain
   cannot legitimately need more hops than that, so normal source chains are
   complete while corrupt traversal remains bounded by source size. Keep an
   optional positive-integer `buildFoundation(dump, {maxAliasDepth})` override
   for tests/controlled callers. A lower configured limit may produce unresolved
   `depth`; production must never silently fall back to four hops.
9. Store the terminal and full chain in provenance. Derive the flattened legacy
   `resolved` value only through `legacyValueOf`; do not collapse the
   provenance chain.

### Required tests

- `FoundationVariable.provenance.id` and `.scopes` survive build unchanged,
  while `unitContent` contains neither field.
- Two same-named modes with distinct ids retain two distinct values.
- A same-collection chain preserves the mode id at every hop.
- A cross-collection alias uses the exact same-named target mode even when that
  mode is not the target default, and the resolved literal comes from that same
  id. This is the direct-path regression for the stabilization fix.
- With no same-name target mode, the chain uses a valid target default.
- Duplicate exact target mode names make the hop unresolved rather than
  selecting the first.
- Every hop of `A -> B -> C -> literal` appears in order, and `resolved` is the
  terminal literal.
- A cycle is detected by token/mode pair without stack recursion.
- A 5,000-hop fixture completes without a call-stack error and without
  quadratic re-walking. Wrap each fixture's `valuesByMode` in a counting Proxy
  and assert total value reads are bounded by a small constant times the number
  of `(token, mode)` nodes; do not add test instrumentation to the production
  API and do not use a brittle millisecond assertion. Use the production
  source-size-derived default for this test; a separate short-chain test passes
  a deliberately low `maxAliasDepth` to exercise the `depth` terminal.
- Missing target, missing target-mode value, invalid default, type mismatch,
  and configured depth exhaustion each have distinct unresolved outcomes.
- An external alias sharing a local name/path never enters the local graph.
- A lossy source channel retains `channels`; an exactly representable channel
  omits it; an out-of-range channel is not clamped.
- A stale raw mode-id key is retained under `provenance.staleModeIds` and as a
  `FoundationSpec.sourceIssues` entry while remaining absent from legacy
  `valuesByMode`.
- `narrowFoundation` preserves provenance unchanged while its legacy render
  values remain byte-for-byte the same flattened projection as before.

Run:

```bash
npx vitest run packages/extractor/test/foundation.test.ts packages/extractor/test/narrowFoundation.test.ts packages/extractor/test/brief.test.ts packages/extractor/test/contrast.test.ts packages/extractor/test/colorContrast.test.ts packages/plugin/test/foundationFrame.test.ts
npm run typecheck
```

Commit boundary:

```bash
git add packages/extractor/src/foundation.ts packages/extractor/test/foundation.test.ts packages/extractor/test/narrowFoundation.test.ts packages/extractor/test/brief.test.ts packages/extractor/test/contrast.test.ts packages/extractor/test/colorContrast.test.ts packages/plugin/test/foundationFrame.test.ts
git commit -m "feat(foundation): retain complete mode-aware alias chains"
```

---

## Task 3: Share statistics derivation without changing migration output

`normalizeV4` currently owns a private `computeStatistics`. The direct exporter
needs the identical derivation. Two copies would drift the first time Phase 3
adds styles or lifecycle.

**Files:**

- Create `packages/extractor/src/v5/statistics.ts`
- Create `packages/extractor/test/v5/statistics.test.ts`
- Modify `packages/extractor/src/v5/normalize.ts`
- Modify `packages/extractor/src/v5/index.ts`
- Modify `packages/extractor/test/v5/normalize.test.ts`

Move, do not rewrite, the current derivation into:

```ts
export function computeFoundationStatistics(input: {
  collections: CollectionV5[];
  tokens: TokenV5[];
  styles: SemanticPayload['styles'];
  diagnostics: Diagnostic[];
}): Record<string, unknown>;
```

The result remains derived only from finished artifact sections. It must not
receive counters accumulated during extraction. Keep tokens without lifecycle
out of every lifecycle bucket rather than assuming active.

### Required tests

- Exact parity with the current normalizer's statistics for the existing
  synthetic v4 fixture.
- Resolved/unresolved alias counts are by value record, not token count.
- Diagnostic severities, mode count, and style count derive from inputs.
- Input order does not change the result.

Run:

```bash
npx vitest run packages/extractor/test/v5/statistics.test.ts packages/extractor/test/v5/normalize.test.ts
```

Commit boundary:

```bash
git add packages/extractor/src/v5/statistics.ts packages/extractor/test/v5/statistics.test.ts packages/extractor/src/v5/normalize.ts packages/extractor/src/v5/index.ts packages/extractor/test/v5/normalize.test.ts
git commit -m "refactor(v5): share artifact statistics derivation"
```

---

## Task 4: Build the direct FoundationSpec-to-v5 exporter

This is the production contract boundary. It is pure, synchronous, Figma-free,
and consumes the enriched model from Task 2.

**Files:**

- Create `packages/extractor/src/v5/fromFoundation.ts`
- Create `packages/extractor/test/v5/fromFoundation.test.ts`
- Modify `packages/extractor/src/v5/index.ts`
- Modify `packages/extractor/src/v5/diagnostics.ts` only if a genuinely new
  extraction fact cannot use an existing code
- Modify `packages/extractor/src/v5/value.ts`

### Public API

```ts
export interface FoundationExportV5Meta {
  exportId: string;
  generatedAt: string;
  build: string | null;
  libraryEnabled?: boolean | null;
  scope?: { target: 'collection'; collectionId: string };
}

export interface FoundationExportV5Result {
  artifact: FoundationArtifactV5;
  diagnostics: Diagnostic[];
}

export function buildFoundationArtifactV5(
  foundation: FoundationSpec,
  meta: FoundationExportV5Meta,
): FoundationExportV5Result;
```

Do not accept `FoundationSelection`: frame mode/group limits are rendering
concerns. A whole-file copy includes every collection/mode. A collection scope
means the full selected collection plus complete transitive dependency
collections, never a four-column or group-narrowed subset.

If the scoped collection id does not exist, throw a typed/ordinary error before
artifact construction so the plugin can show its existing "collection is no
longer in this file" message. Do not emit a plausible empty artifact.

### Identity and ordering

- `CollectionV5.id = FoundationCollection.id`.
- `ModeV5.id = FoundationMode.modeId`; `order` is the source array index.
- `TokenV5.id = FoundationVariable.provenance.id` and `TokenV5.scopes` comes
  from `FoundationVariable.provenance.scopes` after deterministic de-dup/sort.
- Normalize collection, mode, and token display names to Unicode NFC.
  `CollectionV5.path` is the single normalized collection display-name segment.
  `TokenV5.path` splits the normalized Figma variable name on `/` and normalizes
  every segment to NFC. Preserve empty/non-ASCII segments; diagnostics may flag
  them, but never rewrite them. An alias `target_path` is exactly the target
  token's path when readable and `[]` when external target metadata is not.
- Flatten tokens in collection order then variable order.
- Do not emit `SYNTHETIC_IDENTITY` on this path.
- Emit `CONFUSABLE_NAME` for any collection, mode, or token source name
  containing non-ASCII code points, using the same predicate as migration.
  Anchor a mode finding to its stable mode id. Preserve every name and path;
  the diagnostic never authorizes transliteration.
- Use `validateLevel2` to add duplicate-id, duplicate-mode-id, path-collision,
  reference, cycle, and alias-provenance findings to the artifact diagnostics;
  do not duplicate those algorithms in the exporter.

### Canonical token types and literal values

Map source types as follows:

| Figma type | Scope evidence | v5 type/value |
|---|---|---|
| `COLOR` | any | `color`, via retained canonical colour data |
| `FLOAT` | `numericValue` returns dimension | `dimension`, same unit for every literal/alias snapshot |
| `FLOAT` | `numericValue` returns number | `number` |
| `FLOAT` | `numericValue` returns null | `number` plus `UNIT_METADATA_UNAVAILABLE`; numeric fact retained |
| `STRING` | scope uniquely indicates `FONT_FAMILY` | `font_family` |
| `STRING` | otherwise | `string` |
| `BOOLEAN` | any | `boolean` |

Use the owning token's type/unit to type an alias's resolved snapshot. This
allows a semantic `GAP` variable to alias a generic FLOAT primitive while
still producing a `dimension/px` snapshot for the semantic token. Task 5 makes
the validator treat `number <-> dimension` and `string <-> font_family` as
source-compatible specialization pairs while retaining exact token/value shape
checks.

For every declared collection mode, insert exactly one value:

- literal -> `{kind: 'literal', value: TypedValue}`;
- resolved local alias -> stable reference plus terminal typed value and every
  chain step;
- unresolved local/external alias -> stable facts retained, `value: null`,
  mapped reason, and the honest partial/empty chain;
- missing raw value -> `{kind: 'missing', reason: 'no_value_for_mode'}` plus
  `MISSING_MODE_VALUE`;
- invalid colour -> `{kind: 'missing', reason: 'invalid_source_value'}` plus
  `INVALID_SOURCE_COLOR`.

For every in-scope `FoundationSpec.sourceIssues` stale-mode entry (all entries
for whole-file export; only collections in the selected dependency closure for
a scoped export), and defensively for every included token's
`provenance.staleModeIds` entry missing such an issue, emit one
`UNRESOLVED_REFERENCE` diagnostic anchored to the stable token id and stale raw
mode id, with the owning collection id and declared mode ids in `details`.
Exclude that value; never mint a mode record for it. This consumption happens
before token projection, so the raw fact cannot disappear when the exporter
iterates only declared modes.

Map a selected target mode that exists but has no value to the dedicated
`target_mode_value_missing` unresolved reason. This is different from
`target_mode_unresolvable` (no authoritative mode can be selected) and
`target_not_found` (the target entity itself is unavailable). Add the new member
to `UnresolvedReason` in `value.ts`; update the schema only if it starts/enforces
an enum for this field.

### Scoped dependency closure

A scoped collection artifact must still pass referential integrity for local
aliases. Starting from the requested collection, follow local alias target ids
and include each target's **entire owning collection**; repeat until closed.
Including the whole dependency collection avoids presenting a partial token
list as a complete collection. Preserve original source order after selecting
the closure. Mark `completeness.collections: partial` and add one
`SOURCE_PARTIALLY_UNAVAILABLE` diagnostic describing the requested collection
and included dependency collection ids. Styles are `unavailable` for a
collection-scoped copy.

Do not mutate `FoundationSpec` and do not use `narrowFoundation` for the v5
scope; its legacy contract intentionally drops other collections after aliases
have been flattened, which would leave v5 stable references dangling.

### Completeness

Whole-file collection completeness:

- no variables failure and no unavailable dependency -> `complete`;
- variables marked unavailable with no collections returned -> `unavailable`;
- any local token read failure, external dependency, or stale raw mode-value
  source issue -> `partial`.

Style completeness while Phase 2 emits empty style arrays:

- both style reads succeeded and both source arrays are empty -> `complete`;
- either source array contains styles -> `partial` plus one diagnostic with
  exact text/effect counts (read but not migrated);
- one style family read failed -> `partial`;
- both style family reads failed -> `unavailable`.

`unavailable_sources` is the union of `FoundationSpec.unavailableSources` and
known external library names/ids, deduplicated and code-unit sorted. Intentional
style non-migration is described by completeness/diagnostics but is not called
a failed source.

For a scoped collection copy, collection/style scope truth overrides the
whole-file results as described above. Only stale-mode issues in the selected
dependency closure affect its collection completeness. Keep failed-source ids
in the list.

### Envelope, diagnostics, and statistics

- `source.file_id` is `null` for `''`/`unknown`, otherwise the file key.
- `source.file_name` comes from `FoundationSpec.fileName ?? null`.
- `source.file_version` is `null`.
- `source.library_enabled = meta.libraryEnabled ?? null`.
- `extractor.build = meta.build`.
- The semantic envelope hash is built from the final semantic payload, never
  from diagnostics or statistics.

Use exactly two artifact constructions so Level 2 can inspect a complete shape
while final statistics still count Level-2 findings:

1. Build the final semantic `payload` and the envelope from that payload.
2. De-duplicate and sort extraction/source diagnostics as
   `provisionalDiagnostics`.
3. Compute `provisionalStatistics = computeFoundationStatistics({...payload,
   diagnostics: provisionalDiagnostics})`.
4. Construct `provisionalArtifact` from payload, envelope, provisional
   diagnostics, and provisional statistics. Run `validateLevel1` on it; any
   finding is an exporter programming error and throws before Level 2.
5. Run `validateLevel2(provisionalArtifact)` exactly once. Merge those findings
   with provisional diagnostics, then perform the same exact de-duplication and
   deterministic sort to get `finalDiagnostics`.
6. Recompute `finalStatistics` from payload plus `finalDiagnostics` and rebuild
   `finalArtifact` from payload, the same envelope, final diagnostics, and final
   statistics. Return `{artifact: finalArtifact, diagnostics:
   finalDiagnostics}`; never return the provisional object.

Level 2 must not depend on diagnostic counts or other statistic values, so no
third construction/fixed-point loop is allowed. Tests run Level 1 on the final
artifact and prove that re-running Level 2 on it yields the same finding set as
the one merged in step 5.

Define exact diagnostic de-duplication as equality of
`{code, entity_id, mode_id, canonicalJson(details ?? null)}`. Message wording is
not identity. If two findings share those fields but convey different facts,
fix the `details`; do not keep both by prose accident.

### Required tests

The new test file must include at least:

- stable collection/mode/token ids and rename/move stability;
- duplicate mode display names remaining distinct by id;
- mode-id value keys and explicit missing entries;
- stale raw mode-id issues producing deterministic `UNRESOLVED_REFERENCE`
  findings without an emitted value key, marking in-scope collection
  completeness partial and therefore moving the semantic hash;
- every scope/unit case from `units.test.ts` through the production builder;
- unknown/conflicting scopes producing number + error, never guessed px;
- raw RGBA channel preservation, alpha precision, and invalid-source rejection;
- direct three-hop local chain with every target/mode pair;
- same-name cross-collection target mode differing from default;
- fallback-to-default cross-collection mode;
- external alias with readable metadata, unreadable metadata, no library name,
  and a local path collision;
- cycles, type mismatch, missing target, missing target mode value, depth limit;
- scoped dependency closure and nonexistent-scope failure;
- whole/scoped completeness truth table;
- source order and code-unit-sorted sets;
- two builds with different timestamps/export ids and identical source yielding
  the same semantic hash;
- ids, scopes, channels, alias target, any chain mode, or completeness changing
  the semantic hash;
- `validateLevel1(artifact) === []` for every structurally produced artifact,
  even when `artifact.diagnostics` contains extraction errors.
- provisional statistics are never returned, final diagnostic severity counts
  include Level-2 findings exactly once, and Level 2 over the final artifact
  yields the same finding set used in its construction.

Run:

```bash
npx vitest run packages/extractor/test/v5/fromFoundation.test.ts packages/extractor/test/v5/units.test.ts packages/extractor/test/v5/color.test.ts
npm run typecheck
```

Commit boundary:

```bash
git add packages/extractor/src/v5/fromFoundation.ts packages/extractor/src/v5/index.ts packages/extractor/src/v5/diagnostics.ts packages/extractor/src/v5/value.ts packages/extractor/test/v5/fromFoundation.test.ts
git commit -m "feat(v5): build direct foundation artifacts from stable source identity"
```

---

## Task 5: Validate full chain truth, not only referenced ids

The stabilized Level 2 validator proves that each recorded chain pair exists
and that the first step names the direct target. It does not yet prove that
step 2 is the alias target of step 1, that the chain ends at a literal, or that
the chain chose the mode Figma resolution policy requires, or that the resolved
snapshot equals that terminal literal. Phase 2 must close that gap before the
plugin starts publishing full chains. Validation independently replays mode
selection from collections/modes/references; it never trusts a nested alias's
recorded chain to justify another recorded chain.

**Files:**

- Modify `packages/extractor/src/v5/validate.ts`
- Modify `packages/extractor/test/v5/validate.test.ts`
- Modify `packages/extractor/test/v5/fixtures.ts`
- Modify `packages/extractor/src/v5/schema/foundation-5.0.0.json` only if an
  unresolved-reason enum changed in Task 4
- Modify `apps/landing/schemas/foundation-context/v5.json` whenever that schema
  file changes, preserving byte identity

### Chain replay rules

Build collection-by-id, token-by-id, and mode-by-id indexes once. Define a
validator-local `expectedTargetMode(sourceToken, sourceModeId, targetToken)`
that implements the production policy directly from those indexes:

1. Resolve the source token's owning collection and the source mode record.
2. If source and target collections match, the expected target mode is exactly
   `sourceModeId`.
3. Otherwise find target modes whose display name is exactly the source mode's
   display name. One match wins; more than one is unresolvable.
4. With no exact match, use the target collection's declared default only when
   that id names a mode in that collection. Otherwise it is unresolvable.

Do not call the extractor's resolver helper and do not consult the current or
target alias's own recorded `resolution.chain` while deriving this expected
mode. Shared code would let one bad policy implementation validate itself.

For each resolved internal root alias, replay from the root `(token, mode)`:

1. The chain is non-empty. Derive the expected direct target pair from the
   root reference plus `expectedTargetMode`; require the first step to equal
   both its `target_id` and independently selected mode id.
2. Each step's token owns the step mode and has a value record there.
3. If that step's value is an internal alias, independently derive its expected
   target pair from the step token/mode and direct reference, then require the
   next recorded step to equal it. Never accept the mode merely because the
   nested alias recorded the same wrong mode in its own chain.
4. An ambiguous/invalid expected mode, or an external/unresolved alias, cannot
   occur in the middle of a chain that claims `status: resolved`.
5. The final step is a literal, not an alias, missing record, or extra step.
6. The root resolved typed value is equal to the terminal literal after
   canonical precision and the two allowed owner specializations below. For a
   dimension owner targeting a numeric primitive, re-apply `numericValue` to
   the terminal number with the **root token's scopes** and require exact
   equality with the recorded dimension, including unit. For a font-family
   owner targeting a string primitive, require the same string. The reverse
   specialization compares the same underlying scalar. Every other pair is a
   strict deep equality. Validation never substitutes a different source
   value merely to make a chain pass.
7. A resolved external alias is invalid in Phase 2 and an external unresolved
   alias has an empty chain, because external tokens are not in the artifact.

For an unresolved internal alias, independently derive and validate every
target mode for every chain adjacency that is present, but do not demand a
literal terminal. An empty partial chain is legal when the direct target itself
is missing or no authoritative target mode can be selected.

### Type compatibility

Keep the stabilized Level 1 invariant strict: a token declared `dimension` must
carry a dimension literal/snapshot, never a number value. For alias target
compatibility at Level 2, accept these specialization families:

- `number` <-> `dimension`
- `string` <-> `font_family`

All other target-type differences produce `ALIAS_TYPE_MISMATCH`. Add comments
that Figma aliases enforce raw `FLOAT`/`STRING` compatibility while scopes give
the owner a more specific v5 type; this is not a general coercion rule.

### Failure tests

Mutate a valid artifact one fault at a time and prove Level 2 reports it:

- skipped middle step;
- reordered steps;
- same-collection step uses a different mode id;
- cross-collection step uses the default despite one exact-name match;
- cross-collection step uses a same-named mode when there are duplicate exact
  matches, or skips the valid default when there is no exact match;
- every nested alias is edited to repeat the same wrong mode so its recorded
  chains are mutually consistent; independent replay still rejects them;
- extra step after a literal;
- resolved snapshot disagrees with terminal colour channel/number;
- specialized dimension/font-family snapshot disagrees with the terminal
  scalar, or records a unit the owner's scopes do not support;
- resolved chain terminates at missing/unresolved/external;
- external alias claims a resolved snapshot or local chain;
- `dimension -> number` and `font_family -> string` target specializations pass;
- `color -> number` and `boolean -> string` fail;
- all existing malformed collection/mode/path and hostile Level 1 fixtures
  continue returning diagnostics rather than throwing.

Run:

```bash
npx vitest run packages/extractor/test/v5/validate.test.ts packages/extractor/test/v5/schemaParity.test.ts
cmp packages/extractor/src/v5/schema/foundation-5.0.0.json apps/landing/schemas/foundation-context/v5.json
```

Commit boundary:

```bash
git add packages/extractor/src/v5/validate.ts packages/extractor/src/v5/schema/foundation-5.0.0.json apps/landing/schemas/foundation-context/v5.json packages/extractor/test/v5/validate.test.ts packages/extractor/test/v5/fixtures.ts
git commit -m "fix(v5): verify alias chains against their terminal snapshots"
```

---

## Task 6: Lock hash separation and legacy compatibility

Before user-visible integration, prove the enriched internal model cannot move
the wrong hash or leak ids into the retained v4 projection.

**Files:**

- Modify `packages/extractor/test/foundationHash.test.ts`
- Modify `packages/extractor/test/brief.test.ts`
- Modify comments in `packages/extractor/src/brief.ts`
- Modify comments in `packages/extractor/src/tree.ts`
- Modify `packages/extractor/test/v5/canonical.test.ts`
- Modify `packages/extractor/test/v5/normalize.test.ts`

### Canvas-hash tests

Build two `FoundationSpec` values whose legacy `valuesByMode` projections are
deep-equal and vary only their separate provenance/source fields:

- token id;
- scopes;
- source colour `channels` that produce the same rendered hex/alpha;
- alias target id/collection/path;
- full chain metadata;
- unavailable-source metadata not rendered by the frame.

First assert `unitContent(before, scope)` deeply equals `unitContent(after,
scope)` and contains no `provenance`/source issue keys; then
`foundationContentHash` must remain equal for every pair. Also add a test that
fails if `unitContent` starts spreading a whole `FoundationVariable` instead of
constructing rows field by field. Then change a rendered hex, alpha, label,
description, visible mode name, or legacy resolved value and prove it still
moves. Do not snapshot a new canvas baseline simply because the new model
contains more fields.

### Semantic-hash tests

For the same pairs, `semanticContentHash` must move for id, scopes, preserved
channels, alias reference/chain, or completeness changes. It must not move for
generated time, export id, build id, source envelope metadata, diagnostics
message, statistics, or guidelines.

### Compatibility tests

- `foundationBrief` remains the v4 compatibility/migration API and continues
  keying its legacy value projection by mode display name.
- Its output does not acquire Figma ids, scopes, channels, or full chains.
- `normalizeV4` continues producing synthetic ids and the stabilized external,
  scoped completeness, stale mode, and actual-v4-mode chain behavior.
- Direct v5 output is never passed through `foundationBrief`/`normalizeV4`;
  assert source ids and channels in a direct output as a proof of non-use.
- Update comments that say "internal ids stay inside" so they explicitly name
  the legacy foundation/component-v4 projection. Do not claim that rule for
  v5, and do not imply component v4 now exports ids.

Run:

```bash
npx vitest run packages/extractor/test/foundationHash.test.ts packages/extractor/test/brief.test.ts packages/extractor/test/v5/canonical.test.ts packages/extractor/test/v5/normalize.test.ts
```

Commit boundary:

```bash
git add packages/extractor/src/brief.ts packages/extractor/src/tree.ts packages/extractor/test/foundationHash.test.ts packages/extractor/test/brief.test.ts packages/extractor/test/v5/canonical.test.ts packages/extractor/test/v5/normalize.test.ts
git commit -m "test(v5): separate semantic identity from canvas drift and v4 migration"
```

---

## Task 7: Integrate direct v5 with Foundation Copy for AI

Land the exporter before changing user-visible output. This task is the cutover
point and should be independently revertible.

**Files:**

- Modify `packages/plugin/src/ui/actions.ts`
- Modify `packages/plugin/test/copyFoundation.test.ts`
- Modify `packages/extractor/src/v5/canonical.ts` only if the guideline helper
  was not completed in Task 0

### Build-version wiring

`actions.ts` is a separate TypeScript module from `main.ts`; the declaration in
`main.ts` is not visible here. Add this module-local ambient declaration after
the imports:

```ts
declare const __PLUGIN_VERSION__: string;

const pluginBuild = (): string | null =>
  typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : null;
```

Pass `build: pluginBuild()` in the `FoundationExportV5Meta` for both whole-file
and collection Copy. `typeof` keeps vitest safe when the build-time global is
absent, while the declaration keeps `npm run typecheck` valid. Do not import the
declaration from `main.ts` or substitute `EXTRACTOR_VERSION`; the former is not
a runtime export and the latter answers a different compatibility question.

### Whole-file copy

Replace only the foundation whole-file YAML builder with:

1. one `generatedAt` captured at click time;
2. `buildFoundationArtifactV5(currentFoundationSpec(), meta)`;
3. `build` set through `pluginBuild()` (`__PLUGIN_VERSION__` in bundled code,
   `null` when the build-time global is absent in tests);
4. an export id derived from the source extraction id/time without entering the
   semantic hash (for example `foundation:<fileKey-or-local>:<generatedAt>`);
5. the current non-empty `foundationGroupDescriptions` attached as the optional
   `guidelines` annotation;
6. `toYaml(artifact as unknown as YamlValue)` through the existing clipboard
   tier/large-payload/error path.

Do not reject the copy merely because diagnostics contain errors. Unresolved
external aliases are expected to produce a copy with explicit errors. Reject
only construction/serialization failure, using the existing "Nothing was
copied" error.

### Collection-row copy

For `scope.target === 'collection'`, call the v5 builder with its collection
scope against the **full** `FoundationSpec`, allowing the exporter to add
dependency collections. Filter group descriptions to the requested collection
as today, attach them, and preserve the current stale-collection user error.

Ignore `scope.group` and `scope.modeIds`, as the current Copy contract does;
those remain frame-only limits.

### Text-style-row compatibility path

For `scope.target === 'textStyles'`, retain the existing
`narrowFoundation -> foundationBrief` v4 copy until Phase 3. A v5 artifact with
`styles.typography: []` would copy no requested content and call that a schema
upgrade. Add a code comment and test that make this temporary boundary explicit.
Do not mark acceptance criterion 3 complete in Phase 2.

### Integration tests

- Whole-file Copy parses as schema `5.0.0`, not v4 `version: 4`.
- In vitest, where no build global is defined, `spec_layer.extractor.build` is
  `null`; `npm run typecheck` and `npm run build:plugin` prove the declared
  production global is accepted and replaced by the plugin build.
- It exposes real collection/mode/token ids and mode-id value keys.
- A FLOAT/GAP value copies as `dimension/px`; unknown scope stays number with a
  unit diagnostic.
- A lossy raw colour carries channels.
- A local alias copies its full chain; an external alias remains external even
  when a local path matches.
- Read failures reach completeness/unavailable sources.
- Generated group descriptions remain present and changing them does not change
  content hash.
- A collection row includes internal dependency collections and ignores frame
  group/mode narrowing.
- A text-style row still emits the legacy v4 shape and all current style data.
- Clipboard async/manual tiers, 800-line caveat, no-foundation guard, stale
  collection error, and generate-then-copy description freshness stay intact.

Run:

```bash
npx vitest run packages/plugin/test/copyFoundation.test.ts packages/plugin/test/clipboard.test.ts
npm run typecheck
npm run build:plugin
npm run check:sandbox
```

Commit boundary:

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/test/copyFoundation.test.ts packages/extractor/src/v5/canonical.ts
git commit -m "feat(plugin): copy Foundation Context v5 with stable references"
```

---

## Task 8: Bump the extractor compatibility version once

The enriched `buildFoundation` result and user-visible foundation Copy output
are intentional extraction changes. Bump the opaque compatibility id after the
cutover, not in an earlier preparatory commit.

**Files:**

- Modify `packages/extractor/src/version.ts`
- Modify `packages/extractor/test/fixtures/button-brief.yaml`
- Modify `packages/extractor/test/briefGolden.test.ts` only if its assertion
  names the literal version
- Modify any exact-version plugin tests found by
  `rg -n "EXTRACTOR_VERSION|extractor:.*1" packages`

Change:

```ts
export const EXTRACTOR_VERSION = '2';
```

Update `version.ts`'s comment so it covers both component extraction and
foundation extraction/export. Keep it opaque and equality-compared; do not turn
it into schema semver. Do not change `SCHEMA_VERSION` or `BRIEF_VERSION` in this
task.

The component brief's envelope also includes `EXTRACTOR_VERSION`, and existing
component doc links compare it for rebuild readiness. Task 11 records this
deliberate cross-product consequence in the changelog: after upgrading,
existing component docs may request one rebuild even though their canvas
projection did not change. Do not hide that by special-casing the version
comparison in Phase 2; splitting component/foundation compatibility ids is a
separate contract change.

Run:

```bash
npx vitest run packages/extractor/test/briefGolden.test.ts packages/plugin/test/docLink.test.ts packages/plugin/test/libraryViewModel.test.ts
npm run typecheck
```

Commit boundary:

```bash
git add packages/extractor/src/version.ts packages/extractor/test/fixtures/button-brief.yaml packages/extractor/test/briefGolden.test.ts packages/plugin/test
git commit -m "chore(extractor): bump compatibility version for foundation v5"
```

Before committing, inspect `git diff --cached --name-only`; the broad test path
above must not stage unrelated shared-tree edits.

---

## Task 9: Add reproducible synthetic golden acceptance

The existing synthetic v4 fixture grades the migration path. Phase 2 needs a
separate raw serialized fixture with facts v4 cannot represent.

**Files:**

- Create `packages/extractor/test/fixtures/v5/synthetic-foundation-serialized.json`
- Create `packages/extractor/test/fixtures/v5/synthetic-foundation-direct-v5.yaml`
- Modify `packages/extractor/test/v5/acceptance.test.ts`
- Modify `packages/extractor/test/v5/phaseCoverage.ts`

### Raw fixture contents

Include at minimum:

- two collections with stable ids and two modes each;
- the same mode display names in both collections, with a target default that
  differs from the same-name mode used by one alias;
- a duplicate display-name case with distinct real mode ids;
- colour literals with both exactly representable and lossy channels;
- FLOAT tokens scoped to `GAP`, `FONT_WEIGHT`, and `ALL_SCOPES`;
- a STRING token scoped to `FONT_FAMILY`;
- a three-hop internal alias crossing collections;
- a cycle;
- a readable named external alias, an unreadable/unnamed external alias, and a
  local token whose path collides with the external target;
- one declared mode value missing;
- a non-ASCII/confusable path;
- source text/effect styles present, so the Phase 2 styles completeness
  diagnostic is exercised rather than an empty style array appearing complete.

Use fixed export metadata. Generate the expected YAML only under an explicit
`UPDATE_V5_DIRECT_GOLDEN=1` environment variable, matching the existing golden
pattern. Always review the YAML diff before accepting it.

### Automated acceptance

Assert:

- Level 1 passes the generated artifact;
- expected Level 2/error diagnostics are present and stable;
- ids are raw fixture ids, never `figma-name:`;
- values are keyed by raw mode ids;
- dimensional values have stated units and unknown units remain diagnosed;
- source colour precision is present only when hex is lossy;
- the full local chain and actual chosen target mode match;
- external aliases do not bind to the local collision;
- completeness describes source styles and unavailable dependencies;
- repeated direct builds have one semantic content hash;
- emitted YAML exactly matches the committed golden.

### Acceptance coverage manifest honesty

Represent implementation coverage separately from real-source grading. Extend
each manifest entry with `implementedBy` while retaining `gradedBy`, for example:

```ts
1: {
  criterion: 'six Company DS collections with stable ids',
  implementedBy: 'plan-2',
  gradedBy: 'pending-real-fixture',
},
```

Criteria 1, 2, 4, 5, and 7b get `implementedBy: 'plan-2'` but remain
`gradedBy: 'pending-real-fixture'` until Task 10. The synthetic tests prove the
engine invariant under separately named tests; the existing source-specific
tests remain `it.todo`. Move the combined criterion 3 ("every token and style")
to Plan 3 for both implementation and final grading: Phase 2 can assert token
ids, but cannot truthfully pass the style half while its style arrays are empty.
Keep criteria 9-11 on Plan 3.

Do not delete the Phase 1 v4 normalizer golden or rewrite its expectations to
look like the direct export. Both paths need regression coverage.

Run:

```bash
UPDATE_V5_DIRECT_GOLDEN=1 npx vitest run packages/extractor/test/v5/acceptance.test.ts
git diff -- packages/extractor/test/fixtures/v5/synthetic-foundation-direct-v5.yaml
npx vitest run packages/extractor/test/v5
```

Commit boundary:

```bash
git add packages/extractor/test/fixtures/v5/synthetic-foundation-serialized.json packages/extractor/test/fixtures/v5/synthetic-foundation-direct-v5.yaml packages/extractor/test/v5/acceptance.test.ts packages/extractor/test/v5/phaseCoverage.ts
git commit -m "test(v5): grade direct identity and reference extraction"
```

---

## Task 10: Grade the real Company DS artifact — approval gate

This task is required for the source-specific §21.1 handoff but must not block
Tasks 0-9. It requires a real Figma export and an explicit repository-disclosure
decision from the user.

**Potential file:**

- Create `packages/extractor/test/fixtures/v5/company-ds-foundation-v5.yaml`
- Modify `packages/extractor/test/v5/acceptance.test.ts`

### Stop before committing the fixture

Read the artifact end to end and ask the user to approve committing:

- `source.file_id` (default recommendation: redact to `null`; envelope source
  metadata is outside the semantic hash);
- stable Figma collection/mode/token ids (cannot be redacted without destroying
  the identity acceptance criteria);
- collection, token, and external library names;
- descriptions, code syntax, generated group descriptions, and diagnostics.

If approval is not given, keep the fixture outside the repository and record a
manual acceptance result; do not replace it with invented Company DS data.

### Capture and repeatability

1. Run the Phase 2 plugin against the current Company DS file.
2. Copy the whole foundation artifact twice without editing the file.
3. Confirm the two semantic hashes match even though export ids/timestamps may
   differ.
4. Preserve one reviewed artifact. If `file_id` is redacted, state that exact
   transformation in the fixture header/test comment.
5. Run Level 1 and Level 2 against the committed artifact.

### Grade only real-source claims

- all six collections use stable Figma ids;
- every declared mode has a stable Figma id;
- every token has a stable Figma id (style half remains Phase 3);
- every internal alias has the complete, correct chain;
- the three deprecated external references are unresolved aliases with error
  diagnostics and source metadata where available;
- dimensional floats receive units from extracted scopes without numeric drift;
- the confusable Cyrillic path is preserved/diagnosed;
- repeated export produces the same semantic hash.

If any count/name differs from the spec's expectation, investigate the source
and update the spec/status only with user confirmation. Never edit the fixture
to make a test's expected count true.

Run:

```bash
npx vitest run packages/extractor/test/v5/acceptance.test.ts
npm run check:ci
```

Commit only after approval:

```bash
git add packages/extractor/test/fixtures/v5/company-ds-foundation-v5.yaml packages/extractor/test/v5/acceptance.test.ts
git commit -m "test(v5): grade direct Company DS identity and references"
```

---

## Task 11: Documentation, staged rollout, and final verification

**Files:**

- Modify `docs/specs/foundation-v5-status.md`
- Modify `CHANGELOG.md`
- Modify `packages/plugin/TESTING.md`

### Status handoff

Record:

- the Phase 2 merge commit;
- the direct path and public function name;
- the exact cross-collection mode policy;
- that external libraries are referenced but not value-resolved;
- that style arrays remain Phase 3 and criterion 3 remains open;
- that text-style-only Library Copy remains v4 temporarily;
- the compatibility version bump and component-doc rebuild consequence;
- whether real Company DS acceptance is complete, manually verified, or still
  awaiting fixture approval;
- the Phase 3 starting points, especially source style ids/bindings/publication.

### Safe staged rollout

Use these merge/release stages. Task numbers are executed in numeric order;
"cutover" below means the released behavior, not merely a commit on an
unreleased review branch:

1. **Model stage:** Tasks 0-6 land with the plugin still copying v4. Run the
   entire suite and independently review graph policy, completeness, and hash
   separation.
2. **Integration branch stage:** Tasks 7-8 switch whole/collection copies and
   bump the extractor version on the unreleased review branch. Do not combine
   unrelated UI, renderer, dependency, or release work.
3. **Synthetic acceptance gate:** Task 9 lands and the committed direct golden
   is reviewed as a document, not only as a passing snapshot. The cutover may
   not be merged or released until this gate passes.
4. **Manual Figma gate:** Run the matrix below against that development plugin
   build before release.
5. **Real-fixture stage:** Task 10 lands only with disclosure approval; its
   absence must remain visible in status, not silently replaced by synthetic
   coverage.

Rollback is a code release reverting the Task 7 Copy call sites to
`foundationBrief`; do not change schema/hash functions or delete direct fixtures
as a rollback mechanism. A copied v5 artifact already in users' hands remains
valid even if the UI temporarily returns to v4.

### Manual Figma matrix

| Scenario | Expected result |
|---|---|
| Whole-file Copy, ordinary local file | v5 YAML; raw ids; every mode-id value; Level 1 valid |
| Collection Copy with cross-collection aliases | Selected collection plus dependency collections; no dangling local refs |
| Text styles Library-row Copy | Legacy v4 style payload until Phase 3, explicitly verified |
| External library enabled and readable by id | External stable metadata retained; value unresolved; error diagnostic |
| External library unavailable/deprecated | Target id retained, optional metadata null, unavailable source listed |
| Local variable read failure | Local id not mislabeled external; collections partial/unavailable |
| Two modes share a display name | Both survive under distinct ids; no value overwrite |
| GAP and FONT_WEIGHT floats | `dimension/px` and `number`, respectively |
| ALL_SCOPES float | Number preserved; unit-unavailable diagnostic; no name guess |
| Half-channel colour | Hex plus source channels; repeated Copy has same semantic hash |
| Invalid/corrupt colour fixture | Missing + diagnostic; never clamped black/white |
| Alias cycle/depth exhaustion | Artifact copied with unresolved record/error; UI does not crash |
| Existing generated group descriptions | Present under generated guidelines; hash unchanged if only prose changes |
| Large payload/manual clipboard tier | Existing size caveat and fallback modal remain correct |

### Verification commands

Run task-local tests during implementation, then the following without piping
any command (a pipe can mask the failing exit code):

```bash
npx vitest run packages/extractor/test/v5
npx vitest run packages/extractor/test/foundation.test.ts packages/extractor/test/foundationHash.test.ts packages/extractor/test/narrowFoundation.test.ts packages/extractor/test/brief.test.ts packages/extractor/test/briefGolden.test.ts
npx vitest run packages/plugin/test/serializeFoundation.test.ts packages/plugin/test/copyFoundation.test.ts packages/plugin/test/foundationFrame.test.ts packages/plugin/test/docLink.test.ts packages/plugin/test/libraryViewModel.test.ts
npm run lint
npm run typecheck
npm run check:nul
npm test
npm run test:coverage
npm run build:plugin
npm run check:sandbox
npm run check:proxy-dry-run
npm run audit:production
npm run check:ci
cmp packages/extractor/src/v5/schema/foundation-5.0.0.json apps/landing/schemas/foundation-context/v5.json
```

Also inspect:

```bash
git diff --check
git status --short
git diff --stat <phase-2-base>...HEAD
rg -n "localeCompare|foundationContentHash|specContentHash" packages/extractor/src/v5 packages/extractor/src/hash.ts
rg -n "foundationBrief\(|normalizeV4\(" packages/plugin/src packages/extractor/src
```

The first search must show no `localeCompare` under `src/v5`. The second must
show production foundation Copy calling the direct builder, with
`foundationBrief` retained only for compatibility/component and the temporary
text-style-only path. Review the final YAML golden line by line before calling
Phase 2 complete.

Commit boundary:

```bash
git add docs/specs/foundation-v5-status.md CHANGELOG.md packages/plugin/TESTING.md
git commit -m "docs(v5): hand off stable identity and reference extraction"
```

---

## Final review checklist

- [ ] Direct production export never round-trips through v4.
- [ ] Raw Figma ids are unchanged and names/paths are NFC-normalized separately.
- [ ] Values are keyed only by declared mode ids.
- [ ] Stale raw mode-id keys survive as source issues and deterministic
      diagnostics; they are never silently dropped or attached to another mode.
- [ ] Exact-name cross-collection mode selection and fallback are both tested;
      chain mode and resolved snapshot always agree.
- [ ] Level 2 independently replays same-collection, exact-name, and default
      mode selection without trusting recorded nested chains.
- [ ] Externality is established from complete local-id inventory before graph
      lookup; unnamed/path-colliding externals remain external.
- [ ] Full chain adjacency and terminal snapshot are validated.
- [ ] Scopes are the only unit evidence; unknown scope remains unknown.
- [ ] Source RGBA precision survives and invalid channels are rejected.
- [ ] Completeness distinguishes successful empty, partial, unavailable, and
      intentionally scoped exports.
- [ ] Level 1 accepts every produced shape before Level 2 runs; neither throws.
- [ ] `semanticContentHash` changes for every semantic Phase 2 fact and ignores
      all declared volatile/non-semantic fields.
- [ ] Token provenance is outside the legacy render projection;
      `foundationContentHash` and `specContentHash` implementations and rendered
      baselines are unchanged.
- [ ] The production alias limit is source-size-derived (not four); the 5,000-hop
      default-path test and configured-low-limit failure test both pass.
- [ ] Provisional statistics are replaced after Level 2; returned statistics
      count final diagnostics exactly once.
- [ ] Extractor and landing JSON Schemas are byte-identical.
- [ ] `normalizeV4` stabilization tests still pass.
- [ ] Whole/collection Copy is v5; text-style-only Copy remains explicitly v4.
- [ ] `actions.ts` declares `__PLUGIN_VERSION__` locally and passes its safe
      build/null value on whole and collection exports.
- [ ] Generated group descriptions survive cutover outside the semantic hash.
- [ ] `EXTRACTOR_VERSION` changed once; schema and brief versions did not drift.
- [ ] Criterion 3 is still open for style ids; no empty-array vacuous pass.
- [ ] Synthetic golden is reproducible; real Company DS claims are graded only
      from an approved real artifact.
- [ ] Full checks, plugin build, sandbox scan, production audit, and manual Figma
      matrix pass.
