# Accessibility group expansion: Interactions, Design & Content Considerations

**Date:** 2026-07-10
**Branch:** plugin-2.0
**Status:** Approved (design), pending implementation plan

## Problem

The Accessibility frame currently holds a single AI prose section. Best-in-class
references (the SLDS Button accessibility page) structure this content as
**Interactions** (Mouse / Keyboard / Other), **Design Considerations**, and
**Content Considerations**. We want that richness without a token blowout: the
prose pass must stay a single API call, and unchecked sections must cost zero
output tokens.

## Decision

Three new AI sections in the `a11y` group, each with its own checkbox, plus a
**selection-aware prose request**: the prompt asks only for the JSON keys whose
sections are checked.

### 1. Section model (`packages/plugin/src/ui/docModel.ts`)

New `SectionId` values, inserted in `ALL_SECTIONS` **before** `accessibility`
(order within the group = frame order, mirroring SLDS):

| id | label | ai | group | renders as |
|---|---|---|---|---|
| `interactions` | Interactions | true | a11y | prose; `### Mouse` / `### Keyboard` / `### Other` subheadings |
| `designConsiderations` | Design Considerations | true | a11y | prose, bulleted |
| `contentConsiderations` | Content Considerations | true | a11y | prose, bulleted |

The existing `accessibility` section keeps its id, label, and checkbox. All
three new sections render exactly like `accessibility` today: a `prose` block
with `AI_PLACEHOLDER` fallback when no draft exists. New checkboxes appear
automatically wherever the UI iterates `ALL_SECTIONS`.

### 2. Prose payload (`packages/extractor/src/prose/prompt.ts`)

`ProseDrafts` gains three **optional** string fields (markdown):

- `interactions?` — grouped under `### Mouse`, `### Keyboard`, `### Other`;
  max 2-3 bullets per subheading.
- `designConsiderations?` — 3-4 bullets; designer-facing responsibilities.
- `contentConsiderations?` — 3-4 bullets; label writing, truncation, i18n.

### 3. Selection-aware prompting (the token lever)

`buildProsePrompt(spec, requested)` takes the set of requested prose keys and
emits per-key instructions **only for requested keys**. The mapping from
checked sections to keys:

| checked section | requested keys |
|---|---|
| definition | `definition` |
| variants | `variantsSummary` |
| anatomy | `anatomySummary`, `anatomyParts` |
| accessibility | `accessibility` |
| dosDonts | `dos`, `donts` |
| interactions | `interactions` |
| designConsiderations | `designConsiderations` |
| contentConsiderations | `contentConsiderations` |

Note this also makes today's sections cheaper: unchecked Variants no longer
pays for `variantsSummary`.

`parseProseResponse(text, requested)` treats a key as **required only when
requested** (today's hard-required `definition`/`accessibility`/`dos`/`donts`
become conditionally required). Keys the model emits beyond the requested set
are parsed if valid, ignored otherwise — never fatal. Callers passing no
`requested` set keep today's behavior (backward compatible for tests/CLI).

### 4. Grounding facts (distillation)

The prompt already carries the distilled spec (anatomy, props, variants,
states, tokens, layout). Per-key instructions anchor each new section to those
facts so the model writes specifics, not filler:

- **interactions** ← the States line. Hover/Pressed states → Mouse bullets;
  Focused state → Keyboard bullets (Tab reachability, Enter/Space activation
  as fits the component archetype); `### Other` covers screen readers, voice
  control, and touch targets. No state axis → 1-2 bullets total, no invented
  states.
- **designConsiderations** ← token bindings and states: contrast obligations
  anchored to the actual color tokens, visual distinguishability across the
  real variant axes, and an explicit flag when an expected state (e.g.
  Focused) is absent from the design file.
- **contentConsiderations** ← text parts in Anatomy: label writing rules for
  the actual text parts, truncation/overflow behavior, and one standing i18n
  bullet (text expansion ~30-40%, RTL).

### 5. Overlap control

When `interactions` is among the requested keys, the `accessibility`
instruction adds: keyboard/mouse mechanics belong to Interactions; keep
`accessibility` to semantics, ARIA naming, and the "not in the design file"
flag. When `interactions` is not requested, `accessibility` behaves exactly
as today.

### 6. Few-shot (`FEW_SHOT_PROMPT` / `FEW_SHOT_RESPONSE`)

Extend the Button exemplar with the three new keys at exactly the capped
lengths (2-3 bullets per Interactions subheading, 3-4 bullets per
Considerations section), in house voice. The few-shot always demonstrates the
full superset; the live instruction's "return ONLY these keys" governs which
keys come back. Cost: roughly +400 input tokens per call, accepted.

### 7. Client (`packages/extractor/src/prose/client.ts`)

- `PROSE_PROMPT_VERSION` v7 → v8 ("a11y group expansion + selection-aware keys").
- `proseCacheKey` gains the requested-key set: a canonical sorted signature
  (e.g. `:keys=accessibility,definition,interactions,…`) so drafts for
  different selections never collide.
- `draftProse` accepts and threads `requested` through prompt build, parse,
  and cache key.
- `max_tokens` 2000 → 3000 (all sections checked must not truncate).

### 8. Plugin reuse guard (`packages/plugin/src/ui/actions.ts`, `ai.ts`)

`willGenerateProse` currently short-circuits on any cached draft. It becomes a
**coverage check**: reuse `state.generatedProse` only when every requested key
is present on it; otherwise regenerate with the full currently-requested set.
Checking a new box therefore triggers exactly one regeneration; unchecking
never does. `generateProse` passes the requested-key set down to `draftProse`.

## Cost envelope

- All sections checked: one call, ~+500-700 output and ~+400 input tokens vs
  today (Haiku-class pricing: low single-digit cents per component).
- Today's default selection: **cheaper** than current, since unrequested keys
  are no longer generated.

## Non-goals

- No archetype/boilerplate library (revisit if per-component quality drifts).
- No new frame layouts: all three sections are plain prose blocks.
- No renaming or restructuring of the existing `accessibility` section.
- No Development Considerations section (code-facing guidance stays inside
  `accessibility`'s semantics bullets for now).

## Testing

- `prompt` tests: requested-key filtering (instructions include exactly the
  requested keys), conditional required-ness in `parseProseResponse`, extra
  emitted keys tolerated, back-compat default (no `requested` = today's
  contract).
- `client` tests: cache key includes the key signature; different selections
  miss each other's entries; v8 in the key.
- `docModel` tests: three new sections render as prose blocks with placeholder
  fallback; group order Interactions → Design → Content → Accessibility.
- `actions` coverage check: cached draft missing a requested key →
  regeneration; superset draft → reuse.
