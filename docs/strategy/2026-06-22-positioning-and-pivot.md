# Spec Layer — Positioning & Pivot Notes

**Date:** 2026-06-22
**Status:** Working strategy notes (not committed direction). Captured from a positioning discussion.

---

## 1. Where Spec Layer sits (the pipeline)

A design system flows through stages, each owned by a different tool:

| Stage | Question it answers | Owner |
|---|---|---|
| Design source | What does it look like? | **Figma** |
| Spec / intent | What does it *mean*, when to use it, what are the rules? | **← Spec Layer's seam** |
| Implementation | How is it built? | **Code** |
| Component catalog | What states/props exist, rendered live? | **Storybook** |
| Visual regression | Did it change unintentionally? | **Chromatic** |

- **Figma** = visual truth, but its "docs" are sticky notes + description fields: unstructured, not queryable, not diffable, behind a login.
- **Storybook** documents the *code* (props/states live). It does not say *when* a designer should reach for a variant, or why.
- **Chromatic** = pixel-diff QA on top of Storybook. Different axis entirely ("did it change?" not "what is it?").
- **Code** = implementation; the spec is the contract it's supposed to honor.

---

## 2. Pressure test — what broke

**The "no tool owns the meaning layer" claim is false.** zeroheight, Supernova, and Knapsack all explicitly own the documentation/meaning seam, are funded SaaS, and have collaboration + governance Spec Layer lacks. Any positioning resting on "empty seam" loses immediately.

Differentiators, stress-tested:
- **Local-first** — a feature for an engineer-of-one, a *liability* for the design-committee buyer who wants hosted, commentable, URL-linkable docs. README admits it: "not hardened as a public multi-user service." Open question: **who is the buyer?**
- **Open Markdown / no lock-in** — competitors export too; Markdown is *less* rich than a hosted renderer. Bet that portability > richness is unproven.
- **Deterministic extraction** — Figma API + Dev Mode + Code Connect already expose structure. Depth has to be *visibly dramatically better* or it's table stakes.
- **Agent-ready / MCP** — most interesting, most fragile: it's roadmap, not shipped, and a competitor can add an MCP endpoint in a sprint. A copyable feature is not a moat.

**The pincer:** Figma (Dev Mode annotations + Code Connect) marches up from design; Storybook autodocs marches down from code. The middle could get squeezed.

### What survives

> **Spec Layer is for engineering-led teams who want their design system's *meaning* to live in their repo as diffable Markdown — reviewed in PRs, versioned with the code, and consumed by agents — instead of in a SaaS silo behind a login.**

This picks a buyer the incumbents don't serve well (source of truth is git, not a portal; increasingly generating code with LLMs). Cost: give up the design-committee buyer; lean *all the way* into git-native + agent-consumption (MCP stops being roadmap, becomes the headline).

---

## 3. The underused asset

The crown jewel is **not** the prose doc (zeroheight makes prettier docs). It's two things the extractor produces that nobody else in the Figma/Storybook/Chromatic chain produces:

1. **The token-binding map** (`## Tokens used`) — condition-aware table of which design token is bound to which property of which part, in which variant/state. Machine-readable design→token truth. Storybook only knows code; Figma has raw bindings but never assembles them into a per-component contract; zeroheight doesn't compute it.
2. **`content_hash`** — deterministic fingerprint of the extraction → a spec *knows when its Figma source drifted*.

Both are currently buried inside a doc a human reads. **Make these the product, not the prose.**

---

## 4. The pivot — from "doc site" to "machine-checkable source of truth"

Ranked. Lead with 1 + 2; demote 3.

**1. Drift detection as a CI guardrail (the git-native wedge).**
Ship `spec-layer check`: re-extract, compare `content_hash`, **fail the PR / post a comment** when Figma and the committed spec diverge — e.g. "Button drifted: `Container › fill` Hover changed from `Action/Action (Hover)` to hardcoded `#5A45A0`." zeroheight structurally *can't* do this (docs aren't in your repo, aren't diffable). This turns local-first/open-Markdown from liability into feature.

**2. Agent context layer (makes "agent-ready" real).**
The token map + prop-mapping table is exactly what an LLM needs to generate on-system code ("use `Background/Action/Action`, not `#6750A4`"). Ship the MCP server so an agent pulls "the reviewed spec for Button" at codegen time. Pitch: *"the design-system context layer for your coding agent."*

**3. Doc browser — keep, stop leading with it.** It's the on-ramp + human review surface, but it's where you lose to zeroheight head-on. Don't position as "nicer docs."

One-liner: **stop competing on documentation; compete on drift detection + agent-readable design truth — both require exactly the deterministic extraction already built.**

---

## 5. What the Figma plugin can do better

Today it's a **one-way exporter** (read selection or all components → serialize → push to app; read-only on the Figma side). Biggest wins = make it **bidirectional and drift-aware**, closing the loop inside the designer's own tool.

1. **Surface drift in Figma** — fetch committed specs' `content_hash`, show a badge: "4 components changed since last extraction · 2 have unresolved drift." The person who caused the drift sees it without leaving Figma. *Highest leverage.*
2. **Coverage dashboard (pull, not just push)** — which components have specs, which are missing guidelines, `status`. Turns the plugin into a standing health view, a weekly reason to open it.
3. **Hygiene tool using the unused write access** — `## Extraction gaps` already detects hardcoded paints / unmapped values. The plugin has full write API → let it *fix* them: "`Container › background` is raw `#6750A4` — bind to `Background/Action/Action`?" Recurring designer-facing value; improves extraction quality downstream. *Stickiest.*
4. **Live spec preview before send** — render the generated Markdown (esp. token table) in the plugin so designers trust output before it leaves Figma. Cheap, builds confidence.
5. **Code Connect integration** — pull existing Code Connect mappings so the `## Code` prop-mapping table is extracted, not hand-authored; ties into Figma's official design↔code bridge.
6. **Incremental re-extraction** — "re-extract only what changed since last run," keyed on `content_hash`. Makes the all-components path usable on a 300-component library.

**Through-line:** pivot #1 (drift CI) and plugin #1/#3 (surface + fix drift) are the same bet — that deterministic extraction lets Spec Layer own "design and code/docs have diverged," a real, unowned, recurring pain the architecture is uniquely built for.

---

## 6. Next step

Build #1 first. Open questions to resolve in a brainstorm/spec:
- What does `spec-layer check` output (CLI format, exit codes, PR-comment shape)?
- How does the plugin badge get the committed hashes (app endpoint? read from repo?)?
- Where does it plug into CI (GitHub Action)?
- Decision still open: commit to the git-native buyer and drop the design-committee buyer?

To validate before committing: research what zeroheight / Supernova / Knapsack / Figma ship *today* (esp. MCP-agent and git-sync features) — current knowledge has a Jan-2026 cutoff.
