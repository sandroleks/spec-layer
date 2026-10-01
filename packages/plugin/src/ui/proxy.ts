import type { ProseProxyErrorCode, ProxyQuota } from '@spec-layer/extractor';

// Production API. Keep this host aligned with the manifest's network access.
export const PROXY_URL = 'https://api.spec-layer.com';
export const CHECKOUT_URL = 'https://speclayer-docs.lemonsqueezy.com/checkout/buy/077cd029-d066-4d03-9e12-4ec25a114ba6';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';
export const SITE_URL = 'https://spec-layer.com/';
/**
 * A placeholder until the owner confirms the address (spec 2026-10-01). Mail is
 * an anchor, not openBrowser: figma.openExternal accepts http and https only.
 */
export const SUPPORT_EMAIL = 'hello@spec-layer.com';
export const SUPPORT_MAILTO =
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Spec Layer license key')}`;
export const DOCS_URL = 'https://spec-layer.com/docs/';
export const PUBLISH_DOCS_URL = 'https://spec-layer.com/docs/quickstart/#publish-pull';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/alexkurchev/';

/** One routing table for every external action on the License screen/header. */
export function licenseExternalUrl(action: string): string | null {
  switch (action) {
    case 'upgrade':
    case 'renew':
      return CHECKOUT_URL;
    case 'manage':
      return MANAGE_SUB_URL;
    default:
      return null;
  }
}

/**
 * A library id as the proxy defines it (`proxy/src/libraries.ts`). Validate
 * before putting one in a request path: the key rides in a header, so an id
 * with a slash or scheme could hand that key to another host.
 */
export const LIBRARY_ID_RE = /^lib_[0-9a-f]{24}$/;

export function isLibraryId(value: string): boolean {
  return LIBRARY_ID_RE.test(value);
}

export interface ProxyAuth {
  licenseKey: string | null;
  licenseInstanceId: string | null;
  figmaUserId: string | null;
}

/** Both proofs travel together: AI is metered against the license when present,
 *  and ownership is whichever identity created the library. */
export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  const headers: Record<string, string> = {};
  if (auth.licenseKey) {
    const bearer = auth.licenseInstanceId ? `${auth.licenseKey}:${auth.licenseInstanceId}` : auth.licenseKey;
    headers.Authorization = `Bearer ${bearer}`;
  }
  if (auth.figmaUserId) headers['X-Figma-User'] = auth.figmaUserId;
  return Object.keys(headers).length ? headers : null;
}

/** For publish and rotate. Unlike effectiveAuth, an inactive key is still sent:
 *  it proves ownership of the libraries it published. */
export function publishAuth(
  licenseKey: string | null,
  licenseInstanceId: string | null,
  figmaUserId: string | null,
): ProxyAuth {
  return { licenseKey, licenseInstanceId: licenseKey ? licenseInstanceId : null, figmaUserId };
}

/** The key wins unless known inactive (`false`), which drops to the free Figma
 *  identity instead of 401ing. `null` (not probed) still sends the key. */
export function effectiveAuth(
  licenseKey: string | null,
  licenseInstanceId: string | null,
  figmaUserId: string | null,
  licenseActive: boolean | null,
): ProxyAuth {
  const useKey = licenseActive === false ? null : licenseKey;
  return { licenseKey: useKey, licenseInstanceId: useKey ? licenseInstanceId : null, figmaUserId };
}

/** What a failed AI request cost, per kind of build. Every AI note names one. */
export const AI_CONSEQUENCE = {
  // Only writing sections become placeholders; AI text inside spec sections
  // (anatomy roles, property descriptions) is simply absent.
  component: 'sections that needed AI were added as placeholders',
  // A rebuild keeps stored prose; "added" would say it went.
  rebuild: 'sections that needed AI were left as placeholders',
  // A foundation frame renders either way; only descriptions are AI.
  foundation: 'the AI descriptions were left out',
} as const;

export type AiBuildKind = keyof typeof AI_CONSEQUENCE;

/** Cause, cost, then fix. A rebuild ends at the cost: its top-up is one-time,
 *  so "Try again" would be false. */
export function aiNote(cause: string, kind: AiBuildKind, retry: string): string {
  const note = `${cause}, so ${AI_CONSEQUENCE[kind]}.`;
  return kind === 'rebuild' ? note : `${note} ${retry}`;
}

/** A typed proxy failure, worded for the kind of build it interrupted. */
export function generationErrorCopy(code: ProseProxyErrorCode, kind: AiBuildKind = 'component'): string {
  switch (code) {
    case 'rate_limited':
      return aiNote('Too many AI writing requests in the last minute', kind, 'Try again in a minute.');
    case 'generation_pending':
      return aiNote('AI writing is still busy with an earlier request', kind, 'Try again in a minute or two.');
    default:
      return aiFailedCopy(kind);
  }
}

/** Spec Layer answered with an error, or its answer could not be read. */
export function aiFailedCopy(kind: AiBuildKind = 'component'): string {
  return aiNote('AI writing failed', kind, 'Try again.');
}

/** The request never reached Spec Layer. */
export function unreachableCopy(kind: AiBuildKind = 'component'): string {
  return aiNote('Couldn’t reach Spec Layer', kind, 'Check your connection and try again.');
}

/** fetch rejects with a TypeError naming the fetch ("Failed to fetch", "Load
 *  failed", ...). A TypeError from a code bug is not a network failure, so the
 *  message must agree as well as the type. */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Figma plugin, added Sep 23, 2026", as Manage subscription lists it. Local
 *  date; a fixed month table so the name does not vary with locale. */
export function activationInstanceName(now: Date): string {
  return `Figma plugin, added ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

export async function activateLicense(
  key: string,
  instanceId: string | null,
  fetcher: typeof fetch = window.fetch.bind(window),
  now: Date = new Date(),
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  // With a known instance id the proxy re-validates instead of registering a
  // new device, so repeat clicks never burn the key's activation limit.
  const body = instanceId ? { key, instanceId } : { key, instanceName: activationInstanceName(now) };
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

/** Pro is never exhausted; a null quota tells us nothing, so it is not. */
export function isQuotaExhausted(q: ProxyQuota | null): boolean {
  if (!q || q.tier === 'pro') return false;
  const remaining = q.remaining ?? Math.max(0, (q.limit ?? 0) - q.used);
  return remaining <= 0;
}
