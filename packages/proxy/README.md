# @spec-layer/proxy

The license + AI proxy for the Spec Layer Figma plugin. A Cloudflare Worker
that sits between the plugin and the Anthropic API: it
validates Lemon Squeezy licenses, enforces free/pro quotas server-side, and
holds the Anthropic key so the plugin never sees it.

## API

Auth on every endpoint: `Authorization: Bearer <license-key>` (Pro, or a
lapsed key proving ownership) and/or `X-Figma-User: <figma-user-id>` (free;
stored only as a salted SHA-256 hash). AI writing meters against the license
when a bearer is present. Library endpoints read both headers: the tier comes
from the license when it is active, and a library is owned by any identity the
caller proves.

### `POST /v1/prose`

Body: `{ "cacheKey": "prose:v9:<tier>:<hash>...", "request": <shipped prose request> }`

The proxy accepts only the two request contracts built by the extractor:
component prose (`prose:v9:`) and Foundation group descriptions
(`prose:v2:groups:`). Each carries the exact system prompt and few-shot
messages the extractor ships, the fixed output limit, a bounded generated
prompt, one `cache_control` breakpoint on the exemplar answer, and supported
base64 image blocks. The request names no model: the proxy assigns
`claude-sonnet-5` with `output_config.effort: low` to a proved Pro license and
`claude-haiku-4-5` to a Figma identity, and rejects a body that names one. The
cache key names the tier the client believes it has (`pro` or `free`); a key
whose tier disagrees with the proof is rejected with `400 tier mismatch` before
any quota is reserved, so a Haiku draft is never replayed to a Pro user.

The shipped 5.1.0 plugin's contract (`prose:v8:` and `prose:v1:groups:` keys
naming `claude-haiku-4-5`, the v8 prompt bytes) stays accepted until the 6.0.0
plugin is live. Remove that branch afterwards.

Caller-defined Anthropic options, remote image URLs, extra fields, and bodies
above 7 MB are rejected. The `cacheKey` doubles as the idempotency key: a retry
replays the stored response without a second upstream call or quota decrement.

Success: the Anthropic response JSON plus headers `X-Tier`,
`X-Quota-Used`, `X-Quota-Limit` (`unlimited` for pro), `X-Quota-Remaining`,
`X-Quota-Resets-At`.

Errors: `400` bad request/allowlist, `400 {"error":"tier mismatch"}`, `401`
unauthenticated or license not active,
`402 {"error":"quota_exhausted","resetsAt":…}`,
`409 {"error":"generation_pending"}` (another window is generating the same
component), `429 {"error":"rate_limited","retryAfterMs":…}`, `502` upstream
failure (quota not decremented).

### `GET /v1/quota`

→ `{ tier, used, limit, remaining, resetsAt, publish: { tier, used, limit, remaining, resetsAt } }`.
The top-level fields are the AI writing allowance; `publish` is the library
publish allowance, metered under the license identity on Pro and the Figma
identity otherwise.

### `POST /v1/license/activate`

Body: `{ "key": "...", "instanceName": "Figma plugin" }` →
`{ valid, status, instanceId? }` (proxies Lemon Squeezy's public activate
endpoint and caches the status).

### `POST /v1/license/deactivate`

Body: `{ "key": "...", "instanceId": "..." }` → `{ deactivated: boolean }`
(proxies Lemon Squeezy's deactivate endpoint and frees the device slot the
plugin's Remove key action releases). 400 on a missing key or instanceId,
429 under the license rate limit, 502 when Lemon Squeezy is unreachable.

### `POST /v1/libraries`

Body: `{ "libraryId"?: "lib_...", "bundle": <library bundle> }`. The bundle
must carry `schema: "spec-layer-library-bundle"`, a string `version`, and a
`components` array; the proxy validates that shape and nothing else. It never
derives, re-validates, or re-projects v5 output.

The body also accepts `dryRun: true`, `bump: "major" | "minor" | "patch"`,
`note` (up to 500 characters), and `initialVersion` (a `major.minor.patch`
semver, first publish only). Every one is optional and a plugin build that
sends none of them keeps working.

**Versions.** Every changed publish assigns a semantic version. The proxy
loads the stored bundle, runs `libraryDiff` from the extractor over Figma
facts only (component properties, variant axes and options, states, anatomy
parts, token bindings, layout and effect values, collections, modes, tokens
and their per-mode values, styles), and derives the minimum bump: a removal
or rename of a structural entity is `major`, an addition is `minor`,
everything else is `patch`. A bundle whose content hash moved without any
property change (a description edit) is a `patch`. The client may raise the
bump and never lower it; a `bump` below the minimum answers
`400 {"error":"bump_below_minimum","minimumBump":…,"proposedVersion":…}` with
no write. A first versioned publish is `1.0.0`, or `initialVersion` when it is
a valid semver (`400 {"error":"invalid_initial_version"}` otherwise), with
`bump: "initial"`. A library published before versioning gets its first
version on its next changed publish. The response carries `version`, `bump`,
and `minimumBump`, plus the header `X-Library-Version`.

**Dry run.** `dryRun: true` authenticates and authorises exactly like a
publish, then answers `200` with
`{ currentVersion, unchanged, minimumBump, proposedVersion, counts, changes, changesTruncated }`
and writes nothing, spends no quota, and takes no publish reservation. When
the content hash matches the stored one, `unchanged` is true and the bump
fields are null. The client's dry-run result is never trusted: the publish
recomputes the diff. For a library with no version yet, a dry run validates
and proposes `initialVersion` exactly as the publish would.

Omitting `libraryId` creates a library (201) and returns
`{ libraryId, pullKey, publishedAt }`. That response is the only copy of the
pull key the server ever hands back; only its SHA-256 is stored. A new library
is owned by the license identity on Pro and by the Figma identity on free.

Passing an owned `libraryId` overwrites the bundle in place (200) and returns
`{ libraryId, publishedAt }`. Ownership passes when any identity in the
request owns the library, so a library created on a free plan stays writable
after upgrading, and a library created on Pro stays writable after the license
lapses as long as the key is still sent. A library owned by a Figma identity
must also carry its current pull key as `X-Pull-Key`: the Figma user id is not
a secret, so on its own it proves nothing about a particular library, and
without the key the answer is `403 {"error":"not_owner"}`.

The same Figma-identity-plus-pull-key pair also recovers a Pro-created
library once the license key that made it is gone (removed in Settings, or a
device that never had it): every `LibraryMeta` records the Figma identity
present at creation as `figmaOwnerHash`, alongside `licenseId` rather than
instead of it, and `ownedMeta` accepts either proof. The license key is
otherwise a Pro library's *only* proof of ownership, and it lives in
per-device storage with no server-side recovery once it's gone; the Figma
identity carries no extra privilege on its own, so this costs nothing beyond
what a free-plan library already accepts. A library published before this
field existed gets it backfilled the next time its real owner publishes with
a Figma identity present, so no migration was needed.

Limits per tier: free 1 library and 10 changed publishes per UTC month; Pro 10
libraries and no fixed publish cap (`fair_use_flag` at the soft threshold).
A publish is counted only when its KV write commits. "Changed" is decided on a
content identity (`libraryBundleContentHash`), which ignores each artifact's
export id and timestamp, so a rebuild of unchanged sources matches even though
its bytes differ; `bundleHash`, the sha256 of the stored bytes, is kept only
for the pull `ETag`. Republishing content equal to the stored one returns
`200 { libraryId, publishedAt, unchanged: true }` with no write and no count.
The quota engine's 24-hour response cache still protects retries of a changed
publish, keyed by the transition (stored content hash to new one) so a revert
inside that window is a fresh reservation rather than a replay.
Successful publishes, the `unchanged` reply, and the quota refusals (402, 409, 429) carry `X-Tier` and the `X-Quota-*` headers for the publish allowance; other errors do not.

Errors: `400` invalid JSON or bundle shape, `400
{"error":"unsupported bundle version","version":"2.0.0"}`, `401` no identity,
or a lapsed key with no Figma identity, `402
{"error":"quota_exhausted","resetsAt":…}`, `403 {"error":"not_owner"}`,
`403 {"error":"library_limit","limit":1,"owned":…,"existing":{"libraryId":…,"fileName":…}}`
on free (`fileName` may be null, and `existing` is null when the library the
count refers to has not reached the KV listing yet; Pro gets `limit: 10` and
no `existing`), `404` unknown `libraryId`, `409 {"error":"publish_pending"}`
(this same publish is still writing, another changed publish to the library
holds its lock, or the identity's other creates still in flight fill the
library limit, which is not reported as `library_limit` because they may yet
fail), `413
{"error":"bundle_too_large","size":…,"limit":5000000}` (`size` is the declared
`Content-Length` when there is one, else the byte count at which the streamed read
was cut, which is over the limit and at most the body's length), `429` rate limited.

### `GET /v1/libraries/:libraryId`

Pull key required: `Authorization: Bearer sl_...`. Returns the stored bundle
verbatim with `ETag: "<bundleHash>"` and `X-Published-At`. An `If-None-Match`
matching the current hash gets a bare `304`, which is how `spec-layer status`
decides whether a local pull is behind. The response also carries
`X-Library-Version` when the library has one; a library published before
versioning omits it.

Errors: `401 {"error":"invalid_key"}` (malformed key or digest mismatch),
`404 {"error":"not_found"}`, `429`.

### `POST /v1/libraries/:libraryId/rotate`

The caller must own the library; there is no tier check. A free-plan owner
sends the current key as `X-Pull-Key` beside the Figma header. Returns
`{ pullKey }`. The previous key stops working once the KV write propagates,
up to about a minute. Errors: `401`,
`403 {"error":"not_owner"}`, `404`, `429`.

### `GET /v1/libraries/:libraryId/versions`

Pull key required, as for pull. Returns the version log
`{ "v": 1, "records": [ … ] }`, newest first. Each record carries `version`,
`publishedAt`, `bump` (`major`, `minor`, `patch`, or `initial`),
`minimumBump`, `note`, `contentHash`, `bundleHash`, `extractorVersion`,
`pluginVersion`, `counts`, `changes`, and `changesTruncated`. `changes` is
capped at 64 KB of JSON per record, cut after the last change that fits in
sorted order; `counts` always reflects the full diff. `ETag` is the sha256 of
the log bytes and a matching `If-None-Match` gets a bare `304`. A library that
predates versioning answers an empty log. Errors: `401`, `404`, `429`.

## Quota rules

- Free: 20 generations within 30 days of first sight, then 10 per UTC
  calendar month. Only uncached, successful generations count.
- Pro: no fixed monthly quota for normal individual use; flagged for fair-use
  review at ≥1,000/month (`fair_use_flag` log).
- Publishing: free 10 changed publishes per UTC calendar month, no boost
  window, one library; Pro 10 libraries, no fixed cap, flagged at the same
  soft threshold. Every create counts; an update whose content identity equals
  the stored one is a no-op that does not count, where "content identity"
  ignores each artifact's export id and timestamp; a changed update counts
  once, with the 24-hour response cache protecting retries of that same
  transition. Counted in a separate Durable Object per identity
  (`publish:<identity>`). Pull is not metered. A `dryRun` publish never
  reserves or counts.
- Quota engine rate limit: 10 uncached generation reservations/min per
  identity, both tiers.
- Request edge limiter: 60 prose requests/min and 60 quota reads/min per
  connecting IP, best-effort per isolate.
- License status cached 24h; 5-day grace on Lemon Squeezy outages.

Atomicity: one Durable Object per identity (`QuotaDO`) serializes all quota
ops. The only server-side content storage is the 24h idempotency response
cache inside the DO, one storage key per committed response (`resp:<cacheKey>`)
beside a small `engine` counter record, with the newest 500 responses retained
per identity; prompts and prose are never logged. An `engine` value written
before this split is migrated to that layout the first time it is read.

## Accepted risks and operational notes

- **License identities are hashed.** License-cache keys, quota Durable Object
  names, and log lines all carry `sha256(key)`, never the raw license key.
- **Device instances are validated per request.** Every call checks the
  `key:instanceId` bearer against Lemon Squeezy; deactivating a device in the
  LS dashboard frees its slot, visible here within the 24h cache TTL.
- **Transient Lemon Squeezy errors are never cached as verdicts.** A 429, a
  5xx, or a response with no verdict body is treated as unknown rather than
  `invalid`, so an LS outage doesn't lock out active subscribers. A 5-day
  grace window honors the last known-good status while LS is down.
- **License verdicts expire after 30 days.** KV verdict-cache entries are
  bounded by TTL, not retained indefinitely.
- **License endpoints are format-gated and rate-limited in-isolate.**
  Non-UUID keys are rejected before they reach Lemon Squeezy, and a per-IP
  limiter caps requests at 20/min. A production Cloudflare rate limiting rule,
  `Protect license endpoints`, is also active: per connecting IP it blocks for
  10 seconds after more than 5 requests in 10 seconds match
  `starts_with(http.request.uri.path, "/v1/license/")`. Reverify this zone-level
  rule after any Cloudflare account or zone migration.
- **Prose and quota endpoints are rate-limited in-isolate.** This is a
  best-effort cost-abuse backstop, not a substitute for a Cloudflare WAF rule.
- **Free identities are client-asserted.** `X-Figma-User` isn't
  authenticated; rotating it re-mints a free identity with a fresh boost
  window, bounded per request by the model/max_tokens allowlist.
- **Salt rotation resets free identities.** Changing `FIGMA_ID_SALT` renames
  every free identity's Durable Object: quotas reset and every user
  re-enters the boost window. Rotate only with that intent.
- **Published libraries live in the license-cache namespace, permanently.**
  `lib:<id>:bundle`, `lib:<id>:meta`, `lib:<id>:key`, `lib:<id>:versions`,
  `lib:<id>:bundle:<version>`, and `libowner:<licenseId>:<id>` are written
  with no `expirationTtl` into the KV namespace bound as `LICENSE_CACHE`.
  Recreating or clearing that namespace to "reset the cache" destroys every
  published library, and the pull keys cannot be recovered: only their
  SHA-256 digests were ever stored. Every affected user has to republish and
  redistribute a new setup command.
- **Version writes are not atomic, but writers no longer interleave.** A
  changed publish holds a per-library lock in the publisher's identity object
  until its KV writes commit, so a second changed publish to the same library
  answers 409 publish_pending instead of assigning the same version. A
  publish still writes the current bundle, the per-version bundle, the
  version log, then the meta, in that order. A stop
  between the log and the meta leaves a log record the meta does not carry;
  publish reads the current version from the log, so the next publish
  continues from the right number and rewrites the meta. Until then `pull`
  and `X-Library-Version` report the meta's older version.
- **The publish lock and the library count are per identity, and they
  expire.** The lock and the create slot live in the publisher's own quota
  object, so two different identities racing on one library at the same
  second (a Pro key on one device and the Figma-id-plus-pull-key proof on
  another) are not serialized against each other; the same person on two
  devices with the same key is. Both last as long as the reservation
  (`RESERVATION_TTL_MS`, two minutes). A create that dies between
  reservation and commit keeps its slot that long, so the identity's next
  create answers `409 publish_pending` until it lapses. A publish whose
  writes outlast it loses the lock and the slot while still writing, so a
  second writer can proceed in that window; its create is still counted
  once it commits. The count only goes up: there is no delete route, and a
  library removed from KV by hand still counts in its creator's object.
  What stays eventually consistent is the KV owner index: it names
  `existing`, and it is the only count for libraries created under another
  of the caller's identities, or before this counter existed.
- **The diff runs inside the Worker.** Measured at 195 ms on a synthetic
  4.2 MB bundle of 300 components with 120 bindings each and 2000 tokens,
  above the 50 ms the design hoped for and far below the paid plan's 30 s
  CPU limit per invocation. A publish is a rare request, so the diff stays
  in the request path; a Durable Object would not lower the CPU cost, only
  move it.
- **Per-version bundles are kept for the newest ten versions.** The eleventh
  publish deletes the oldest per-version bundle, and only that one: a publish
  only ever pushes one record onto the log, so at most one bundle ever falls
  out of the retained window per publish. The log keeps the full change list
  for the newest 50 versions and only the counts, note, and dates for older
  ones, so it stays small; per-version bundles are kept for the newest ten.
  The prune looks at exactly one version per publish, the one that just left
  the window, so a publish never fans out into an unbounded number of
  deletes. The cost is that a delete that fails is not retried: that
  version's bundle stays in KV until the next time something deletes it by
  hand. `lib:<id>:bundle:<version>` keys older than the newest ten are
  therefore safe to remove at any time.
- **KV writes are eventually consistent.** A publish immediately followed by
  a pull from another region can serve the previous bundle for up to about a
  minute. Republish tests should allow for that before treating a stale
  `status` result as a bug.
- **Cancellations propagate within 24h.** A refunded/cancelled subscription
  keeps Pro access until its cache entry (24h TTL) expires — a deliberate
  trade-off for staying available during Lemon Squeezy outages.
- **A bare-key bearer only checks subscription status, not the seat count.**
  `Authorization: Bearer <key>` with no `:instanceId` suffix validates that
  the key's subscription is active, but skips the per-device instance check,
  so a key used this way grants Pro without occupying a device slot. This is
  intentional backward compat for older plugin builds; the current plugin
  always sends `key:instanceId`. Lemon Squeezy still enforces the
  subscription's overall activation limit, so a bare key can't be shared
  past that ceiling. Bare-key bearers can be sunset once no legacy builds
  remain in the wild.
- **Free publishing budgets are per client-supplied identity.** The Figma user
  id is hashed with a server salt, but it is not a secret and nothing
  authenticates it. Each self-asserted identity therefore gets its own budget
  of 1 library and 10 publishes a month (the first publish counts), over up to 5 MB of KV that never
  expires. The ceiling is settled in the identity's publish Durable Object,
  so two concurrent creates from one identity cannot both pass; the KV owner
  index only names what exists. A client that lies about `X-Figma-User` can shop for fresh buckets,
  and a lapsed Pro owner can do the same for its own library, because
  ownership passes on the key while the counter follows the Figma identity.
  What a lied-about header cannot do is write to someone else's library: a
  free-owned library's update and rotate also need its current pull key.
  The per-IP limiter is the only ceiling on that. A per-IP monthly publish
  ceiling is deferred and tracked in CLAUDE.md's open list. Pro libraries are
  owned by the license hash and are as protected as before.
- **Deploy order.** The proxy ships before any plugin build that sends both
  headers. A bearer-only client keeps working: it proves the license identity
  that owns every library published so far.
- **Rolling back past the quota storage split breaks cached replays for up
  to 24 hours; prefer rolling forward.** Once a quota Durable Object has been
  read by this build, its `engine` record keeps only `{ at }` for each
  committed response and the body sits under `resp:<cacheKey>`. An older
  build reads the body from `engine`, finds none, and answers a retry of any
  key committed in the last 24 hours with a cached result that has no body:
  prose returns an empty 200 the plugin cannot parse, and a publish replay
  fails with a 500. Counters, reservations and the boost window are read the
  same by both builds and survive a rollback. The `resp:*` keys an older
  build leaves behind are never read by it and are harmless, though a key
  whose index entry that build drops is never deleted afterwards. The breakage
  ends on its own as those entries age past 24 hours, so a fix should roll
  forward rather than back.
- **Every publish request first spends one token of the 60/min per-IP request
  budget before its body is read, so malformed or oversized bodies are
  throttled.** A real publish then spends the 20/min publish budget and a dry
  run a second request token. The body is read in chunks and dropped at the
  first byte over the cap, header or no header, so the cap bounds what one
  request can make the Worker hold in memory.

## Bindings & secrets

| Name | Kind | Purpose |
|---|---|---|
| `LICENSE_CACHE` | KV namespace | Two unrelated datasets. License status cache keyed by a SHA-256 digest (30-day TTL), **and** durable library storage under `lib:` / `libowner:` keys with no expiry (see ARCHITECTURE.md for the record layout). Despite the name, this namespace is not disposable. |
| `QUOTA` | Durable Object → `QuotaDO` | Per-identity quota state |
| `ANTHROPIC_API_KEY` | secret | Upstream auth |
| `FIGMA_ID_SALT` | secret | Salted hashing of Figma user IDs. Rotating it resets all free-tier quotas — don't rotate casually. |

## Deploy

```bash
cd packages/proxy
npx wrangler kv namespace create LICENSE_CACHE   # FIRST DEPLOY ONLY; paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put FIGMA_ID_SALT            # long random string
npx wrangler deploy
```

Ops: set a spend alert on the Anthropic workspace; `fair_use_flag` and
`upstream_error` log events are the abuse/outage review queue. Workers
observability is on with every invocation sampled, so each event is readable
in the dashboard beside its request.

## Smoke test

```bash
curl -s -D - -o /dev/null https://api.spec-layer.com/v1/quota -H 'X-Figma-User: smoke-test-1'
# HTTP/2 200, X-Tier: free, X-Quota-Limit: 20

# The workers.dev origin is off (`workers_dev = false`): this must not answer 200.
curl -s -o /dev/null -w '%{http_code}\n' https://spec-layer-proxy.<account>.workers.dev/v1/quota -H 'X-Figma-User: smoke-test-1'

# Exercise POST /v1/prose through the plugin or the contract tests. Hand-written
# generic Anthropic requests are intentionally rejected.
```

## Development

```bash
npx vitest run packages/proxy      # from the repo root
npm run typecheck
npm run check:proxy-dry-run        # bundle and validate without uploading
```

All business logic is in pure, dependency-injected modules
(`src/quota.ts`, `src/quotaStore.ts`, `src/license.ts`, `src/handlers.ts`,
`src/libraries.ts`) tested without miniflare; `src/index.ts` is the thin
Cloudflare adapter, and its `QuotaDO` is four RPC methods over `QuotaStore`
that nothing but the wrangler dry run and `tsc` exercise.
