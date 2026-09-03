# Feature / Fix Backlog — July 2026

*Compiled 2026-07-12 from the competitor-comment analysis review, the plugin knowledge map, and the freemium 3.0 plan. Ordering within a tier is priority order. Update statuses in place.*

Legend: **[feat]** new capability · **[fix]** correctness/copy fix · **[decide]** decision that gates other work · **[chore]** hygiene.

---

## Tier 0 — Already in flight, finish first

| # | Item | Notes |
|---|------|-------|
| 0.1 | **[feat] Execute freemium integration plan** (Tasks 1–8) | `docs/superpowers/plans/2026-07-11-freemium-plugin-integration.md`: proxy CORS, `draftProse` proxy mode, license UI, quota meter, upsell fork, manifest, deploy + manual Figma pass. |
| 0.2 | **[chore] Plugin 2.0 leftovers** | Commit the uncommitted states-matrix WIP; manual Figma matrix test; version bump; Community listing update. |
| 0.3 | **[chore] Docs debt** | README still describes retired Send-to-docs architecture; CHANGELOG stops at v1.0.0. |

## Tier 1 — Decisions and fixes before launch copy hardens

| # | Item | Notes |
|---|------|-------|
| 1.1 | **[decide] Quota shape** | Flat 20/month (as built) vs. first-month boost + lower steady state (e.g. 20 first 30 days, then 7–10/mo). Touches QuotaDO reset logic + meter copy string. Cheap now, annoying post-launch. |
| 1.2 | **[fix] AI disclosure copy** | Current draft says "component metadata" — inaccurate: a rendered PNG is also sent when vision runs. Corrected: "A structured summary of the selected component and a rendered image of it are sent to Spec Layer's AI service to generate prose." Show before first generation. |
| 1.3 | **[chore] Privacy policy, ToS, fair-use pages** | Already tracked as pre-public-release in the freemium plan (§6.6/§6.8). Include subprocessor list (Anthropic, Cloudflare, Lemon Squeezy), retention (KV cache by content hash), contact + deletion process. |
| 1.4 | **[chore] Tally the comment corpus** | Count distinct commenters per theme before letting the analysis rank Tier 2/3 — verify attach/update and token demand really dominate. |

## Tier 2 — Launch-critical features

| # | Item | Notes |
|---|------|-------|
| 2.1 | **[feat] Source-linked documentation frame v1** ✅ built (plugin-3.0, 2026-07-13) | Store source node id + `content_hash` in `pluginData` on the generated Section. Explicit **Update** (regenerate in place), **Detach**, stale detection when source is deleted, warn if section was hand-edited since generation. Manual-edit *merge* explicitly deferred (Tier 4). Headline differentiator: "docs that stay connected to your components." **Built + per-task reviewed** (spec `docs/superpowers/specs/2026-07-12-…`, plan `docs/superpowers/plans/2026-07-12-…`, commits `168cd5d..f86849f`). Adds a **My Library** tab; badge labels In sync / Update available / Manually edited / Source missing. **Pending:** manual Figma pass + holistic whole-branch review (final-review agent hit a session limit before completing). |
| 2.2 | **[feat] Token display mode toggle** | Raw value / variable name / Figma `codeSyntax` / name + value. Extraction: capture `codeSyntax` via `NodeResolver` in `serialize.ts`. Presentation-only → hash-safe (`rawValues` already excluded). Highest value-to-cost item in the backlog. **Note:** 2.5 already captures `codeSyntax` per variable in `serializeFoundation.ts`, so whichever of the two ships second inherits that half for free. |
| 2.3 | **[feat] Unit setting (px / rem)** | Configurable root size. Presentation-only, hash-safe. |
| 2.4 | **[fix] Failure-state clarity** | Every error must say whether it's *unsupported*, *quota*, or *paid*. Quota path covered by the upsell fork; audit the remaining error banners. |
| 2.5 | **[feat] Foundation export** ✅ phases 1–4 built (foundations-1.0, 2026-07-25) | Documents variable collections (modes, alias chains, descriptions) and local text styles, mirroring the file's own structure. New Foundations tab, no selection needed. Frames are link-tracked in My Library with the same four badges plus Update / Detach / Remove; regeneration replaces in place, including cross-page. Spec `docs/superpowers/specs/2026-07-25-foundation-export-design.md`, plan `docs/superpowers/plans/2026-07-25-foundation-export-canvas.md`, commits `f98b086..34171e4`. Free, like all structural extraction. **Pending:** manual Figma pass (two checklists in `docs/manual-tests/`), then phases 5 (Markdown + docs-app pages, needs a `kind: foundation` frontmatter) and 6 (optional AI usage notes, one per unit, on the existing quota) as a separate plan. Related: 2.2, 3.3, 4.1. |

## Tier 3 — First updates after launch

| # | Item | Notes |
|---|------|-------|
| 3.1 | **[feat] Hug/Fill/Fixed sizing behavior** | Render in the Measurements canvas section (canvas-only). **Constraint:** markdown spec sections are frozen for hash stability — do NOT add a markdown section without a conscious revisit of the freeze + hash projection. |
| 3.2 | **[feat] Documentation presets** | Design system / Developer handoff / Compact / Custom, layered over `ALL_SECTIONS` + `DEFAULT_OFF_SECTIONS`. Thin UI layer. |
| 3.3 | **[feat] Effects & shadows extraction** | Extend token/raw-value extraction; check hash-projection additivity. **Note:** effect styles are the natural next source to add to 2.5's `FoundationSpec`; the collection/style shape there is the template, and its hash covers whatever `unitContent` returns, so an added field is covered automatically. |
| 3.4 | **[feat] Slot / nested-instance handling improvements** | Anatomy DFS currently depth ≤ 3 with single-wrapper descent; deep nesting produces incomplete specs per competitor comments. |
| 3.5 | **[feat] Jira/Markdown export polish** | Zip export exists; make the md paste cleanly into Jira/Confluence. |
| 3.6 | **[feat] Dev Mode inspect-panel surface** | Separate manifest capability + UI constraints — real project, deliberately demoted from launch-critical. |

## Tier 4 — Later / strategic

| # | Item | Notes |
|---|------|-------|
| 4.1 | **[feat] Drift detection surfaces** | `spec-layer check` CI + in-Figma drift badge via committed `content_hash`. The strategic bet (see `docs/strategy/2026-06-22-positioning-and-pivot.md`); 2.1 is its on-canvas prerequisite. **Note:** 2.5 adds per-scope foundation hashes, which give `spec-layer check` a file-level baseline (has the token layer moved?) rather than only per-component ones. |
| 4.2 | **[feat] Manual-edit preservation on Update** ✅ built (2026-09-03) | Narrowed from a three-way merge to a two-lane model: writing sections are tagged as editorial and read back from the canvas on Update; generated sections are rebuilt. Spec `docs/superpowers/specs/2026-09-03-preserve-hand-edits-on-update-design.md`. Open follow-ups: the same tagging for Foundation group descriptions, and a hand-edit warning on Create over an existing doc. |
| 4.3 | **[feat] Team licensing** | Central billing, seats. Server handles most lifecycle already; needs LS product + UI. |
| 4.4 | **[feat] Enterprise/BYOK option** | Re-introduce direct-key mode as an enterprise privacy feature (data never touches the proxy). |

## Explicitly not doing

- Remote MCP / agentic vision enrichment (rejected 2026-06-10 — extraction-over-AI decision).
- New markdown spec sections (format frozen; canvas-only additions instead).
- Centimeters, drag-and-drop annotation primitives, presentation embedding (isolated comment requests, no recurring pattern).
