# Foundation Context v5 — Phase 3: composite styles

**Goal:** Export useful, stable typography and effect-style composites from the
same `FoundationSpec` that feeds canvas docs, then move text-style Library Copy
from the legacy v4 projection to the compact v5 AI profile.

**Architecture:** Preserve one source read and separate projections. New source
facts live beside the legacy text/effect style fields so existing canvas hashes
and v4 briefs do not change. The direct v5 exporter is the only consumer of
stable style ids and binding ids.

## Figma API audit

The implementation targets `@figma/plugin-typings@1.128.0`.

| Fact | Figma API evidence | Export decision |
|---|---|---|
| Stable style id | `BaseStyleMixin.id` | Required for emitted v5 styles |
| Text property bindings | `TextStyle.boundVariables` | Preserve exact variable id per property |
| Effect property bindings | Each `Effect.boundVariables` | Preserve layer index and property; do not use the lossy style-level id array |
| Collection/token publication | `hiddenFromPublishing` + `getPublishStatusAsync()` | Emit the complete publication pair when status reads successfully |
| Style publish status | `getPublishStatusAsync()` | Carry internally, but omit v5 publication because hidden state is unavailable |
| Remote state | `remote` | Emit source state with unavailable fields as `null` |
| Style consuming mode | Not exposed | Emit `mode_id: null`; never select a default |
| Lifecycle/archive evidence | Not exposed for local style enumeration | Omit lifecycle; never infer from names |
| Library file/name/modified time | Not exposed on local styles | Keep explicit `null` source fields and partial style completeness |

## Tasks

### 1. Preserve source facts

- Add optional publication metadata to raw collections and variables.
- Add stable ids, source status, and exact binding ids to raw text styles.
- Add stable ids, source status, and exact layer/property binding paths to raw
  effect styles.
- Keep existing name-based binding fields unchanged for v4 compatibility.

### 2. Export typography

- Emit stable identity, segmented path, description, and source state.
- Emit font family, weight, size, line height, letter spacing, paragraph
  spacing, paragraph indent, text case, and decoration.
- Preserve each binding id and readable target path beside the resolved style
  snapshot.
- Map only unambiguous font-style labels to numeric CSS weights.
- Leave automatic line height and unknown font weights unresolved with a
  diagnostic instead of guessing.

### 3. Export effects

- Preserve supported shadow/blur order and distinguish all four v5 kinds.
- State pixel units for every geometry field.
- Preserve exact bindings as `effects[n].property -> token_id`.
- Keep `mode_id: null` because no consumer mode is exposed.
- Compare a bound token with the style snapshot only when every token mode has
  one identical resolved value; otherwise do not manufacture drift.
- Diagnose progressive metadata and newer unsupported effect kinds rather than
  silently treating them as simpler effects.

### 4. Cut over Copy for AI

- Whole-file Copy includes typography and effects.
- Collection Copy remains collection-scoped with transitive alias dependencies.
- Text-style Library Copy includes all typography styles plus only collections
  required by bound property tokens.
- The compact AI profile remains downstream of the validated canonical
  artifact and retains its semantic hash.

### 5. Acceptance and handoff

- Extend the direct synthetic fixture and reviewed golden with stable style ids,
  typography bindings, ordered effects, publication facts, and binding drift.
- Keep real Company DS grading separate because the real artifact is not
  committed.
- Record lifecycle as unavailable under the current Plugin API; do not claim
  acceptance criterion 9 from synthetic name inference.
- Run the complete repository quality gate and the manual Figma Copy matrix
  before release.

## Invariants

- Do not change `specContentHash` or `foundationContentHash` inputs.
- Do not route the direct exporter through v4.
- Do not infer mode, publication flags, lifecycle, or library metadata.
- Do not use a style display name as identity.
- Do not use the style-level effect binding array when layer/property bindings
  are available.
- Keep the extractor and landing JSON Schemas byte-identical.
- Keep `EXTRACTOR_VERSION = '2'`: this phase changes clipboard/canonical output,
  not connected canvas output, and the shared identifier would otherwise mark
  every component document for rebuild.
