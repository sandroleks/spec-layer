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
| 2.1 | **[feat] Source-linked documentation frame v1** | Store source node id + `content_hash` in `pluginData` on the generated Section. Explicit **Update** (regenerate in place), **Detach**, stale detection when source is deleted, warn if section was hand-edited since generation. Manual-edit *merge* explicitly deferred (Tier 4). Headline differentiator: "docs that stay connected to your components." |
| 2.2 | **[feat] Token display mode toggle** | Raw value / variable name / Figma `codeSyntax` / name + value. Extraction: capture `codeSyntax` via `NodeResolver` in `serialize.ts`. Presentation-only → hash-safe (`rawValues` already excluded). Highest value-to-cost item in the backlog. |
| 2.3 | **[feat] Unit setting (px / rem)** | Configurable root size. Presentation-only, hash-safe. |
| 2.4 | **[fix] Failure-state clarity** | Every error must say whether it's *unsupported*, *quota*, or *paid*. Quota path covered by the upsell fork; audit the remaining error banners. |

## Tier 3 — First updates after launch

| # | Item | Notes |
|---|------|-------|
| 3.1 | **[feat] Hug/Fill/Fixed sizing behavior** | Render in the Measurements canvas section (canvas-only). **Constraint:** markdown spec sections are frozen for hash stability — do NOT add a markdown section without a conscious revisit of the freeze + hash projection. |
| 3.2 | **[feat] Documentation presets** | Design system / Developer handoff / Compact / Custom, layered over `ALL_SECTIONS` + `DEFAULT_OFF_SECTIONS`. Thin UI layer. |
| 3.3 | **[feat] Effects & shadows extraction** | Extend token/raw-value extraction; check hash-projection additivity. |
| 3.4 | **[feat] Slot / nested-instance handling improvements** | Anatomy DFS currently depth ≤ 3 with single-wrapper descent; deep nesting produces incomplete specs per competitor comments. |
| 3.5 | **[feat] Jira/Markdown export polish** | Zip export exists; make the md paste cleanly into Jira/Confluence. |
| 3.6 | **[feat] Dev Mode inspect-panel surface** | Separate manifest capability + UI constraints — real project, deliberately demoted from launch-critical. |

## Tier 4 — Later / strategic

| # | Item | Notes |
|---|------|-------|
| 4.1 | **[feat] Drift detection surfaces** | `spec-layer check` CI + in-Figma drift badge via committed `content_hash`. The strategic bet (see `docs/strategy/2026-06-22-positioning-and-pivot.md`); 2.1 is its on-canvas prerequisite. |
| 4.2 | **[feat] Manual-edit preservation on Update** | Three-way merge of generated frames vs. user edits vs. new extraction. Most expensive item in the analysis — deferred deliberately. |
| 4.3 | **[feat] Team licensing** | Central billing, seats. Server handles most lifecycle already; needs LS product + UI. |
| 4.4 | **[feat] Enterprise/BYOK option** | Re-introduce direct-key mode as an enterprise privacy feature (data never touches the proxy). |

## Explicitly not doing

- Remote MCP / agentic vision enrichment (rejected 2026-06-10 — extraction-over-AI decision).
- New markdown spec sections (format frozen; canvas-only additions instead).
- Centimeters, drag-and-drop annotation primitives, presentation embedding (isolated comment requests, no recurring pattern).
