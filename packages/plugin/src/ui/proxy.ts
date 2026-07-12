import type { ProseProxyErrorCode, ProxyQuota } from '@spec-layer/extractor';

export const PROXY_URL = 'https://spec-layer-proxy.spec-layer-test.workers.dev';
export const CHECKOUT_URL = 'https://speclayertest.lemonsqueezy.com/checkout/buy/bb2d0913-6243-47f5-94f1-dfc24a33b713';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';
// Store landing page — where a lapsed/expired subscriber repurchases Pro. A
// cancelled Lemon Squeezy subscription is resolved by buying again, not resumed
// from the customer portal. Swap for the production store URL at launch.
export const STOREFRONT_URL = 'https://speclayertest.lemonsqueezy.com';

export interface ProxyAuth { licenseKey: string | null; figmaUserId: string | null }

/** License wins over the free identity — mirrors the proxy's own precedence. */
export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  if (auth.licenseKey) return { Authorization: `Bearer ${auth.licenseKey}` };
  if (auth.figmaUserId) return { 'X-Figma-User': auth.figmaUserId };
  return null;
}

/**
 * The identity to authenticate with. The license key wins, UNLESS we've learned
 * it isn't granting Pro (`licenseActive === false`) — then we drop back to the
 * free Figma identity so AI keeps working within free limits instead of 401ing.
 * `null` (unknown, not yet probed) still uses the key so the probe can run.
 */
export function effectiveAuth(
  licenseKey: string | null,
  figmaUserId: string | null,
  licenseActive: boolean | null,
): ProxyAuth {
  return { licenseKey: licenseActive === false ? null : licenseKey, figmaUserId };
}

export type LicenseView = 'none' | 'pro' | 'inactive' | 'unknown';

/**
 * Single source of truth for what the Settings panel says about the plan.
 * We claim `inactive` ONLY on a definite free-tier response while a key is
 * stored; a null quota (offline / server unreachable) stays `unknown` so a blip
 * never reads to the user as a cancelled subscription.
 */
export function resolveLicenseView(hasKey: boolean, quota: ProxyQuota | null): LicenseView {
  if (!hasKey) return 'none';
  if (!quota) return 'unknown';
  return quota.tier === 'pro' ? 'pro' : 'inactive';
}

export function licenseStatusCopy(view: LicenseView): string {
  switch (view) {
    case 'pro': return 'Pro plan active ✓';
    case 'inactive': return "Your Pro subscription isn't active right now, so you're on the free plan. Renew to switch Pro back on.";
    case 'unknown': return 'Your Pro key is saved.';
    case 'none': return '';
  }
}

/** Activation feedback keyed on the raw Lemon Squeezy license status. */
export function activationErrorCopy(status: string): string {
  switch (status) {
    case 'expired': return 'That subscription has expired. Grab Pro again from the store to switch it back on.';
    case 'disabled': return "That key has been turned off. Reach out to support if that's unexpected.";
    default: return "We couldn't find that key. Double-check it against your purchase email.";
  }
}

/** User-facing copy for a failed generation. The raw code never reaches here. */
export function generationErrorCopy(code: ProseProxyErrorCode): string {
  switch (code) {
    case 'rate_limited': return 'Too many requests just now. Give it a minute.';
    case 'generation_pending': return "That one's already generating. Hang tight.";
    default: return "AI didn't run this time, so placeholders were used.";
  }
}

/** Quota snapshot for the meter. Null (no identity / offline) hides the meter. */
export async function fetchQuota(
  auth: ProxyAuth, fetcher: typeof fetch = window.fetch.bind(window),
): Promise<ProxyQuota | null> {
  const headers = authHeaders(auth);
  if (!headers) return null;
  try {
    const res = await fetcher(`${PROXY_URL}/v1/quota`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as ProxyQuota;
  } catch {
    return null;
  }
}

export async function activateLicense(
  key: string,
  instanceId: string | null,
  fetcher: typeof fetch = window.fetch.bind(window),
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  // With a known instance id the proxy re-validates instead of registering a
  // new device, so repeat clicks never burn the key's activation limit.
  const body = instanceId ? { key, instanceId } : { key, instanceName: 'Figma plugin' };
  const res = await fetcher(`${PROXY_URL}/v1/license/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { valid: boolean; status: string; instanceId?: string };
}

export function quotaMeterText(q: ProxyQuota | null): string {
  if (!q) return '';
  if (q.tier === 'pro') return 'Pro plan active';
  return `${q.remaining ?? 0}/${q.limit ?? 0} AI generations left this month`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function upsellText(resetsAt: string | undefined, now: Date = new Date()): string {
  void resetsAt; // reserved: could show the reset date later
  return `You've used your free AI generations for ${MONTHS[now.getUTCMonth()]}.`;
}
