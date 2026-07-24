# Definition → Overview: value-led prose

**Date:** 2026-07-10
**Branch:** plugin-2.0
**Status:** Approved (design), pending implementation plan

## Problem

The first Usage section is labeled **Definition** and, after the prior rebalance,
its body is a terse "what it is + key constraint." The desired treatment (per the
Salesforce reference the user shared) is an **Overview**: a short, benefit-led
narrative about why the component matters, where it's used, its role, and a
guiding principle — not a dictionary definition.

## Decision

1. **Rename** the section label from `Definition` to **`Overview`**. The internal
   `SectionId` stays `'definition'` and the prose field stays `definition`; only
   the user-visible heading changes.
2. **Reshape the `definition` prose** into a value-led overview:
   - The **first sentence** remains a concise *what it is* — it feeds the header
     subtitle (unchanged mechanism: header = first sentence, body = the rest).
   - The **body** is a short benefit-led narrative: where/how it's used, the value
     it gives people, its role in the product, and a brief guiding principle.
   - It must **not** name specific variants/styles and must **not** give a "when
     to use which" guide — those remain the Variants section's job (from the prior
     rebalance). No em dashes (house style).
3. **Version bump** `PROSE_PROMPT_VERSION` v6 → v7 so cached v6 drafts are not
   served after the shape change.

### Target shape (illustrative, house-style, no style names)

> **Header (first sentence):** A Button triggers an action when activated.
>
> **Overview body:** Used across products to perform common actions. Buttons give
> people a familiar, accessible way to engage with the interface, which keeps
> common tasks fast and predictable. The component is essential for guiding people
> through workflows and performing the key actions on a screen. Create buttons
> that are clear, easy to identify, and accessible.

## Changes

### Label (`packages/plugin/src/ui/docModel.ts`)
- `ALL_SECTIONS`: change the `definition` entry's `label` from `'Definition'` to
  `'Overview'`. Nothing else about that entry changes (id, ai, group stay).

### Prose prompt (`packages/extractor/src/prose/prompt.ts`)
- System-prompt Definition bullet: reshape to the value-led overview instruction
  above (first sentence = what it is; then a benefit/role/where-used narrative;
  no per-type content, no style names).
- Both JSON-key descriptions (FEW_SHOT_PROMPT and `buildProsePrompt`): update the
  `definition` description to match.
- `FEW_SHOT_RESPONSE.definition`: rewrite to the target shape (what-it-is sentence
  + value/role narrative, no style enumeration).

### Version (`packages/extractor/src/prose/client.ts`)
- `PROSE_PROMPT_VERSION` v6 → v7, with a comment noting "Definition → Overview,
  value-led prose."

## Non-goals

- No change to the header extraction mechanism (still first-sentence → subtitle).
- No new prose fields / no `ProseDrafts` schema change.
- No change to Variants (keeps the type list + "when to use which" guide),
  Accessibility, Anatomy, Do's & Don'ts, or the three-frame structure.

## Testing

- Extractor prose tests: update the few-shot expectation so `definition` reads as
  a value-led overview and still carries **no** bulleted per-type guide (the
  existing "no per-type guide in definition" test must stay green). Optionally
  assert the definition is multi-sentence / mentions use or value rather than a
  bare one-liner, kept loose to avoid brittleness.
- Plugin: the section heading now renders as "Overview" — covered by the label
  change; no new plugin unit test needed beyond the existing suite staying green.
- Full suite green; plugin build succeeds.
- Manual: regenerate in Figma; confirm the heading is "Overview", the header is a
  one-sentence what-it-is, and the Overview body reads as value/role narrative
  with no style names and no repetition of Variants.

## Risk

Prompt wording is the lever; the model may drift toward a dry definition or leak
style names. Mitigate with explicit instructions (value/role/where-used; do NOT
name styles or give a when-to-use guide) and a clear few-shot exemplar.
