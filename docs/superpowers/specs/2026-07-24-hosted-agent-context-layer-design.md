# Hosted Agent Context Layer — Spec Layer Figma Plugin

**Date:** 2026-07-24
**Status:** Approved design (brainstorm complete)
**Scope:** The Figma plugin (`packages/plugin`) and the Cloudflare Worker
(`packages/proxy`). The docs app and any CLI are out of scope.

---

## 1. Summary

Spec Layer gains a second product surface: a **hosted MCP endpoint** that serves
a design system's component specs to a developer's coding agent.

The designer documents components in Figma as they do today, then clicks
**Publish**. The plugin pushes an agent-optimised projection of every documented
component to our Worker, which returns a stable share link. The designer sends
that link to a developer, who pastes one line into their agent's MCP config. The
agent can then ask for the reviewed spec of any component at codegen time and
write on-token code instead of hardcoded values.

Publishing is Pro-gated. The endpoint re-checks the owner's license on every
read, which makes this a recurring-value feature rather than a one-off export.

---

## 2. Why this, why now

The June positioning work (`docs/strategy/2026-06-22-positioning-and-pivot.md`)
concluded that Spec Layer should stop competing on documentation and compete
instead on drift detection plus agent-readable design truth. Recent competitor
movement confirms it: zeroheight is now automating the markdown-to-portal
pipeline (props tables, changelogs, component status, token references). The
human documentation seam is closing and is not winnable head-on.

The machine seam is open. Nobody in the Figma / Storybook / Chromatic chain
assembles a per-component, condition-aware **token-binding map** and serves it to
an agent. Storybook knows code, not design intent. Figma holds raw bindings but
never composes them into a contract. zeroheight renders documents for people to
read. Our extractor already produces exactly the artifact an LLM needs.

This design makes that artifact reachable by the person who benefits from it.

---

## 3. Constraints that shape the design

**3.1 The plugin is the only possible writer.** Doc frames store their config and
`content_hash` in private `pluginData` (`getPluginData` / `setPluginData`, see
`main.ts:226-560`), which is invisible to Figma's REST API. No server-side
process can ever read a customer's Figma file on its own. The architecture is
therefore strictly push: plugin publishes, Worker stores, agent reads. There is
no sync daemon, no Figma OAuth, and no webhook path. This is a hard constraint,
not a preference.

**3.2 The agent's context window is the real budget.** A full `IntermediateSpec`
carries `variantInstances`, node-id-keyed `anatomy`, and per-part render detail
that exists to drive our doc frames. Injecting that into an agent's context burns
tokens and buries the signal. The published artifact must be a deliberate
projection, not the raw extraction.

**3.3 Handoff crosses a person boundary.** The designer has the specs and cannot
push to the developer's repo. The developer has the repo and has neither the
Figma file nor the plugin. Any design requiring both parties to share a workspace
fails at the exact moment of handoff. A link is the only artifact that crosses
cleanly. This is why the local-repo MCP option was rejected.

---

## 4. The published artifact

One JSON projection per component. Derived from `IntermediateSpec`
(`packages/extractor/src/extract.ts:22`), keeping what informs code generation and
dropping what only drives rendering.

```jsonc
{
  "name": "Button",
  "slug": "button",
  "file": "Components",
  "status": "approved",
  "content_hash": "9f2a…",
  "published_at": "2026-07-24T10:12:00Z",

  "props":    [{ "name": "variant", "kind": "variant",
                 "options": ["primary", "secondary"], "default": "primary" }],
  "variants": [{ "prop": "size", "values": ["sm", "md", "lg"] }],
  "states":   ["default", "hover", "disabled"],

  "anatomy":  [{ "name": "Container", "type": "FRAME", "depth": 0 }],
  "tokens":   [{ "part": "Container", "property": "fill",
                 "conditions": { "State": ["Hover"] },
                 "token": "Background/Action/Hover" }],
  "layout":   [{ "part": "Container", "summary": "horizontal, padding 8/16/8/16, gap 8, radius 4" }],
  "unbound":  [{ "part": "Icon", "property": "fill", "value": "#6750A4" }],

  "related":  ["Icon"],
  "guidance": "Use primary for the single most important action…"
}
```

**Kept and why:**

| Field | Source | Why an agent needs it |
|---|---|---|
| `tokens` | `TokenRule[]`, verbatim | The crown jewel. Condition-aware design-to-token truth. This is what makes the agent write `var(--background-action-hover)`. |
| `props`, `variants`, `states` | as extracted | The component's API surface. |
| `anatomy` | minus node ids | Part names that `tokens` and `layout` reference. Ids are meaningless outside the file. |
| `layout` | `LayoutSummary[]` | Already a compact string (`"padding 8/16/8/16, gap 8"`). Directly useful for building the component. |
| `unbound` | `RawValue[]`, renamed | Tells the agent a value is genuinely hardcoded in the design so it does not invent a token that does not exist. Honest, and quietly advertises the drift problem. |
| `guidance` | the AI prose, optional | The meaning layer: when to reach for which variant. This is the thing Storybook structurally cannot say. |

**Dropped:** `variantInstances` (render-only, the largest field), `anatomyComponentId`,
`figmaNode`, and `gaps` (internal extraction diagnostics; `unbound` covers the
part a consumer can act on).

Expected size is roughly 2 to 6 KB per component, which is a reasonable
single-tool-call payload.

---

## 5. Architecture

### 5.1 The project

A **project** is the unit a developer connects to. It is owned by a Pro license
and aggregates components published from one or more Figma files.

```
Project "Acme DS"  ──  share token  ──▶  one MCP endpoint
   ├── file: Foundations   (published 2h ago)
   ├── file: Components    (published 2h ago, 3 drifted)
   └── file: Patterns      (never published)
```

Project scope was chosen over per-file so a developer configures exactly one
endpoint for a design system that spans several Figma files. Because ownership
keys off the license, two designers sharing a Pro key publish into the same
project automatically, which is the correct default for a team.

### 5.2 Storage (Cloudflare KV)

| Key | Value | Read by |
|---|---|---|
| `token:<shareToken>` | `projectId` | every MCP call |
| `proj:<projectId>` | name, owner license hash, files[], `lapsedAt`, `rotatedFrom`, revoked | auth, Library |
| `idx:<projectId>` | `[{ name, slug, file, status, hash }]` | `list_components` |
| `spec:<projectId>:<slug>` | the §4 projection | `get_spec` |
| `files:<projectId>:<fileKey>` | `[slug]` | publish diff |

Per-component keys, not one bundle: `get_spec("Button")` must not read a
300-component blob. KV suits this well, being read-heavy, edge-cached, and
tolerant of eventual consistency for a snapshot artifact.

The token indirection key exists so rotation rewrites one small record instead of
every spec.

**`files:<projectId>:<fileKey>` is what makes republish correct.** Publishing a
file computes its new slug set, writes those specs, then deletes slugs present in
the stored set but absent from the new one, so a component deleted in Figma
disappears from the endpoint instead of lingering forever. The index is then
rebuilt. Publishing one file never disturbs another file's components.

### 5.3 Name collisions across files

A slug unique across the project is served bare, so `get_spec("Button")` just
works. On a genuine collision the slugs become file-qualified
(`components/button`, `patterns/button`) and a bare `get_spec("Button")` returns a
disambiguation listing both. Last-write-wins is rejected: it corrupts silently.

### 5.4 Transport

`POST /mcp/v1/:token`, implementing MCP over Streamable HTTP with **plain JSON
responses**. Every tool here is read-only and stateless, so there is no need for
SSE, session management, or Cloudflare's `McpAgent` Durable Object wrapper. The
handler implements `initialize`, `notifications/initialized`, `tools/list`, and
`tools/call` as JSON-RPC 2.0 over POST.

This is a deliberate simplification: no new binding, no per-session state, and
nothing to bill or debug beyond the request itself.

### 5.5 Tool surface

| Tool | Arguments | Returns |
|---|---|---|
| `list_components` | none | project name, `published_at` per file, and the component index |
| `get_spec` | `name` | the §4 projection, or a disambiguation list on collision |
| `find_token` | `property`, optional `component` | matching `TokenRule`s across the project, for "which token is the hover background?" |

`list_components` carries project metadata so the agent can reason about
freshness without a second call.

**The endpoint cannot report drift, only age.** Drift is a comparison between
live Figma frames and the published snapshot, and only the plugin can see the
live side. The Worker knows nothing about a Figma file after publish. So MCP
responses expose `published_at` and the agent infers staleness from age ("these
specs were published three months ago"), while true drift counts remain a
Library-side concept. A future plugin-side drift heartbeat could close this gap;
it is not in this design.

### 5.6 Worker routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /v1/projects` | Bearer license | picker contents |
| `POST /v1/projects` | Bearer license, Pro | create |
| `POST /v1/projects/:id/publish` | Bearer license, Pro | publish one file |
| `POST /v1/projects/:id/rotate` | Bearer license, Pro | new token, old one enters its window |
| `POST /v1/projects/:id/revoke` | Bearer license, Pro | immediate hard stop |
| `POST /mcp/v1/:token` | share token | the MCP endpoint |

---

## 6. Workflow

**Designer, first publish.** Library gains a Publish action. On first publish
from a file the plugin asks which project to publish into, listing existing
projects from `GET /v1/projects` plus "Create new project". The choice is stored
in that file's root `pluginData`, so every later publish is one click with no
prompt.

**Designer, thereafter.** Publish. The Library shows publish age and drift per
file, and offers the link plus a copy-paste config snippet.

**Developer, once.** Receives the link, pastes one block:

```jsonc
"spec-layer": { "url": "https://mcp.speclayer.dev/mcp/v1/AbC123" }
```

The domain above is illustrative. The Worker currently runs on the
`spec-layer-test` workers.dev staging host, and the production domain swap is
still open (finding A1 in `docs/reviews/2026-07-22-plugin-holistic-review.md`).
Because this URL is pasted into developer configs and is painful to change after
the fact, the production domain should be settled **before** the first external
share link is issued.

**Agent, ongoing.** Calls `list_components` / `get_spec` / `find_token` as it
writes code, and uses the token map instead of hardcoded values.

**The loop.** A component is edited in Figma, the Library's existing drift
tracking flags it, the designer re-publishes, and the developer's agent sees
fresher data on its next call with no reconfiguration. This loop is what makes
the feature recurring rather than a one-time export, and it reuses drift
machinery that already exists.

---

## 7. Tiering

| | Free | Pro |
|---|---|---|
| Extraction, doc frames, export | yes | yes |
| Publish to a hosted project | no | yes |
| Link stays live | n/a | while the license is active |

Publishing is the Pro seam because it is the moment value is most obvious: a team
is at handoff and wants the specs to reach a developer without manual relay.
Reads re-check the owner's license, so hosting cost tracks paying customers.

---

## 8. Link lifecycle

| State | Trigger | Endpoint behaviour | Resolved by |
|---|---|---|---|
| Active | published, license valid | serves specs | — |
| Stale | source drifted since publish | serves last snapshot; only `published_at` age is visible to the endpoint (§5.5) | designer re-publishes |
| Grace | license definitely inactive, within 14 days | serves, with a renewal notice in every response | owner renews |
| Suspended | grace expired | refuses, with a readable reason | owner renews |
| Rotated | designer regenerated the link | old token serves 7 more days with a deprecation notice | developer updates config |
| Revoked | designer revoked deliberately | immediate hard stop | new link issued |
| Archived | suspended 6 months | purged after an export offer | — |

Every state except Archived is **computed at read time** from the stored project
record and the existing license cache. Only archival needs a scheduled sweep, so
ongoing operational burden is close to zero.

**The grace clock must never start on an outage.** `lapsedAt` is set only on a
*definite* inactive verdict from the license check, never on an unreachable or
errored one, and is cleared when the license reads active again. This reuses the
principle already established in the plugin (commit `334d1f1`, "treat an
unreachable license server as a blip, not a lapse"). Without this, a Lemon
Squeezy outage would start every customer ticking toward suspension.

**Rotation is never an instant cut.** We have no channel to the developer, so a
hard swap would break their agent with no explanation. Regeneration issues the
new token while the old one keeps serving for seven days, returning a deprecation
notice the agent can relay.

**Error strings are read by an AI and paraphrased to a human.** They must be
written for that path. A bare `402` is useless; the response body should say
something the agent can usefully relay, for example: `"The Spec Layer link for
Acme DS is inactive. Ask the design system owner to renew."` Copy follows
`docs/plugin-voice-and-copy.md`, including no em dashes.

**Ownership re-bind.** A project is keyed to a license hash, so a changed
subscription, a replaced card, or a departing designer can orphan it while the
developer's link keeps serving frozen specs. Publishing from a Figma file whose
`pluginData` already names that project, with any valid Pro key, re-binds
ownership. The file itself is the proof of control. Without this path we would be
doing manual data surgery for customers within months.

---

## 9. Plugin UX changes

1. **Library gains Publish.** Per-file publish state: never published, published
   with a relative age, or published with a drift count.
2. **Project picker.** Shown on first publish from a file only. Lists existing
   projects and offers to create one. Choice persisted in file `pluginData`.
3. **Link panel.** The share URL, a copy button, the config snippet a developer
   pastes, and access to Rotate and Revoke.
4. **Upsell.** For free users, Publish explains the Pro requirement rather than
   failing.

All copy follows `docs/plugin-voice-and-copy.md`.

---

## 10. Security and abuse

The endpoint is read-only and makes no Anthropic call, so it carries none of the
spend-abuse surface that `/v1/prose` does (findings C1 and C2 in
`docs/reviews/2026-07-22-plugin-holistic-review.md`). The worst case is bandwidth,
not billed inference.

- The share token is a 128-bit capability in a URL and will be pasted into Slack.
  It is treated like a Figma share link: high entropy, rotatable, revocable. No
  personal data is encoded in it.
- The IP rate limiter (`SlidingWindowLimiter`, already in
  `packages/proxy/src/ratelimit.ts`) is applied to both `/mcp/v1/*` and the
  publish routes. Note that review finding C3 recommends extending it to
  `/v1/prose` and `/v1/quota` as well; that remains separate work.
- Published specs are customer design data. They are stored per project, served
  only against a valid token, and purged on archival.
- Publish payload size is capped per file, with a clear error when exceeded.

---

## 11. Non-goals

- **No live Figma sync.** The endpoint serves the last published snapshot on
  purpose, so a developer builds against the reviewed contract rather than
  mid-edit design state.
- **No local or repo-based MCP.** Rejected in §3.3: it fails at the person
  boundary.
- **No human-facing hosted docs site.** That is the seam we are deliberately not
  competing in.
- **No write-back to Figma.** Hygiene and auto-fix remain a separate future
  direction.
- **No per-developer accounts or seats.** The token is the only credential a
  developer needs.

---

## 12. Risks

| Risk | Assessment |
|---|---|
| Token leaks via a forwarded link | Accepted, mitigated by rotation and revocation. Same model as a Figma share link. |
| Designer forgets to re-publish, agent silently uses stale specs | Partly mitigated: the Library reports drift to the designer, and `published_at` lets the agent flag age. The endpoint itself cannot detect drift (§5.5), so a stale-but-recently-published snapshot looks healthy. |
| MCP spec churn breaks clients | The URL is versioned (`/mcp/v1/`). Transport is intentionally minimal, which limits exposure. |
| Adoption depends on developers accepting a config paste | Real, and unproven. This is the primary thing to validate with early users. |
| Storage growth from abandoned projects | Bounded by the archival sweep in §8. |

---

## 13. Suggested decomposition

This spec is larger than one implementation plan. It splits cleanly into three,
each independently verifiable:

1. **Projection and publish path.** The §4 projection as a pure, tested function
   over `IntermediateSpec`, plus the Worker's project/publish routes and the KV
   model including diff-delete. Verifiable without any MCP code.
2. **The MCP endpoint.** JSON-RPC handler, three tools, token auth, rate limiting.
   Verifiable against a real agent using a hand-seeded project.
3. **Plugin UX and lifecycle.** Library publish state, project picker, link panel,
   plus grace, rotation, revoke, and re-bind.

Phase 1 and 2 together produce a demonstrable end-to-end result with a manually
created project, which is the cheapest way to settle the §14 questions before
investing in plugin UX.

---

## 14. Validation before build

- Confirm current MCP client behaviour for remote HTTP servers in Claude Code and
  Cursor, including the exact config shape quoted in §6 and whether plain JSON
  responses are accepted without SSE. Knowledge cutoff makes this worth checking
  against live docs rather than assuming.
- Confirm the projection in §4 is sufficient for a real codegen task by hand-running
  an agent against one exported component before building the endpoint.
