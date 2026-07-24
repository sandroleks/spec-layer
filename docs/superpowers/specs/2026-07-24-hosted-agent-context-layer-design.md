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
**Publish**. The plugin pushes the full context of every doc frame, including the
AI-generated prose sections, to our Worker, which returns a stable share link. The designer sends
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

**3.2 The agent's context window is a real budget.** A full `IntermediateSpec`
carries `variantInstances`, node-id-keyed `anatomy`, and per-part render detail
that exists purely to drive our doc frames. Injecting that into an agent's context
burns tokens and buries the signal. The published artifact therefore mirrors the
frame's *content* while excluding render scaffolding (§4), and `get_spec` lets a
caller narrow to the sections it needs (§5.5).

**3.3 Handoff crosses a person boundary.** The designer has the specs and cannot
push to the developer's repo. The developer has the repo and has neither the
Figma file nor the plugin. Any design requiring both parties to share a workspace
fails at the exact moment of handoff. A link is the only artifact that crosses
cleanly. This is why the local-repo MCP option was rejected.

---

## 4. The published artifact

**The link mirrors the doc frame.** Whatever sections the designer chose to put on
the frame are exactly what the endpoint serves. There is no separate notion of
"what gets published", which keeps one mental model: what you see on the canvas is
what the agent gets.

This matters because the frame is not just a token table. Seven of its twelve
sections are AI-generated prose (`ALL_SECTIONS`, `docModel.ts:14`):

| Group | Sections |
|---|---|
| Usage | Overview\*, Variants\*, Do's & Don'ts\*, Related |
| Specifications | Anatomy\*, Measurements, Configuration, States, Tokens used |
| Accessibility | Semantics & Focus\*, Interactions\*, Content Considerations\* |

\* AI prose

Do's and don'ts, focus and semantics, interaction behaviour, and content guidance
are precisely the "when and why" an agent cannot get anywhere else. Storybook
knows code, not intent. Serving only a token map would discard the most
differentiated half of the artifact.

### 4.1 Shape

```jsonc
{
  "name": "Button",
  "slug": "button",
  "file": "Components",
  "status": "approved",
  "content_hash": "9f2a…",
  "published_at": "2026-07-24T10:12:00Z",
  "sections_published": ["definition", "anatomy", "configuration", "tokens", "dosDonts"],

  "sections": {
    "definition":    { "kind": "prose", "label": "Overview",
                       "body": "Use primary for the single most important action…" },
    "anatomy":       { "kind": "mixed", "label": "Anatomy",
                       "parts": [{ "name": "Container", "type": "FRAME", "depth": 0 }],
                       "body": "The container owns padding and radius…" },
    "configuration": { "kind": "data", "label": "Configuration",
                       "props": [{ "name": "variant", "kind": "variant",
                                   "options": ["primary", "secondary"], "default": "primary" }],
                       "variants": [{ "prop": "size", "values": ["sm", "md", "lg"] }] },
    "states":        { "kind": "data", "label": "States",
                       "states": ["default", "hover", "disabled"] },
    "measurements":  { "kind": "data", "label": "Measurements",
                       "layout": [{ "part": "Container",
                                    "summary": "horizontal, padding 8/16/8/16, gap 8, radius 4" }] },
    "tokens":        { "kind": "data", "label": "Tokens used",
                       "rules": [{ "part": "Container", "property": "fill",
                                   "conditions": { "State": ["Hover"] },
                                   "token": "Background/Action/Hover" }] },
    "dosDonts":      { "kind": "prose", "label": "Do's & Don'ts", "body": "…" }
  },

  "unbound": [{ "part": "Icon", "property": "fill", "value": "#6750A4" }],
  "related": ["Icon"]
}
```

Sections are keyed by `SectionId` so consumers can address them stably, and each
carries its `kind` (`prose`, `data`, or `mixed`) so an agent knows whether to read
narrative or structure. `sections_published` makes omissions explicit: an absent
section means the designer turned it off, not that extraction failed.

`unbound` is the one field that is not a frame section. It lists values genuinely
hardcoded in the design (`RawValue[]`), so the agent does not invent a token that
does not exist. It is a codegen aid derived from extraction, and it quietly
surfaces the drift problem.

### 4.2 What does not transfer

The link carries the frame's **content**, not its **rendering**. Anatomy's part
list and prose transfer; the annotated screenshot does not. Same for the measure
overlays, the states matrix, and the variants grid. This is the right trade: those
images are large, and an agent gets little from them. Sending rendered PNGs to a
vision model is a separate future direction and is out of scope here.

Also dropped from the underlying extraction: `variantInstances` (render-only, the
largest field), `anatomyComponentId`, `figmaNode`, and `gaps` (internal
diagnostics; `unbound` covers the actionable part).

Expected size is roughly 5 to 15 KB per component with all sections on. That is
fine for a single `get_spec` call and is exactly why the storage model uses
per-component keys (§5.2) rather than one bundle.

### 4.3 Persisting the model (new work)

Today the prose has **no durable home**. `DocLinkData` (`docLink.ts:28`) stores only
`sourceNodeId`, `contentHash`, `selfHash`, `config`, `generatedAt`, and
`pluginVersion`. The generated prose exists solely as rendered text nodes on the
canvas, so there is nothing for Publish to read.

The plugin must therefore **persist the generated doc model at build time**, under
a pluginData key separate from `DocLinkData`:

- **Separate key, not an added field.** `DocLinkData` is parsed during library
  enumeration and every drift check; bloating it would worsen the list-rebuild
  costs already noted as F1 and F2 in the holistic review. The model key is read
  only on publish and on Download MD.
- **Versioned** (`v: 1`) for forward compatibility.
- **Size-guarded**, with a clear error when a component exceeds the per-entry
  pluginData limit.
- **Bonus:** Download MD can reuse it instead of regenerating.

Consequences, accepted:

- **Hand-edits on the frame do not reach the agent.** Publish sends the stored
  generated model, so a designer who edits frame text by hand creates a silent
  divergence between canvas and link. The existing `selfHash` / `edited` detection
  already identifies this case, so a warning on publish can be added later at
  small cost if it becomes a support issue.
- **Frames built before this change have no stored model.** Publish must detect
  this and tell the designer to regenerate the frame first, rather than failing
  obscurely or publishing an empty spec.

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
| `spec:<projectId>:<slug>` | the §4 artifact | `get_spec` |
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
| `get_spec` | `name`, optional `sections` | the §4 artifact, or a disambiguation list on collision. `sections` narrows the response (for example just `tokens`) so an agent doing pure codegen need not pull the accessibility prose |
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

### 5.7 Getting the data from Figma to the Worker

Publishing crosses the plugin's thread split, so it is worth stating the path
explicitly.

1. **Main thread** (Figma API, no network). Walks the Library's doc frames, reads
   each frame's persisted model from `pluginData` (§4.3), derives the §4 artifact
   via the pure function, and posts the batch to the UI over `postMessage`.
2. **UI iframe** (network, no Figma API). All existing network already lives here
   (`ui/proxy.ts`); `main.ts` contains no `fetch` calls at all. The iframe
   compresses the batch and POSTs it with the Bearer license header, then reports
   progress back to the main thread.
3. **Worker.** Writes spec keys, diffs against the stored file slug set, deletes
   removals, then swaps the index.

**Nothing is stored outside `pluginData`.** The doc model lives in the Figma file,
which is the correct home: it travels with the file, survives a plugin reinstall,
and needs no separate sync. `figma.clientStorage` is deliberately not used, since
it is per-user-per-device and would make a file publishable only from the machine
that generated it.

**Batching.** A 300-component library at 5 to 15 KB each is 1.5 to 4.5 MB. That
cannot be one request, and it cannot be one `postMessage` either (review finding
F5 already flags unguarded large postMessage). Publish streams in batches of
roughly 25 components or 1 MB, whichever comes first, with progress and a cancel
in the UI.

**Commit is an index swap.** Batches write `spec:` keys, which are invisible to
readers because `list_components` reads only `idx:`. The index is written last. A
failure mid-publish therefore leaves orphaned spec keys that the next successful
publish overwrites, and a reader never observes a half-published project.

**Publish is incremental.** The plugin already knows each frame's `contentHash`,
so publish sends only components whose hash changed since the last successful
publish of that file, plus the complete slug set so the Worker can still compute
deletions. The first publish sends everything; a typical re-publish sends a
handful. This is the main thing keeping write volume (§11) low.

**Compression.** `fflate` is already a plugin dependency (`exportFiles.ts`), so
the publish body is gzipped. These specs are repetitive JSON and compress at
roughly 5:1, which makes even a first publish of a large library cheap to move.

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
5. **Legacy frames.** A frame built before model persistence (§4.3) cannot be
   published. Publish detects the missing model and asks the designer to
   regenerate that frame first, stating why.

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

## 11. Cost and launch prerequisites

Figures below are Cloudflare's published pricing as of 2026-07-24 and should be
re-checked before launch.

### 11.1 What a customer consumes

Reads dominate, because every MCP call costs two KV reads (token indirection,
then the spec) while publishing is incremental and rare.

| | Per Pro customer per month | Note |
|---|---|---|
| KV reads | ~20,000 | assumes a heavy team at ~10,000 MCP calls |
| KV writes | ~200 | incremental republish (§5.7); only changed components |
| Storage | ~3 MB | 300 components at ~10 KB |

### 11.2 Workers Paid

$5/month, including 10 million Worker requests and 10 million KV reads. Beyond
that, reads are $0.50 per million and writes $5 per million.

At the read rate above, the included quota carries roughly **500 customers**
before any overage. At 1,000 customers the bill is about **$11/month**. Storage
is a rounding error: 1,000 customers is 3 GB, or about $1.50.

This is not a business risk. Hosting cost tracks paying customers directly, and
the margin is not close.

### 11.3 Why the free plan cannot ship this

The account is currently on the free plan. Its limits are not merely smaller,
they behave differently:

| | Free | Failure mode |
|---|---|---|
| Worker requests | 100,000/day | **Error 1027**, the Worker is bypassed entirely |
| KV reads | 100,000/day | the operation fails with an error |
| KV writes | **1,000/day** | the operation fails with an error |
| Storage | 1 GB | — |

Two problems, in order of severity.

**The quotas are account-wide and shared with the existing proxy.** KV reads and
writes come out of the same pool as `LICENSE_CACHE`; Worker requests are shared
with `/v1/prose`, `/v1/quota`, and `/v1/license/*`. An agent polling the MCP
endpoint hard enough to exhaust the daily quota would stop paying customers from
activating licenses or generating prose, and because Error 1027 bypasses the
Worker we could not even return a readable explanation. A new, free-to-read
surface must not be able to take down the surface that collects money.

**1,000 KV writes/day is too tight for a real library.** A first publish of a
500-component library is ~500 writes. Two of those exhaust the day, account-wide,
and the second one fails partway through. Incremental publish (§5.7) keeps steady
state well inside the limit, but first publishes do not.

Cron Triggers are available on the free plan (5 per account), so the §8 archival
sweep is not a factor either way. SQLite-backed Durable Objects are why `QuotaDO`
works on free today, and that does not change.

### 11.4 Launch prerequisites

Neither of these blocks development. Phases 1 and 2 can be built and tested
entirely on the free plan against small fixtures of 10 to 30 components. Both must
be settled **before the first share link reaches anyone outside the team**:

1. **Production domain.** Finding A1: the Worker still runs on the
   `spec-layer-test` workers.dev staging host. This URL goes into developer
   configs and is painful to change afterwards (§6).
2. **Cloudflare Workers Paid.** $5/month, ideally activated slightly ahead of
   launch rather than on the day, since the failure mode above hits existing paying
   customers rather than the new feature.

---

## 12. Non-goals

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

## 13. Risks

| Risk | Assessment |
|---|---|
| Token leaks via a forwarded link | Accepted, mitigated by rotation and revocation. Same model as a Figma share link. |
| Designer forgets to re-publish, agent silently uses stale specs | Partly mitigated: the Library reports drift to the designer, and `published_at` lets the agent flag age. The endpoint itself cannot detect drift (§5.5), so a stale-but-recently-published snapshot looks healthy. |
| MCP spec churn breaks clients | The URL is versioned (`/mcp/v1/`). Transport is intentionally minimal, which limits exposure. |
| Adoption depends on developers accepting a config paste | Real, and unproven. This is the primary thing to validate with early users. |
| Storage growth from abandoned projects | Bounded by the archival sweep in §8. |
| Hand-edited frames diverge silently from the published spec | Accepted (§4.3). Publish sends the stored generated model. `selfHash` already detects the case, so a warning can be added cheaply if it surfaces in support. |
| Persisted model exceeds the pluginData entry limit on a large component | Guarded with a size check and a clear error at build time (§4.3), rather than failing at publish. |

---

## 14. Suggested decomposition

This spec is larger than one implementation plan. It splits cleanly into three,
each independently verifiable:

1. **Model persistence and publish path.** Persist the generated doc model to
   pluginData at frame build time (§4.3), derive the §4 artifact from it as a pure
   tested function, then add the Worker's project/publish routes and the KV model
   including diff-delete. Verifiable without any MCP code. The persistence step is
   a prerequisite for everything else and touches existing frame-build code, so it
   should land first and on its own.
2. **The MCP endpoint.** JSON-RPC handler, three tools, token auth, rate limiting.
   Verifiable against a real agent using a hand-seeded project.
3. **Plugin UX and lifecycle.** Library publish state, project picker, link panel,
   plus grace, rotation, revoke, and re-bind.

Phase 1 and 2 together produce a demonstrable end-to-end result with a manually
created project, which is the cheapest way to settle the §15 questions before
investing in plugin UX.

---

## 15. Validation before build

- Confirm current MCP client behaviour for remote HTTP servers in Claude Code and
  Cursor, including the exact config shape quoted in §6 and whether plain JSON
  responses are accepted without SSE. Knowledge cutoff makes this worth checking
  against live docs rather than assuming.
- Confirm the artifact in §4 is sufficient for a real codegen task by hand-running
  an agent against one exported component before building the endpoint.
