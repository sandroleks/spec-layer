# Brief resolution fidelity

**Date:** 2026-08-25
**Status:** Proposed (revised after review)
**Packages:** `packages/extractor`, `packages/plugin`
**Builds on:** `2026-08-18-copy-for-ai-v2-design.md`, `2026-08-23-foundation-row-copy-design.md`

## Summary

The YAML brief stops emitting values it cannot back and stops leaving gaps
unexplained. The change has two phases:

**Phase A — reference identity.** Bindings stop being bare names. A binding
carries the Figma id, what kind of thing it names, and whether Figma says it is
remote. That identity survives minimization instead of being flattened to a
string. Nothing in the output changes.

**Phase B — output.** Effect styles and effect layers become real extracted
data, every remaining `{}` is replaced by a status derived from Phase A's
identity rather than inferred from a failed lookup, external aliases name their
collection, colour alpha loses its float noise, and the empty containers either
go away or say why they are empty.

A gates B. `BRIEF_VERSION` 3 to 4 lands with B.

## Problem

A real export of a working design system produced these three lines in one
component brief:

```yaml
Focused/Primary: {}
Focused/Error: {}
color/surface/primary/opacity-focus: {}
```

Nothing distinguishes them. They have three different causes and the brief
reports all three identically.

### A binding is a name, and a name cannot be resolved

`TokenRef` is `{ property, token }` (`tree.ts:43`). The resolver that produces
it returns `v?.name ?? null` (`main.ts:41`) and `s?.name ?? null`
(`main.ts:49`), discarding the id, the collection, and `remote`.

Figma answers the question directly. `Variable.remote` (`plugin-api.d.ts:10591`)
and `PublishableMixin.remote` (`plugin-api.d.ts:8224`, inherited by every style)
state whether a resource comes from a library. The extractor throws that away
and is then forced to guess from a failed lookup.

Absence from local foundation data has at least six causes, and name-only
resolution collapses them into one:

- the resource is genuinely remote;
- the variables or styles API read failed (`serializeFoundation` catches and
  returns an empty foundation);
- the foundation snapshot is stale, since `main.ts` caches the dump per session;
- `narrowFoundation` excluded the collection;
- the resource kind has no extracted table at all, which is the case for paint
  styles;
- two local resources share a name.

### The kind of thing a name refers to is discarded, then guessed

`serialize.ts` knows the answer where it builds each binding: `boundVariables`
entries are variables, `*StyleId` reads are styles, and `getStyleByIdAsync`
returns the style's `type`. None of it survives.

The consequence is recorded as a known limitation at `tokens.ts:100`: a binding
on the `effects` property "can carry a drop/inner shadow OR a layer/background
blur", and the property map "has no access to the effect's actual type, so it
cannot tell which one it is looking at".

It is worse for paint styles. `fillStyleId` and `strokeStyleId` produce
bindings (`serialize.ts:101,105`) for which no extracted table exists anywhere,
so no lookup can ever succeed and no honest result is currently possible.

### Identity does not survive minimization

Even a `kind` added to `TokenRef` would not reach the brief. `normalizeBindings`
reduces bindings to `Map<string, string[]>` of property to token NAMES
(`tokens.ts:205`) and re-emits fresh `{ property, token }` objects
(`tokens.ts:214`). `extractTokens` then stores `Map<string, Set<string>>` keyed
`path` and `property` (`tokens.ts:329`). Every stage flattens to a string.

`tokens.used` is keyed by name alone, so a variable and an effect style sharing
a name cannot both be represented.

### Effects are bound but never defined

`serialize.ts:108` turns `effectStyleId` into a binding carrying the style's
NAME. Nothing extracts what the style contains. `FoundationSpec` has
`textStyles` and no equivalent, so `lookupToken` (`brief.ts:328`) walks
variables, finds nothing, and returns `{}`.

This is the defect already fixed for typography, where `tokensOf` special-cases
the binding into `{ kind: 'typography' }` (`brief.ts:412`) because a bare `{}`
"tells a reader nothing while implying the token could not be resolved".
Effects never got that treatment, and unlike typography have no second block to
redirect to. The data was never read.

### Effect layers are lost whether they are bound or not

`serialize.ts:37` types effects as `Array<{ type: string }>` and reads only
`.length` (`serialize.ts:136`).

Node-level `boundVariables.effects` is declared `VariableAlias[]`
(`plugin-api.d.ts:5742`) — a flat array with no field or layer identity — while
the real per-field bindings sit on each effect object:
`VariableBindableEffectField = 'color' | 'radius' | 'spread' | 'offsetX' |
'offsetY'` for shadows (`plugin-api.d.ts:4104`), `radius` alone for blurs
(`plugin-api.d.ts:4166`).

Because `effectsBound` is `'effects' in bv || effectStyleId`
(`serialize.ts:137`), a shadow with a variable-bound colour and hardcoded
radius, offset and spread counts as fully bound. No gap is raised, the variable
name is emitted with no indication of what it binds, and every remaining
geometry value is silently dropped.

A fully hardcoded effect fares no better: it produces `missing-token-binding` on
`effects` with no `value` (`tokens.ts:612`), while a hardcoded FILL reports its
hex. This is why an Input Field with thirteen unbound values is not actionable:
some rows carry their measured value and some carry nothing, with no marker
separating the two.

### External aliases name a target that may or may not be the one you can see

In a real Foundation collection:

```yaml
- name: colors/gray/200
  values: { Mode 1: "#c9cdd4" }
- name: colors/chart/chartNeutral
  values: { Mode 1: { alias: colors/gray/200, external: true } }
```

The alias is correct — this file consumes a library with its own
`colors/gray/200` — but the payload prints a name matching a local token of
different identity, with nothing to separate them. In one Mapped Colors export,
13 external target names also exist locally and 4 do not. The same brief holds
both of these:

```yaml
- name: color/chart/chartDarkPink
  values: { Light: { alias: colors/data/data-3, resolved: "#af3e8b" } }
- name: color/chart/chartRose
  values: { Light: { alias: colors/data/data-3, external: true } }
```

The separating information already exists end to end. `FoundationValue` carries
`targetCollection` (`foundation.ts:74`), `resolveValue` populates it
(`foundation.ts:365`), `main.ts:132` implements the reader that supplies it, and
`valueOf` drops it (`brief.ts:70`).

### Colour alpha carries float noise

```yaml
values: { Mode 1: { hex: "#007fff", alpha: 0.03999999910593033 } }
```

Twenty tokens in one collection ship values like this. `round2` exists at
`brief.ts:541` with a comment describing exactly this failure — "Emitted raw, an
agent reproduces the noise verbatim in generated CSS" — and is applied only
inside `typographyOf`. `serialize.ts:143` already settled the precision
question for the same class of number: "Four decimals is well past anything
Figma's own percent field can express."

### Two empty containers explain nothing

`source: {}` appears whenever Figma exposes no file key. `fileKeyOf`
(`brief.ts:59`) correctly refuses to emit the literal `unknown`; the caller
spreads the empty result into a key anyway.

`text_styles: []` appears on every collection-scoped copy, because
`narrowFoundation` sets it (`foundation.ts:150`). It reads as "this file has no
text styles". It means "this copy does not cover them".

## Principles

**Ask Figma, do not infer.** Where the API states a fact — `remote`, a style's
`type`, an effect's `type` — carry the fact. A status derived from a failed
lookup is a guess wearing a status's clothes.

**Say why, or say nothing.** An absent key is honest. An empty container is
not, because it reads as a measured verdict.

**Never truncate silently.** An effect shape we do not model is reported as
unmodelled, not dropped.

**No unreachable statuses.** A status that cannot occur on a given path is not
in that path's vocabulary.

**Additive detail stays out of the drift baseline.** A change that alters no
rendered output must not mark committed documents as drifted. Already enforced
for `figmaFileName`, `path`, and `rawValues`, each with a comment stating why.

## Non-goals

- **No paint-style extraction.** Paint styles get an honest `not-extracted`
  status and a `paint-style` kind. Building the table is a separate change.
- **No `readiness` block or aggregate score.** `validate.ts:4`: "a number with
  no defined arithmetic that tells an agent it may generate without human
  review is worse than no number."
- **No `info` severity.** `validate.ts:8`: "A finding nobody should act on
  should not be emitted at all."
- **No code-name validation.** Needs a diagnostics channel the foundation brief
  does not have.
- **No variable `scopes` extraction.**
- **No effect swatches on canvas.** See *Hash safety*.
- **No `effects` to `box-shadow` mapping.** Capturing the effect type finally
  makes the `tokens.ts:100` decision possible, but that is a property-naming
  change.
- **No payload profiles.** The v3 contrast removal already took out the bulk
  that motivated the request.

---

# Phase A — reference identity

No output changes. Every step here is covered by a test asserting byte-identical
briefs and hashes.

### A1. The resolver returns identity, not a name

`NodeResolver` widens:

```ts
export interface ResolvedVariable {
  id: string; name: string; remote: boolean; collectionId: string;
}
export interface ResolvedStyle {
  id: string; name: string; remote: boolean;
  kind: 'paint-style' | 'text-style' | 'effect-style' | 'grid-style';
}
interface NodeResolver {
  variable(id: string): Promise<ResolvedVariable | null>;
  style(id: string): Promise<ResolvedStyle | null>;
}
```

`kind` maps from `BaseStyle.type` (`PAINT`, `TEXT`, `EFFECT`, `GRID`). The
existing `try/catch` returning null on failure is unchanged.

### A2. `TokenRef` carries identity

```ts
export interface TokenRef {
  property: string;
  /** Figma id. Drives resolution. Never emitted: the brief's rule is that
   *  internal ids stay inside. */
  id: string;
  /** Display and join identity, as `token` was. */
  name: string;
  kind: 'variable' | 'paint-style' | 'text-style' | 'effect-style';
  /** Figma's own answer (Variable.remote / PublishableMixin.remote), not
   *  inferred from a failed lookup. */
  remote: boolean;
  /** Variables only. */
  collectionId?: string;
}
```

`token` is renamed `name`. Both `TokenRule` and `Gap` follow.

### A3. Identity survives minimization

`normalizeBindings` operates on whole refs. Its internal maps key on

```ts
const refKey = (r: TokenRef): string => `${r.kind}|${r.id}`;
```

and `emit` carries the ref through rather than reconstructing
`{ property, token }`.

`extractTokens`'s per-variant map becomes `Map<string, Map<string, TokenRef>>`,
outer key path-and-property, inner key `refKey`, so two refs sharing a name stay
two refs.

**The composite keys stop using NUL.** `tokens.ts:329` and its readers use
`` `${path}\0${property}` ``. `brief.ts:285` abandoned exactly this idiom —
"An earlier version of this file used a NUL byte, which is invisible in a diff
and evades every check in the repo" — and `npm run check:nul` exists because it
has bitten this repo repeatedly. Adding a third component is the moment to move
to a structured key, not to add a third NUL.

### A4. Narrowing records itself

`narrowFoundation` returns a spec marked with what it covers:

```ts
interface FoundationSpec {
  /** Present only on a narrowed spec. Lets a resolver distinguish
   *  "excluded by scope" from "not present locally". */
  narrowedTo?: FoundationCopyTarget;
}
```

### A5. A failed foundation read is recorded

`serializeFoundation` currently catches API failure and returns an empty
foundation, making total failure indistinguishable from a file with no
variables. It records the failure instead:

```ts
interface SerializedFoundation {
  /** Which reads failed. Empty on a clean read. */
  unavailable?: Array<'variables' | 'textStyles' | 'effectStyles'>;
}
```

This is a prerequisite for the `unavailable` status, not a nicety.

### A6. Hash guards land with Phase A

Before any of A1 to A5 merges, three tests assert the baselines do not move.
See *Hash safety*.

---

# Phase B — output

### B1. Effect layers: the complete union

Figma's `Effect` is nine concrete shapes, not four: `BlurEffect` and
`NoiseEffect` are themselves unions (`plugin-api.d.ts:4203,4284`).

```ts
type EffectLayer =
  | { type: 'drop-shadow' | 'inner-shadow'; visible: boolean; blendMode: string;
      color: Rgba; offset: Vec2; radius: number; spread?: number;
      showShadowBehindNode?: boolean; bindings?: EffectBindings }
  | { type: 'layer-blur' | 'background-blur'; blurType: 'normal';
      visible: boolean; radius: number; bindings?: { radius?: TokenRefOut } }
  | { type: 'layer-blur' | 'background-blur'; blurType: 'progressive';
      visible: boolean; radius: number;
      startRadius: number; startOffset: Vec2; endOffset: Vec2;
      bindings?: { radius?: TokenRefOut } }
  | { type: 'noise'; noiseType: 'monotone' | 'duotone' | 'multitone';
      visible: boolean; blendMode: string; color: Rgba; noiseSize: number;
      density: number; secondaryColor?: Rgba; opacity?: number }
  | { type: 'texture'; visible: boolean; noiseSize: number;
      noiseSizeVector?: Vec2; radius: number; clipToShape: boolean }
  | { type: 'glass'; visible: boolean; radius: number; lightIntensity: number;
      lightAngle: number; refraction: number; depth: number; dispersion: number }
  | { type: 'unknown'; figma_type: string };
```

**`radius` is not universal.** `NoiseEffectBase` has no radius field
(`plugin-api.d.ts:4207`). The union reflects that rather than fabricating one.

**Unknown types are reported, not dropped.** Noise, texture and glass are recent
additions; a runtime can hand us a `type` this union does not model. The
serializer emits `{ type: 'unknown', figma_type: <the raw string> }` so a shape
we cannot describe is still visible. Silently dropping it would reintroduce the
truncation this spec exists to remove.

**Bindings attach to their field, not to the layer.** Only shadows and blurs
bind variables; noise, texture and glass declare `boundVariables?: {}`
(`plugin-api.d.ts:4241,4319,4360`).

`alpha` rounds on the 4-decimal rule of B6; geometry rounds to 2 decimals.

### B2. Effect styles reach the foundation

Mirrors `textStyles` at every layer: `FoundationReader.effectStyles()` wrapping
`figma.getLocalEffectStylesAsync()`, `RawEffectStyle` on
`SerializedFoundation`, `FoundationEffectStyle` on `FoundationSpec` carrying
`group` from `groupOf`.

```yaml
effect_styles:
  - name: Focused/Primary
    effects:
      - type: drop-shadow
        color: { hex: "#722ed1", alpha: 0.2 }
        offset: { x: 0, y: 0 }
        radius: 4
        spread: 2
        visible: true
```

`narrowFoundation` treats them as it treats text styles, and B7 says so.

### B3. Inline effect layers, with per-field bindings

`serialize.ts` widens its `effects` read to the full layer shape and emits
`effects?: EffectLayer[]` on `SerializedNode` **whenever the node has effects
and no effect style** — not only when nothing is bound. Per-field bindings are
read from each effect's own `boundVariables` and resolved through A1.

`IntermediateSpec` gains `nodeEffects: NodeEffects[]`, where `NodeEffects` is
`{ part, path, effects: EffectLayer[] }`.

`componentBrief` emits them under the path's entry:

```yaml
effects_inline:
  - path: Container/Wrapper
    layers:
      - type: drop-shadow
        radius: 4
        offset: { x: 0, y: 2 }
        spread: 0
        color: { hex: "#000000", alpha: 0.08 }
        bindings:
          color: color/shadow/default
```

Layers are inline here, unlike the style entries in B4, because a node-level
effect has no style name to point at.

**`hasUnboundEffect` keeps its exact current semantics.** It is what
`tokens.ts:612` keys the gap on, and `gaps` is inside `specContentHash`
(`hash.ts:53` keeps `property` and `value` deliberately). Changing when the flag
fires would move the hash. The richer data rides the hash-excluded channel
instead, so a partially bound layer becomes visible without any committed
document drifting.

**Join on `(path, property)`, never on `path` alone.** One node routinely has
several unbound rows — fill, border, effects, spacing — at the same path.

### B4. `resolution` replaces every bare `{}`

`tokens.used` becomes a LIST, not a map. A map keyed by name cannot hold a
variable and an effect style that share one, and a conditional key that only
qualifies on collision is the kind of thing that bites later.

```yaml
tokens:
  used:
    - token: color/surface/primary/default
      kind: variable
      resolved: "#722ed1"
      code: { WEB: "--color-surface-primary-default" }
      mode: Light

    - token: color/surface/primary/opacity-focus
      kind: variable
      resolution:
        status: external
        reason: Figma reports this variable as belonging to a library.

    - token: "Paragraph/S: 14px Medium"
      kind: text-style

    - token: Focused/Primary
      kind: effect-style

    - token: Brand/Card
      kind: paint-style
      resolution:
        status: not-extracted
        reason: paint style definitions are not extracted.

  bindings:
    - path: Container
      property: fill
      token: color/surface/primary/default
      kind: variable
```

Bindings carry `kind` and join to `used` on `(token, kind)`.

**A style entry is a pointer, not a copy.** The brief already works this way for
typography: `tokens.used` carries the kind and the metrics live in
`typography:`. Inlining would give the brief two owners for the same values,
the failure `componentBrief` already guards against for `unbound` versus
`tokens` ("Emitting both makes the brief contradict itself"). So the component
brief gains an `effects:` block beside `typography:`, keyed by style name:

```yaml
effects:
  Focused/Primary:
    source_name: Focused/Primary
    layers:
      - type: drop-shadow
        color: { hex: "#722ed1", alpha: 0.2 }
        offset: { x: 0, y: 0 }
        radius: 4
        spread: 2
        visible: true
```

`kind: 'typography'` becomes `kind: 'text-style'` so the style kinds share a
vocabulary. Breaking change to an emitted value, covered by the version bump.

### B5. Six statuses, each from a stated fact

| status | decided by |
|---|---|
| `external` | `remote: true` from Figma. Not inferred. |
| `not-extracted` | `kind` is `paint-style`. No table exists to look in. |
| `unavailable` | A5 recorded that read as failed. |
| `not-in-snapshot` | Local, not remote, absent from the cached foundation. |
| `not-in-scope` | `narrowedTo` excludes it. Foundation brief only. |
| `no-foundation` | The caller passed none, as the drift path does. |

`not-in-snapshot` exists because `main.ts` caches the foundation dump per
session, so a variable created after that read is local and absent. It is
actionable — re-read the foundations — and distinct from every other case.

`not-in-scope` is absent from the component vocabulary: `componentBrief` always
receives the unnarrowed `currentFoundationSpec()` (`actions.ts:512`), so it
cannot occur there.

There is deliberately **no `missing`**. A binding's name comes from Figma
resolving a real id, so a name pointing at nothing is unreachable, and the
codebase's rule is not to emit findings that cannot occur.

`typographyOf`'s `{ unresolved: 'not in this file' }` (`brief.ts:560`) is
restated in this vocabulary.

### B6. Alias collection, and alpha rounding

`valueOf`'s alias branch emits the `targetCollection` it is already given,
omitted when `readCollectionName` yielded `''`:

```yaml
values:
  Mode 1: { alias: colors/gray/200, external: true, collection: Core Palette }
```

Local aliases keep their shape; a local alias already resolves, so naming its
collection adds a line without adding information.

`valueOf`'s colour branch rounds `alpha` to 4 decimals, matching
`serialize.ts:143`. Two is not enough: `0.04`, `0.08` and `0.12` survive it, but
Figma's percent field can express `0.125`. A shared `roundN(n, places)` replaces
the two literals.

### B7. `source`, `text_styles`, and a `scope` block

`foundationBrief` omits `source` entirely when `fileKeyOf` returns nothing. The
component brief's `source` always carries `node_id` and `node_name` and is
unchanged.

`text_styles` and `effect_styles` are omitted when empty. A narrowed copy states
what it covers:

```yaml
scope:
  collections: [Mapped Colors]
  text_styles: excluded
  effect_styles: excluded
```

A whole-file copy has no `scope` key. `copyFoundationBriefForScope` passes the
scope; `copyFoundationBrief` does not. Neither changes what it covers —
`actions.ts:643` keeps its documented doctrine.

## Hash safety

Three baselines could move. None do, and each is guarded by a test that lands
in Phase A before the change it protects.

**Component drift.** `specContentHash` hashes `IntermediateSpec` and projects
tokens through an explicit allowlist (`hash.ts:45`). Today that allowlist reads
`{ part, property, conditions, token }`. A2 renames `token` to `name`, so **the
projection must be updated to emit the old key from the new field** — otherwise
every committed document drifts on a rename that changes no content. This is
the single highest-risk line in the change.

`nodeEffects` is destructured out of the hash beside `rawValues`
(`hash.ts:34`), which carries the identical contract: "Additive: never included
in the Markdown spec (content_hash stability)."

`Gap` gains identity fields under the same rule, and `hasUnboundEffect` keeps
its current firing conditions so `gaps` content does not change.

**Foundation drift.** `unitContent` builds explicit row objects
(`foundation.ts:668`), so `effectStyles` cannot leak in. This is why effect
styles are clipboard-only here: the invariant is that fields in that projection
are both rendered and hashed, so putting effects on the canvas means putting
them in the hash.

**The brief is never hashed.** `componentBrief` is called only at
`actions.ts:512`; `foundationBrief` at `actions.ts:656` and `:724`. Brief shape
changes freely.

## What this does not change

- Canvas rendering, in either frame family.
- Which collections or modes any copy covers.
- `validate` findings, their ids, or their severities.
- AI prose, prompts, or cache keys.
- The proxy.

## Testing

**Phase A regression guards, written first and expected to stay green
throughout A:**

- `specContentHash` byte-identical across the whole of Phase A, including the
  `token` to `name` rename.
- `unitContent` byte-identical for a `FoundationSpec` gaining `effectStyles`
  and `narrowedTo`.
- Every existing brief fixture byte-identical at the end of Phase A.

**Phase A unit coverage:**

- A variable and an effect style sharing one name produce two entries through
  normalization, minimization and emission.
- `refKey` collision behaviour for same-name, different-kind, and for
  same-name, same-kind-different-id.
- No NUL byte appears in any composite key. `npm run check:nul` extended to
  cover this.
- `remote` is carried from the resolver, not derived.

**Phase B unit coverage:**

- Each of the nine effect shapes round-trips, plus an unrecognised `type`
  landing as `{ type: 'unknown', figma_type: ... }`.
- A noise effect emits no `radius` key rather than a zero.
- A shadow with a bound colour and hardcoded geometry emits both the binding
  and the geometry.
- Each of the six statuses; `not-in-scope` unreachable from `componentBrief`;
  no seventh.
- A style entry in `used` carries no layer or metric data: values appear once.
- Alpha `0.03999999910593033` emits `0.04`; `0.125` survives.
- `collection` omitted when `readCollectionName` yielded `''`.
- `source`, empty `text_styles`, empty `effect_styles` keys absent, not empty.
- An invisible effect layer survives with `visible: false`.

**Fixtures.** New: a foundation with effect styles covering every shape; a
component binding an effect style; a component with a partially bound shadow; a
component binding a paint style; a scoped copy carrying `scope`. All existing
fixtures regenerate at B, and every diff is reviewed for unintended shape
change rather than accepted wholesale.

## Sequencing

**Phase A**

1. Hash and fixture regression guards.
2. `NodeResolver` widening (A1).
3. `TokenRef` identity and the `token` to `name` rename, including the
   `hash.ts:45` projection fix (A2).
4. Minimization threading and the NUL-key removal (A3).
5. `narrowedTo` (A4) and `unavailable` (A5).

**Phase B**

6. `EffectLayer` union and the serializer read (B1).
7. Foundation effect styles (B2).
8. Inline node effects and the `(path, property)` join (B3).
9. `used` as a list, `resolution`, the `effects:` block (B4, B5).
10. Alias collection, alpha, `source`, `scope` (B6, B7).
11. `BRIEF_VERSION` 4, fixture regeneration, `plugin-knowledge-map.md`.

Step 10 is independent of everything else and could ship alone if a smaller
change is wanted sooner. Steps 6 and 7 are independent of 8.
