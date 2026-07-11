# Freemium Model — Spec Layer Figma Plugin

**Date:** 2026-07-11 (rev 2, after review)
**Status:** Approved design (brainstorm complete)
**Scope:** The standalone Figma plugin only. The docs app, CLI, and MCP directions are out of scope.

---

## 1. Summary

The plugin moves to a freemium model. All deterministic extraction stays free;
AI prose generation is the metered, paid engine. Payments and license keys run
through Lemon Squeezy (merchant of record). AI calls move from
user-supplied API keys (BYOK) to a proxy service we operate — users never see
an API key, and we pay Anthropic.

One "generation" = one **uncached, successful** call to the prose endpoint.
Cache hits (unchanged component, same prose keys — the v8 `proseCacheKey`) and
failed calls (429/5xx) never decrement quota. **The server is the sole
authority on what counts** (§6.1); the client mirrors the rules for display
only.

---

## 2. Free tier

| Area | Included |
|---|---|
| Deterministic extraction | Everything: measure spec, states matrix, anatomy depth, variant diffs, theming, doc frames, export. No gates, ever. |
| AI prose generation | **20 generations in the first 30 days** (onboarding boost), then **10 generations/month** |
| Quota mechanics | Only uncached successful calls count; monthly reset; no rollover |

Rationale:
- Deterministic features cost $0 per use; gating them would hurt Community
  ranking and reviews (the only marketing channel) for no margin.
- The first-month boost lets a new user document a real slice of their library
  and hit the quota wall *mid-momentum* — the highest-converting moment.
- 10/month (raised from 7 in review) is roughly two components per week —
  enough to sustain a habit. The delta costs at most ~$0.05/active free user;
  conversion data matters more than that cost. Revisit with telemetry.

Free-tier identity keys off a **salted server-side hash** of the Figma user ID
(no accounts). Resettable by a determined user; accepted, because the maximum
cost of gaming it is ~$0.15/user/month — cheaper than any enforcement.

## 3. Pro tier — $8/month or $80/year

| Area | Included |
|---|---|
| Everything in Free | — |
| AI prose generation | **Unlimited for normal individual use** (see fair use) |
| Support | Priority support |

### Fair-use policy (published, discoverable)

Marketing copy never says bare "Unlimited". The wording:

> *Unlimited AI prose generation for normal individual use. Automated,
> shared, or exceptionally high-volume usage may be limited under our
> fair-use policy.*

A short public fair-use page states that safeguards exist without
prominently advertising numbers. Internal semantics (v1):

- **Soft threshold: 1,000 generations/month** per license key. Crossing it
  triggers *review*, not an automatic stop. (A first full documentation run
  of a large library is legitimate and cache-cold; it must not be punished.)
- **Hard stop only on abuse patterns**: sustained rate-limit hits, scripted
  request shapes, many concurrent activations. Always paired with a
  "contact us" path and, for legitimate users, an immediate quota raise.
- Rate limit **~10 requests/min** per key.
- Quota is request-count based for v1 (simpler); token-based metering is a
  later refinement if the distribution warrants it.

Cost ceiling at the soft threshold: 1,000 × $0.015 ≈ $15 — a rare negative-
contribution month for that user ($7.10 − $15), acceptable as a tail case
because the threshold triggers review before it repeats.

### Deferred (explicitly not in v1)

- **"Document entire library" bulk run** (+ Batches API integration). Ships
  later as a Pro feature drop.
- Paid-only vision tier, BYOK enterprise tier, credit packs, team/seat
  licensing, device-fingerprint key-sharing detection (§6.5).

### Why $8

- Above the "too cheap to be credible" floor, below the $10 personal-card line.
- Monthly: $8 − (5% + $0.50) = **$7.10 net/mo**.
- Annual: $80 − ~$4.50 = $75.50 net = **$6.29 effective net/mo**. The flat
  fee amortizes (0.6% vs 6%) and annual survives the "done documenting for
  now" churn lull. Expect 30–40% of subscribers to choose it.

---

## 4. Cost model

### Per-generation cost (measured from the codebase)

Measured with `button.json` / `chip.json` fixtures through
`extract()` → `buildProsePrompt()`; model `claude-haiku-4-5`
($1/MTok in, $5/MTok out), `max_tokens: 3000`.

| Component | Tokens | Cost |
|---|---|---|
| Input (system + few-shot + user prompt) | ~3,200–3,300 | ~$0.0033 |
| Input incl. component image (vision path) | +1,100–1,600 | ~$0.005 |
| Output (typical ~1,500 / max 3,000) | 1,500–3,000 | $0.0075–$0.015 |
| **Total per generation** | | **~$0.01 typical, ~$0.02 worst case** |

Notes:
- Anthropic prompt caching does **not** apply: the stable prefix (~2,400
  tokens) is under Haiku 4.5's 4,096-token minimum cacheable prefix. Irrelevant
  at these request sizes.
- The client-side content-hash cache is the real cost saver: unchanged
  components never hit the API.

### Subscriber contribution (monthly vs annual modeled separately)

| | Monthly plan | Annual plan |
|---|---|---|
| Net revenue /mo | $7.10 | $6.29 |
| Realistic AI cost /mo | $1.50–2.00 | $1.50–2.00 |
| **Contribution /mo** | **$5.10–5.60** | **$4.29–4.79** |
| Blended (65/35 mix) | ~**$4.80–5.30** | |

Worst-case caveat: a subscriber consistently at the fair-use ceiling costs
more than they pay ($7.10 − $15 ≈ −$8). **More subscribers cannot fix
negative per-subscriber economics** — the fair-use review process (§3) is
what keeps the tail bounded, and must exist before scale.

### Monthly P&L @ 1,000 installed users

| Cost item | Realistic | Worst case |
|---|---|---|
| Free-tier tokens (10 × $0.015 ceiling/user) | $25–40 (~25% active) | $150 (100% quota use) |
| Paid-tier tokens | ~$2/paid user | ~$15/paid user (soft threshold) |
| Proxy infra (CF Worker/Vercel + KV) | $0–5 | ~$20 |

| Conversion | Paid | Net revenue (blended) | Total costs | Profit/mo |
|---|---|---|---|---|
| 1% | 10 | $68 | ~$65 realistic | ≈ break-even |
| **2% (typical)** | **20** | **$137** | **~$85** | **≈ +$50** |
| 3% | 30 | $205 | ~$105 | ≈ +$100 |
| 5% | 50 | $342 | ~$145 | ≈ +$195 |

- **Realistic break-even: ~6–10 monthly-equivalent subscribers**, depending
  on free-tier activity and infra ((~$30–45 fixed costs) ÷ (~$4.80
  blended contribution)). Within the typical 2–5% freemium conversion range
  at 1000 users. All conversion figures are assumptions until launch —
  validating real conversion is the point of shipping v1.
- The model scales linearly (10k users ≈ $500/mo at 2%).
- The dominant lever is conversion rate, not price — hence the generous free
  tier and the upsell placed at the exact moment quota runs out.
- Free-tier token spend is effectively CAC: max $0.15/free user/month
  steady-state, plus a one-time ceiling of ~$0.30 per new user for the
  20-generation onboarding boost.

---

## 5. Plugin UX

Principle: **the free product is never degraded by declining to pay — paying
only adds.** AI is opt-in via the existing "Write with AI" preference; the
pipeline already degrades gracefully (`renderSpec(spec, { prose: null })`).

### Core states

1. **AI off** — no quota UI, no license prompts, no AI branding. Full doc
   frames with every deterministic section; prose sections render as editable
   placeholder text for manual writing. A complete, unlimited free tool.
2. **AI on, free user** — quota meter near the generate button:
   "6/10 AI generations left this month" (first month: "18/20").
3. **AI on, quota exhausted** — generation is **never blocked**. Inline fork:
   *"You've used your free AI generations for July — [Upgrade – $8/mo]
   [Continue without AI]"*. The upsell names the component being documented.
4. **Pro** — license key entered once in settings → quiet "Pro" badge, no
   counters (a gentle heads-up appears only near the fair-use threshold).

### License lifecycle states (all must be designed, not improvised)

| State | UI behavior |
|---|---|
| Invalid key | Inline error, re-entry |
| Key at activation limit | Explain + link to deactivate other devices (LS portal) |
| Cancelled, active until period end | Pro until date X; renewal prompt near expiry |
| Payment failed (past due) | Grace banner, link to update payment |
| Expired | Revert to free tier gracefully; key retained for easy resubscribe |
| Validation service unreachable | Honor cached status within grace window (§6.4); banner if grace exceeded |
| Fair-use restricted | Explain + contact link |
| Upgrade completed but key not yet active | "Processing…" with retry |
| Key removal / switching | Explicit "deactivate this device" action |

Settings panel: license key field, "Manage subscription" (LS customer
portal), AI toggle, privacy policy link.

---

## 6. Development requirements

### 6.1 License + AI proxy service (new; Cloudflare Worker or similar)

The proxy is the **sole authority** for quota. Request flow:

1. Plugin computes the prose cache key (`proseCacheKey`) and a unique
   idempotency key; sends both with the request.
2. Proxy atomically checks: idempotency record → short-TTL response cache →
   quota counter (in that order).
3. Proxy calls Anthropic only when required.
4. Proxy increments usage **only after a valid successful response**, via
   atomic counter update.
5. Proxy returns the response plus authoritative remaining quota in headers.

A modified client claiming "cache hit" gains nothing: cache-hit
determination happens server-side.

**Idempotency & races** (higher priority than abuse tooling):
- Unique request key per generation attempt; a short-lived "generation in
  progress" reservation prevents two plugin windows generating the same
  component simultaneously and double-billing.
- Responses cached by (idempotency key, prose cache key) with **24h TTL** —
  kills the "Anthropic succeeded but the plugin timed out, user retries"
  double-charge. This is the only server-side content storage; it is
  short-lived and disclosed in the privacy policy. The long-lived prose cache
  stays client-side.

**Storage (KV):** per-key/per-user monthly counters, first-seen date (30-day
boost), license status cache, idempotency records. No prompt or prose
content beyond the 24h idempotency cache. Usage records strictly separated
from content.

**Enforcement:** 1,000/mo soft threshold → review; rate limit ~10 req/min;
hard stop only on abuse patterns, always with a contact path.

**Ops:** spend alarm on the Anthropic account; anomaly logging (rate-limit
hits, activation spikes).

### 6.2 Plugin changes

- License key entry + activation UI with the full state machine of §5; store
  key in `clientStorage`.
- Route `draftProse` through the proxy — swap the injected `fetcher` target in
  `packages/extractor/src/prose/client.ts` from `api.anthropic.com` to the
  proxy; remove BYOK key entry. Send prose cache key + idempotency key.
- Quota meter + contextual upsell (§5), driven by proxy response headers.
- Client-side cache/quota display mirrors server rules for honest UI, but
  never decides.

### 6.3 Lemon Squeezy setup

- Product with monthly ($8) and annual ($80) variants; license keys enabled
  with an activation limit (e.g. 3 devices).
- Checkout link opened from the plugin UI (external browser).

### 6.4 License validation (cached, not per-request)

- Validate against LS at **activation**, then cache status server-side for
  **12–24h**; revalidate periodically in the background.
- **Offline/LS-outage grace period: max 5 days** honoring the cached status;
  after that, degrade to free tier with a clear banner.
- Revoke locally when a later validation fails (refund, chargeback,
  cancellation past period end).

### 6.5 Abuse detection (v1 = simple)

- License activation count (LS built-in) + per-key rate limiting + monthly
  quota + anomaly logging.
- **Device fingerprinting is deferred**: it adds privacy/ops complexity,
  won't stop determined sharing, and false-positives on desktop/browser or
  machine changes.

### 6.6 Privacy (required before release)

- Privacy policy accessible from the plugin and the listing, covering: what
  is stored (salted-hashed Figma ID, counters, first-seen date, license
  status, 24h idempotency cache), retention periods, deletion/contact
  mechanism.
- No prompt or generated-prose logging by default.
- Figma user IDs hashed server-side with a salt; treat all of it as
  pseudonymous personal data (EU-facing).

### 6.7 Telemetry

- Quota counters double as usage analytics (counts only, no content).
- After month one, validate the assumptions that matter: conversion rate,
  %-active free users, generations-per-user distribution. Tune the free
  quota and fair-use threshold with data.

### 6.8 Listing & docs

- Community listing with tier comparison; fair-use policy page; pricing page
  on the Lemon Squeezy storefront; plugin README/manifest version bump.
- Listing framing: *"Free forever for extraction. AI writes the prose —
  10 free/month, unlimited on Pro."*

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Proxy abuse via leaked/shared key | Rate limit + soft threshold review + activation limit + hard stop on abuse patterns |
| Retry double-billing race | Idempotency keys + reservation + 24h response cache (§6.1) |
| Free quota gaming (Figma ID reset) | Accepted; ceiling ~$0.15/user/mo |
| Negative-contribution subscribers (tail) | Fair-use review before it repeats; token-based metering as escalation |
| Conversion below ~1% | Loss bounded (~$75/mo worst case); tune quota/upsell with telemetry |
| LS outage breaking Pro users | 12–24h status cache + 5-day grace |
| Privacy/GDPR exposure | §6.6: policy, hashing, separation, deletion path, minimal retention |
| Anthropic price/model changes | Per-generation cost re-measurable via this doc's method; ~70% margin headroom |

## 8. Decisions log

1. Monetize the plugin only — not the docs app/CLI (2026-07-10).
2. Lemon Squeezy over Figma payments (merchant of record, license keys).
3. Bundled AI via our proxy — no BYOK in the product.
4. Free tier includes AI: 20 first-month, then 10/month (raised from 7 in review).
5. All deterministic extraction free forever (philosophy A).
6. $8/mo, $80/yr; "unlimited for normal individual use" + published fair-use
   policy; 1,000/mo internal soft threshold, review-first (rev 2 — replaced
   the contradictory "soft cap + hard cutoff at 500").
7. Bulk "document entire library" deferred — not in v1.
8. Server-authoritative quota with idempotency/reservation handling (rev 2).
9. Device fingerprinting deferred; simple abuse detection first (rev 2).
10. Monthly and annual economics modeled separately; realistic break-even
    6–10 subscribers (rev 2).
