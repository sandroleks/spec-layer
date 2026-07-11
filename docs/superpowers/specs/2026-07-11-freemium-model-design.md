# Freemium Model — Spec Layer Figma Plugin

**Date:** 2026-07-11
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
failed calls (429/5xx) never decrement quota.

---

## 2. Free tier

| Area | Included |
|---|---|
| Deterministic extraction | Everything: measure spec, states matrix, anatomy depth, variant diffs, theming, doc frames, export. No gates, ever. |
| AI prose generation | **20 generations in the first 30 days** (onboarding boost), then **7 generations/month** |
| Quota mechanics | Only uncached successful calls count; monthly reset; no rollover |

Rationale:
- Deterministic features cost $0 per use; gating them would hurt Community
  ranking and reviews (the only marketing channel) for no margin.
- The first-month boost lets a new user document a real slice of their library
  and hit the quota wall *mid-momentum* — the highest-converting moment.
- 7/month keeps a monthly re-engagement reminder that AI exists.

Free-tier identity keys off the Figma user ID (no accounts). This is
resettable by a determined user; accepted, because the maximum cost of gaming
it is ~$0.105/user/month — cheaper than any enforcement.

## 3. Pro tier — $8/month or $80/year

| Area | Included |
|---|---|
| Everything in Free | — |
| AI prose generation | **Unlimited** (marketing term; see fair use) |
| Support | Priority support |

Fair-use guardrails (hidden, enforced by the proxy):
- Soft cap **500 generations/month** per license key (≈ $5–10 max token cost;
  a power user documenting a 300-component library twice a month uses ~600
  *calls* but far fewer *uncached* generations)
- Rate limit **~10 requests/min** per key
- Monthly hard cutoff with a friendly "contact us" message
- Key-sharing detection: alert on many device fingerprints per key

Deferred (explicitly not in v1):
- **"Document entire library" bulk run** (+ Batches API integration). Ships
  later as a Pro feature drop.
- Paid-only vision tier, BYOK enterprise tier, credit packs, team/seat
  licensing.

### Why $8

- Above the "too cheap to be credible" floor, below the $10 personal-card line.
- Net after Lemon Squeezy (5% + $0.50): **$7.10/mo**.
- Annual at $80 (2 months free): LS flat fee amortizes to 0.6% instead of 6%,
  and annual survives the "done documenting for now" churn lull. Expect
  30–40% of subscribers to choose it.

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

### Monthly P&L @ 1,000 installed users

Unit economics: $8 gross → $7.10 net (LS fee) → minus ~$1.50–2.00 realistic
token cost → **~$5.10–5.60 margin per paid user (~70%)**.

| Cost item | Realistic | Worst case |
|---|---|---|
| Free-tier tokens (7 × $0.015 ceiling/user) | $20–30 (~25% active) | $105 (100% quota use) |
| Paid-tier tokens | ~$2/paid user | ~$10/paid user (soft cap) |
| Proxy infra (CF Worker/Vercel + KV) | $0–5 | ~$20 |

| Conversion | Paid | Net revenue | Total costs | Profit/mo |
|---|---|---|---|---|
| 1% | 10 | $71 | ~$50 / $145 worst | +$20 / −$74 |
| **2% (typical)** | **20** | **$142** | **~$70** | **≈ +$70** |
| 3% | 30 | $213 | ~$90 | ≈ +$125 |
| 5% | 50 | $355 | ~$130 | ≈ +$225 |

- **Break-even ≈ 9 subscribers (0.9% conversion)** — below the typical
  freemium floor of 2–5%; losing money is unlikely.
- The model scales linearly (10k users ≈ $700/mo at 2%).
- The dominant lever is conversion rate, not price — hence the generous free
  tier and the upsell placed at the exact moment quota runs out.
- Free-tier token spend is effectively CAC: max $0.105/free user/month
  steady-state, plus a one-time ceiling of ~$0.30 per new user for the
  20-generation onboarding boost.

---

## 5. Development requirements

### 5.1 License + AI proxy service (new; Cloudflare Worker or similar)

- Holds the Anthropic API key; the plugin never sees it.
- `POST /prose`: validates a Lemon Squeezy license key
  (`/v1/licenses/validate`, pull-based — no webhooks needed for v1), checks
  quota, forwards the prose request to Anthropic, returns the response with
  quota state in headers.
- Free-tier requests: identified by Figma user ID fingerprint, same endpoint,
  free quota rules.
- KV storage: per-key/per-user monthly counters, first-seen date (for the
  30-day boost), device fingerprints.
- Enforcement: 500/mo soft cap, ~10 req/min rate limit, monthly hard cutoff.
- Ops: spend alarm on the Anthropic account; anomaly alert for key sharing.

### 5.2 Plugin changes

- License key entry + activation UI; store key in `clientStorage`; offline
  grace period on validation failure.
- Route `draftProse` through the proxy — swap the injected `fetcher` target in
  `packages/extractor/src/prose/client.ts` from `api.anthropic.com` to the
  proxy (the injection point makes this a small change); remove BYOK key entry.
- Quota meter in the panel ("3/7 left this month") driven by proxy response
  headers.
- Contextual upsell: when quota hits zero mid-flow, show the upgrade prompt
  featuring *the component the user was about to document*, not a generic
  paywall.
- Quota semantics client-side: cache hits and failed calls don't decrement
  (mirror of server rules, for honest UI).

### 5.3 Lemon Squeezy setup

- Product with monthly ($8) and annual ($80) variants; license keys enabled.
- Checkout link opened from the plugin UI (external browser).

### 5.4 Telemetry

- The quota counters double as usage analytics (generation counts per
  key/user; no prompt or response content logged).
- After month one, revisit the 25%-active and 7/mo assumptions with real data
  and tune the free quota.

### 5.5 Listing & docs

- Update the Community listing with tier comparison; pricing page on the
  Lemon Squeezy storefront; update plugin README/manifest version.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Proxy abuse via leaked/shared key | Rate limit + soft cap + fingerprint alert + monthly hard cutoff |
| Free quota gaming (Figma ID reset) | Accepted; ceiling $0.105/user/mo |
| Conversion below 0.9% | Break-even loss bounded at ~$74/mo worst case; tune quota/upsell with telemetry |
| Anthropic price/model changes | Per-generation cost re-measured in this doc's method; margins have ~70% headroom |
| "Unlimited" complaints at soft cap | Cap set ~3× the heaviest realistic usage; friendly contact-us path |

## 7. Decisions log

1. Monetize the plugin only — not the docs app/CLI (2026-07-10).
2. Lemon Squeezy over Figma payments (merchant of record, license keys).
3. Bundled AI via our proxy — no BYOK in the product.
4. Free tier includes AI: 20 first-month, then 7/month.
5. All deterministic extraction free forever (philosophy A).
6. $8/mo, $80/yr; "unlimited" AI on Pro with hidden fair-use cap.
7. Bulk "document entire library" deferred — not in v1.
