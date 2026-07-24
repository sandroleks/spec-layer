# Subscription Lifecycle UX — Spec Layer Figma Plugin

**Date:** 2026-07-12
**Status:** Approved design (brainstorm complete)
**Scope:** The standalone Figma plugin's license/subscription surface only — the
Settings-tab activation UI, the quota meter, and the AI generation error paths.
Builds on [2026-07-11-freemium-model-design.md](2026-07-11-freemium-model-design.md).
The proxy's server-side license logic (`checkLicense`, `/v1/quota`) is already
correct and stays as-is; this work is almost entirely client-side.

---

## 1. Problem

The freemium model shipped, but the plugin only handles the happy path
(activate a valid key) and one failure (free quota exhausted). Everything in
between leaks or lies:

- **Lapsed subscription (cancel/revoke):** a Pro user whose key goes inactive
  gets a raw error string mid-session — `AI didn't run (license_not_active),
  so placeholders were used` — because `ensureProse` only special-cases
  `quota_exhausted` ([actions.ts:234](../../../packages/plugin/src/ui/actions.ts)).
- **Two contradicting sources of truth:** the Settings status line is static
  stored text (`Your Pro key is saved`, [ui.ts:478](../../../packages/plugin/src/ui/ui.ts))
  while the quota meter is live. After a lapse they disagree and nothing
  explains why.
- **Hard lockout on lapse:** `authHeaders` always prefers a stored key
  ([proxy.ts:11](../../../packages/plugin/src/ui/proxy.ts)), so an inactive key
  produces a `401` and blocks AI entirely — even though the user has a Figma
  identity with free-tier quota available.
- **Undifferentiated activation errors:** `expired`, `invalid`, and `disabled`
  all render the same "check your purchase email" copy, with the raw status
  interpolated in parentheses.
- **Other generation errors** (`rate_limited`, `generation_pending`,
  `upstream`) all dump the raw code into the banner.

Explicitly **out of scope** (YAGNI, decided in brainstorm): a "remove key" /
sign-out control. Users can still switch keys by overtyping the input and
re-activating.

---

## 2. Core decisions

1. **Keep the key on lapse, prompt to renew.** A stored key that reads inactive
   stays in `clientStorage`; the UI shows a renew prompt. Renewing reactivates
   automatically on the next check — no re-typing.
2. **Fall back to free tier on lapse.** Once a key is known inactive, the plugin
   authenticates with the Figma identity so AI keeps working within free limits.
3. **One derived source of truth.** Everything the user sees about their plan is
   computed from the live quota check plus whether a key is stored — never from
   static stored text.

---

## 3. Derived license view (single source of truth)

Replace the static status line and the separately-computed meter with one
derived value, recomputed on every quota refresh:

| Condition | `licenseView` | Meaning |
|---|---|---|
| No key stored | `none` | Free user, no key |
| Key stored + live check says Pro | `pro` | Active subscription |
| Key stored + live check **definitely** says free | `inactive` | Lapsed or revoked |
| Key stored + server unreachable (quota `null`) | `unknown` | Can't verify right now |

The `unknown` row is the safety valve: we claim `inactive` **only** on a
definite free-tier response from the server. A network blip or LS outage
(`fetchQuota` returns `null`) must never flip a paying user into a "subscription
ended" state, and must never touch the stored key.

`resolveLicenseView(hasKey: boolean, quota: ProxyQuota | null): LicenseView` is a
pure function — the first unit-test seam.

---

## 4. Auth follows the derived state

`authHeaders` gains a `licenseActive` parameter so it can decline a
known-dead key:

- `licenseActive !== false` and a key exists → `Bearer <key>` (unchanged default)
- `licenseActive === false` → skip the key, use `X-Figma-User` (free identity)

Refresh flow on load and after any identity change:

1. Key stored, status not yet known → probe `/v1/quota` with the `Bearer` key.
2. Tier `pro` → `licenseView = pro`, keep using the key.
3. Tier `free` (definite response) → mark the key inactive,
   **re-fetch `/v1/quota` with the Figma identity** (so the meter shows the
   user's real free-tier remaining, not the license identity's empty counter),
   `licenseView = inactive`.
4. `null` (unreachable) → `licenseView = unknown`, meter hidden, key untouched.
5. No key → free path, unchanged.

---

## 5. Settings panel copy per state

Plugin voice rules apply: plain, honest, peer tone; **no em dashes**
(see docs/plugin-voice-and-copy.md).

| State | Status line |
|---|---|
| Checking | `Checking…` |
| `pro` | `Pro plan active ✓` |
| `none` | *(empty — the section paragraph already explains the free plan)* |
| `inactive` | `Your Pro subscription isn't active right now, so you're on the free plan. Renew to switch Pro back on.` |
| `unknown` | `Your Pro key is saved.` |

In the `inactive` state a **Renew Pro** link points to the store landing page
(`STOREFRONT_URL`, a new constant), where the user repurchases. The always-present
**Manage subscription** link (`MANAGE_SUB_URL`, the LS customer portal) stays for
active subscribers managing billing. We route renewals to the storefront rather
than the portal because a cancelled LemonSqueezy subscription is resolved by
buying again, not resumed from the portal.

---

## 6. Mid-session generation errors

`ensureProse` branches on `ProseProxyError.code` instead of leaking it. The raw
code always goes to `console` for debugging; it never reaches the banner.

| Code | Behavior |
|---|---|
| `license_not_active` | Flip `licenseView` to `inactive`; refresh quota on the Figma identity; build **this** frame with placeholders and a one-time note. The **next** generation runs on free tier. No automatic retry of the current call. |
| `quota_exhausted` | Existing upsell fork (unchanged). |
| `rate_limited` | `Too many requests just now. Give it a minute.` |
| `generation_pending` | `That one's already generating. Hang tight.` |
| `upstream` / unknown | `AI didn't run this time, so placeholders were used.` |

The `license_not_active` note (shown on the success banner alongside the built
frame): `Your Pro subscription isn't active, so AI didn't run this time. You're
back on the free tier — the renew option is in Settings.`

`generationErrorCopy(code: ProseProxyErrorCode): string` is a pure function —
the second test seam. (The `license_not_active` state transition is handled in
`ensureProse`; the copy map covers the banner strings.)

---

## 7. Activation errors (the Activate button)

The activate handler has the raw LS status (`out.status`), so it differentiates.
Drop the `(${out.status})` interpolation entirely.

| `out.status` | Copy |
|---|---|
| `expired` | `That subscription has expired. Grab Pro again from the store to switch it back on.` (links to `STOREFRONT_URL`) |
| `disabled` | `That key has been turned off. Reach out to support if that's unexpected.` |
| `invalid` / other | `We couldn't find that key. Double-check it against your purchase email.` |
| active-but-not-activated-here (device limit) | *unchanged — already good* |
| network throw | *unchanged — already good* |

`activationErrorCopy(status: string): string` is a pure function — the third
test seam.

---

## 8. Testing

Table-driven unit tests for the four decision points, no network mocking:

1. `resolveLicenseView(hasKey, quota)` → `none` / `pro` / `inactive` / `unknown`,
   including the `quota === null` → `unknown` safety case.
2. `authHeaders(auth, licenseActive)` → Bearer when active/unknown, `X-Figma-User`
   when `licenseActive === false`, `null` when no identity.
3. `activationErrorCopy(status)` → correct branch per LS status, no raw code in
   output.
4. `generationErrorCopy(code)` → correct branch per code, no raw code in output.

Covering these pure seams exercises the behavior; the proxy handlers are already
tested and unchanged.

---

## 9. Files touched

- `packages/plugin/src/ui/proxy.ts` — new `STOREFRONT_URL` constant
  (`https://speclayertest.lemonsqueezy.com` for the current test store; swap for
  the production store URL at launch); `authHeaders(auth, licenseActive)`,
  `resolveLicenseView`, `activationErrorCopy`, `generationErrorCopy`.
- `packages/plugin/src/ui/ui.ts` — derive and render `licenseView` on refresh;
  differentiated activation-error copy; track `licenseActive`.
- `packages/plugin/src/ui/actions.ts` — `ensureProse` branches on error code;
  `license_not_active` transition and free-tier fallback.
- `packages/plugin/src/ui/render.ts` — status line driven by `licenseView`.
- Tests alongside the above (extend the existing plugin test suite).

No server / proxy changes.
