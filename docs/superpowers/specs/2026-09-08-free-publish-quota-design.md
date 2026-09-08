# Free library publishing with a monthly update allowance

Date: 2026-09-08
Status: implemented on `spec/free-publish-quota`, 2026-09-08
Builds on: `2026-07-11-freemium-model-design.md`,
`2026-09-01-library-publish-cli-design.md`,
`2026-09-02-publish-identity-and-storage-hardening-design.md`

## Problem

Publishing a library is Pro-only at two layers: `proCaller` in
`packages/proxy/src/libraries.ts` answers 401 to every non-Pro caller, and
`publishLocked` in `packages/plugin/src/ui/viewModel/allowance.ts` hides the
publish action from a confirmed free plan. Pull, the CLI, and the developer
side of the product are therefore unreachable until someone pays.

The decision is to open publishing and CLI access to free plans. That needs a
free allowance, because a plan with no limit leaves Pro with nothing to sell on
this surface, and because free identities are gameable and need an abuse
ceiling. The allowance has to fit the subscription system that exists: a Lemon
Squeezy license for Pro, a salted Figma user hash for free, and one Durable
Object per identity that already counts AI writing.

A publish costs a few KV writes and up to 5 MB of storage, and a pull costs one
KV read. Neither approaches the cost of an AI call. The allowance is a
conversion lever and an abuse guard, not a cost guard, so its numbers are
generous and its rules are the ones the website already explains for AI
writing.

## Decision summary

- **Two limits, kept apart in code and in copy.** A *library* is one Figma
  file, identified by the id stored in the file, that developers pull with the
  CLI. An *update* is a successful publish that changed the bundle. Free plans
  get 1 library and 10 updates per UTC calendar month. Pro plans keep 10
  libraries and have no fixed update cap, flagged for fair-use review at the
  existing soft threshold.
- **Unchanged republishes are free.** A publish is compared against the stored
  bundle's content identity, so pressing Publish twice never costs an update.
  This mirrors the AI writing idempotency rule and the FAQ language that
  describes it. See Limits for why the comparison cannot be on bytes.
- **Failed publishes are free.** Only a committed KV write counts, the same
  rule AI writing follows.
- **Pull is untouched.** No tier, no quota, no new headers. The per-IP rate
  limit stays the only control. Charging pulls would bill the developer for the
  designer's plan and `spec-layer status` polling would consume it.
- **Ownership is proved, not tiered.** A caller owns a library if it can prove
  any identity that owns it: the license hash when a bearer is present, the
  Figma hash when the Figma user header is present. Tier decides limits;
  ownership decides who may write. Upgrading, lapsing, and resubscribing need
  no migration.
- **No first-30-days boost for publishing.** The AI boost exists because a new
  user tries many components at once. Publishing is a whole-file action, so a
  flat monthly number is easier to explain and needs one less code path.
- **Key rotation has no tier check.** A security action is never behind a
  paywall.
- **Bundle size stays 5 MB for both tiers.** It is an abuse cap, not a product
  tier. Component counts are not limited.
- **Free bundles do not expire.** A library that disappears is hostile.

## Terms in user-facing copy

`library` stays the technical name in the proxy, the CLI, the schemas, and the
developer docs. User-facing counts in the plugin and on the website name the
thing they count:

| Concept | Technical name | Copy says |
|---|---|---|
| One published Figma file | library | "Figma file" |
| One successful publish that changed the bundle | publish | "update" |

The publish screen defines the term once, in a line that is always visible at
the top: "A library is this Figma file, published for developers to pull with
the CLI."

## Proxy

### Identity

A new `callerProofs()` in `packages/proxy/src/identity.ts` returns both proofs
when both headers are present, and `identityFromHeaders` is unchanged. The result carries an optional license key with
its instance id and an optional Figma hash. Tier is `pro` only when a key is
present and `checkLicense` reports active; otherwise `free`. The "license wins"
rule for the AI quota identity is unchanged: a request with a bearer meters AI
writing against the license identity as today.

A caller's *owner identities* are:

- `lic:<sha256(key)>` when a bearer is present, whether or not the license is
  active. Possession of the key is the proof.
- `free:<figmaHash>` when the Figma user header is present.

### Ownership

- A new library is owned by the license identity when the caller is Pro, else
  by the Figma identity.
- `ownedMeta` passes when `meta.licenseId` matches any of the caller's owner
  identities. The field keeps its name for storage compatibility; its value is
  an identity id, and existing records already hold `lic:` ids.
- `ownedLibraryIds` returns the union across both owner prefixes the caller can
  prove. The legacy array migration is unchanged.
- `handleRotate` uses the same ownership rule and drops the tier check.
- No stored record changes shape and no migration runs.

### Limits

`LIBRARY_LIMITS` replaces the single `LIBRARY_LIMIT`, per tier:

| Tier | Libraries | Updates per month |
|---|---|---|
| free | 1 | 10 |
| pro | 10 | no fixed cap, `fair_use_flag` at `PRO_SOFT_THRESHOLD` |

Publish updates are counted by the existing `QuotaEngine` under a separate
Durable Object name, `publish:<identityId>`, with the same reserve, commit,
and release flow `handleProse` uses. The identity id is the caller's tier
identity: the license identity for Pro, the Figma identity for free.

`QuotaEngine` gains a limits parameter. The AI instance keeps today's defaults.
The publish instance uses a flat monthly limit of 10 with the boost window
disabled. `snapshot` and the `X-Quota-*` header shape are shared unchanged.

"Unchanged" is decided on a content identity, not on bytes:
`libraryBundleContentHash` (`packages/extractor/src/libraryBundleHash.ts`)
hashes a canonical JSON of the bundle with each artifact's
`spec_layer.export.id` and `spec_layer.export.generated_at` removed. Those two
fields carry the build timestamp, so a byte hash of the same sources changes on
every click of Publish and would make this rule unreachable. The stored
`LibraryMeta` carries both hashes: `contentHash` answers "changed?", and
`bundleHash` (sha256 of the stored bytes) serves the pull `ETag`. A meta
written before `contentHash` existed has none, which can never equal a
computed hash, so its first republish reads as changed and gains one.

The comparison runs against the target library's own stored `contentHash`,
before any reservation, so it can never be confused with a different library
that happens to share a content hash.

The reservation cache key names the transition, not the destination:
`publish:<libraryId>:<storedContentHash ?? 'none'>-><newContentHash>` for an
update, and `publish:new:<newLibraryId>` for a create. A committed key within
the 24-hour response TTL is served as a no-op success carrying the stored
response body, so a genuine retry of the same publish neither writes nor
counts, while publishing A, then B, then A again inside that window is a new
reservation that writes and counts. Keying an update by its destination alone
would have replayed that third publish and answered `unchanged` while KV still
held B; keying a create by its bundle would have replayed one create for a
second identical library.

Order of checks on publish, after the per-IP rate limit and body validation:

1. Resolve identities and tier.
2. For an update: ownership. For a create: library count against the tier
   limit.
3. Reserve in the publish quota engine. `exhausted` and `rate_limited` stop
   here. `cached` returns the stored response.
4. Write bundle, then meta and owner records, as today.
5. Commit the reservation with the response body. A failed write releases it.

### Implementation notes (2026-09-08)

Five deviations from the design above were reviewed and accepted while
implementing it; this section is the current truth where they disagree.

1. **The publish Durable Object name comes from a helper, not a literal.**
   `quotaObjectName(identityId, profile)` in `packages/proxy/src/index.ts`
   derives the name, so the AI and publish profiles cannot collide; the spec's
   `publish:<identityId>` describes the shape it produces.
2. **The legacy 401 for a lapsed bearer-only caller lives in `handlePublish`,
   not in `resolveCaller`.** Rotation is ownership only, with no tier check, so
   the gate had to move to the one route that needs a tier.
3. **An unchanged republish is detected by comparing the target's stored
   content hash**, not by the reservation cache alone. The cache-key scheme
   the design described could replay one create across two libraries.
4. **Each create reserves under `publish:new:<newLibraryId>`**, with the id
   generated up front, so two creates from identical bundles cannot collide.
5. **Quota refusals carry the quota headers.** 402, 409, and 429 answer with
   `X-Tier` and `X-Quota-*`, which the design only promised on successes; a
   402 is when the count matters most.

### Responses

Publish responses carry `X-Tier` and the `X-Quota-*` headers from the publish
snapshot. New or changed errors:

- `402 {"error":"quota_exhausted","resetsAt":"..."}` when a free plan has used
  its monthly updates.
- `403 {"error":"library_limit","limit":1,"existing":{"libraryId":"lib_...",
  "fileName":"..."}}` when a free plan already publishes a library. `fileName`
  is the stored meta value and may be `null`. Pro keeps the current shape with
  `limit: 10` and no `existing` field, since naming one of ten is not useful.
- `429 {"error":"rate_limited","retryAfterMs":...}` from the quota engine, in
  addition to the per-IP limiter.

`GET /v1/quota` adds a `publish` object beside the existing fields, with the
same snapshot shape: `{ tier, used, limit, remaining, resetsAt }`. The AI
fields keep their place so current plugin builds keep parsing.

CORS `Access-Control-Expose-Headers` already lists the quota headers, so the
plugin iframe can read them on publish responses without a change.

### Compatibility

A plugin build that sends only a bearer keeps working: it proves the license
identity, which owns every library published so far. A build that sends only
the Figma header is a free caller and gets the free limits. The proxy deploys
first for this reason.

## Plugin

### Auth headers

`authHeaders` in `packages/plugin/src/ui/proxy.ts` sends `X-Figma-User`
alongside `Authorization` whenever both are known. Publish and rotate build
their identity with a new `publishAuth()` that keeps a license key even when
it is known inactive, since the key proves ownership of libraries published
under it, and the Figma header carries the free tier. AI writing and the quota
probe keep using `effectiveAuth()`, which drops an inactive key, because the
proxy answers 401 to an inactive bearer on the AI path and the license still
wins for AI metering when a bearer is present.

### Publish screen

`publishLocked` is deleted and the publish screen is reachable on every plan.
The definition line sits at the top of the screen. Under the primary action,
one line reads the `publish` snapshot from the quota response:

- Free: "3 of 10 free updates left this month, resets Oct 1"
- Pro: nothing. The row collapses, as the header does for `Pro plan active`.
- Not yet fetched or unavailable: nothing. The server is the authority and the
  publish result carries the answer.

At zero remaining the button stays enabled. Result lines, written to the
existing result slot:

- `402`: "You have used your 10 free updates for this month. Upgrade to Pro or
  publish again after Oct 1."
- `403` with `existing`: "Free plans publish one Figma file. This account
  already publishes <file name>. Upgrade to Pro to publish up to 10 files."
  When `fileName` is `null`: "…already publishes another file."
- Cached no-op: "Nothing changed since the last publish."
- Success: unchanged from today, plus the updates line refreshes from the
  response headers.

Dates are formatted in UTC as short month and day, "Oct 1", matching the proxy's UTC month boundary. There is
no replace action for the library limit, since developers may be pulling the
other library.

### Copy

Every "needs an active Pro license" string in `packages/plugin/src/ui/publish.ts`
is removed. The License screen's Pro plan card detail line changes from "No monthly cap on AI writing or library maintenance"
to "Up to 10 published Figma files, no monthly cap on AI writing or updates". All copy follows
`docs/plugin-voice-and-copy.md`: sentence case, second person, no em dashes, no
hype words.

### Messages

No new main-thread messages. Publish info, library id storage in file plugin
data, and pull key storage in client storage are unchanged.

## Website and documentation

Website (`apps/website`):

- Pricing, Free: add "Publish 1 Figma file as a library, 10 updates a month".
- Pricing, Pro: "Publish libraries for developers to pull with the CLI" becomes
  "Publish up to 10 files as libraries, unlimited updates".
- Workflow column 03: "Publish your library with Pro, then pull it…" drops
  "with Pro".
- FAQ "Do I need Pro to generate documentation?": the answer says publishing is
  free for one Figma file with 10 updates a month, and Pro adds more files,
  unlimited updates, more AI writing, and priority support.
- New FAQ "What counts as a publish update?": one successful publish that
  changed the library counts as one update. Failed publishes do not count.
  Publishing again with nothing changed does not count. Pulling with the CLI
  never counts.
- Quickstart publish section loses its Pro prerequisite.

Repository docs:

- `packages/proxy/README.md`: both identities, the ownership rule, per-tier
  limits, the new headers and errors, the `publish` snapshot on the quota
  endpoint, and the deploy-first note.
- `docs/superpowers/specs/2026-07-11-freemium-model-design.md`: a dated note at
  the top pointing here, since its Pro tier table lists publishing.
- `CHANGELOG.md`: proxy, plugin, and website entries.
- `packages/plugin/TESTING.md`: a matrix row for a free publish and pull.
- CLI docs: no change. Pull is untouched.

## Testing

Proxy unit tests, in the existing `libraries` and `quota` suites:

- Free caller creates a library; owner is the Figma identity; response carries
  free quota headers with `used: 1`.
- Free caller updates its library; unchanged bundle hash returns the cached
  response and `used` does not move.
- Free caller's eleventh changed publish in a month returns 402 with
  `resetsAt` at the next UTC month start.
- Free caller's second create returns 403 with the first library's id and file
  name.
- Pro caller with both headers updates a library owned by the Figma identity.
- Caller with an inactive license and a Figma header updates a library owned by
  the license identity, and is metered as free.
- Rotate succeeds for a free owner and fails with `not_owner` for a stranger.
- Pro publishes are never blocked and log `fair_use_flag` past the threshold.
- `ownedLibraryIds` returns the union of both prefixes and the count check
  uses it.
- `GET /v1/quota` returns the `publish` snapshot beside the AI fields.
- `QuotaEngine` with the boost window disabled reports the monthly limit from
  first sight.

Plugin unit tests:

- `authHeaders` sends both headers when both are known, only the bearer when
  no Figma id is known, only the Figma header when no key is known.
- The publish screen renders the definition line, the three meter states, and
  the four result lines from fixture responses.
- The License screen shows the new Pro feature copy.

Website: the existing `npm run check --prefix apps/website` gate.

Manual: the `TESTING.md` row publishes from a free plan, pulls with the CLI,
republishes unchanged and confirms the count did not move, and confirms the
402 and 403 result lines.

## Rollout

1. Proxy. Old plugin builds keep working, see Compatibility.
2. Plugin. Republish rides with the pending `5.1.0` republish if timing allows.
3. Website copy, last, so the site never promises what the live plugin cannot
   do.

## Out of scope

- Metering pulls, per library or per developer.
- A replace action that moves a free plan's one library to another file.
- Team or organisation ownership.
- Bundle size or component count tiers.
- Changing `EXTRACTOR_VERSION`, the bundle format, or anything the CLI reads.
