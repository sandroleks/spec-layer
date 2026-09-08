import type { ProseProxyErrorCode, ProxyQuota } from '@spec-layer/extractor';

// Production API. Keep this host aligned with the manifest's network access.
export const PROXY_URL = 'https://api.spec-layer.com';
export const CHECKOUT_URL = 'https://speclayer-docs.lemonsqueezy.com/checkout/buy/077cd029-d066-4d03-9e12-4ec25a114ba6';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';
// Marketing / author links surfaced as icons in the tab bar.
export const SITE_URL = 'https://spec-layer.com/';
// The documentation index, linked from Settings > About.
export const DOCS_URL = 'https://spec-layer.com/docs/';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/alexkurchev/';

/** One routing table for every external action on the License screen/header. */
export function licenseExternalUrl(action: string): string | null {
  switch (action) {
    case 'upgrade':
    case 'renew':
      return CHECKOUT_URL;
    case 'manage':
      return MANAGE_SUB_URL;
    case 'support':
      return SITE_URL;
    default:
      return null;
  }
}

export interface ProxyAuth {
  licenseKey: string | null;
  licenseInstanceId: string | null;
  figmaUserId: string | null;
}

/**
 * Both proofs travel together. The proxy meters AI writing against the license
 * when one is present, and library ownership is proved by whichever identity
 * created the library, so sending both costs nothing and lets a plan change
 * hands without a migration.
 */
export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  const headers: Record<string, string> = {};
  if (auth.licenseKey) {
    const bearer = auth.licenseInstanceId ? `${auth.licenseKey}:${auth.licenseInstanceId}` : auth.licenseKey;
    headers.Authorization = `Bearer ${bearer}`;
  }
  if (auth.figmaUserId) headers['X-Figma-User'] = auth.figmaUserId;
  return Object.keys(headers).length ? headers : null;
}

/**
 * The identity for publish and rotate. Unlike effectiveAuth, a key known to be
 * inactive is still sent: it no longer buys Pro, but it proves ownership of
 * the libraries it published, and the Figma header carries the free tier.
 */
export function publishAuth(
  licenseKey: string | null,
  licenseInstanceId: string | null,
  figmaUserId: string | null,
): ProxyAuth {
  return { licenseKey, licenseInstanceId: licenseKey ? licenseInstanceId : null, figmaUserId };
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
