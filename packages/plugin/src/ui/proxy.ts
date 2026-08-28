import type { ProseProxyErrorCode, ProxyQuota } from '@spec-layer/extractor';

// Production API. Keep this host aligned with the manifest's network access.
export const PROXY_URL = 'https://api.spec-layer.com';
export const CHECKOUT_URL = 'https://speclayer-docs.lemonsqueezy.com/checkout';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';
// Store landing page — where a lapsed/expired subscriber repurchases Pro. A
// cancelled Lemon Squeezy subscription is resolved by buying again, not resumed
// from the customer portal.
export const STOREFRONT_URL = 'https://speclayer-docs.lemonsqueezy.com';
// Marketing / author links surfaced as icons in the tab bar.
export const SITE_URL = 'https://spec-layer.com/';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/alexkurchev/';

export interface ProxyAuth {
  licenseKey: string | null;
  licenseInstanceId: string | null;
  figmaUserId: string | null;
}

/** License wins over the free identity — mirrors the proxy's own precedence. */
export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  if (auth.licenseKey) {
    const bearer = auth.licenseInstanceId ? `${auth.licenseKey}:${auth.licenseInstanceId}` : auth.licenseKey;
    return { Authorization: `Bearer ${bearer}` };
  }
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
  licenseInstanceId: string | null,
  figmaUserId: string | null,
  licenseActive: boolean | null,
): ProxyAuth {
  const useKey = licenseActive === false ? null : licenseKey;
  return { licenseKey: useKey, licenseInstanceId: useKey ? licenseInstanceId : null, figmaUserId };
}

export function generationErrorCopy(code: ProseProxyErrorCode): string {
  switch (code) {
    case 'rate_limited': return 'Too many requests just now. Give it a minute.';
    case 'generation_pending': return "That one's already generating. Hang tight.";
    default: return "AI didn't run this time, so placeholders were used.";
  }
}

/**
 * The same failures, worded for a foundation build.
 *
 * A foundation frame has no placeholders to fall back on, so the component copy
 * ("placeholders were used") describes something that did not happen. Same
 * causes, different consequence, so different words.
 */
export function groupErrorCopy(code: ProseProxyErrorCode): string {
  switch (code) {
    case 'rate_limited': return 'Too many requests just now. Give it a minute and press Update.';
    case 'quota_exhausted': return 'Your monthly AI allowance is used up.';
    case 'license_not_active': return 'The AI service did not accept this license key.';
    case 'generation_pending': return 'Another generation is already running.';
    default: return 'The AI service could not be reached.';
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
  if (!res.ok) throw new Error(`activation failed: ${res.status}`);
  return (await res.json()) as { valid: boolean; status: string; instanceId?: string };
}

/** Best-effort slot release. A failure only means the slot stays used in LS. */
export async function deactivateLicense(
  key: string,
  instanceId: string,
  fetcher: typeof fetch = window.fetch.bind(window),
): Promise<boolean> {
  try {
    const res = await fetcher(`${PROXY_URL}/v1/license/deactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId }),
    });
    if (!res.ok) return false;
    return Boolean(((await res.json()) as { deactivated?: boolean }).deactivated);
  } catch {
    return false;
  }
}

/**
 * Whether a fetched quota means the free AI allowance is used up. Pro is never
 * exhausted; a null quota (offline / not yet probed) tells us nothing, so it is
 * not treated as exhausted.
 */
export function isQuotaExhausted(q: ProxyQuota | null): boolean {
  if (!q || q.tier === 'pro') return false;
  const remaining = q.remaining ?? Math.max(0, (q.limit ?? 0) - q.used);
  return remaining <= 0;
}
