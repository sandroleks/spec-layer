import type { ProseProxyErrorCode, ProxyQuota } from '@spec-layer/extractor';

// Production API. Keep this host aligned with the manifest's network access.
export const PROXY_URL = 'https://api.spec-layer.com';
export const CHECKOUT_URL = 'https://speclayer-docs.lemonsqueezy.com/checkout/buy/077cd029-d066-4d03-9e12-4ec25a114ba6';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';
// Marketing / author links surfaced as icons in the tab bar.
export const SITE_URL = 'https://spec-layer.com/';
// The documentation index, linked from Settings > About.
export const DOCS_URL = 'https://spec-layer.com/docs/';
// The publish and pull workflow, linked from the Publish screen's footer.
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
    case 'support':
      return SITE_URL;
    default:
      return null;
  }
}

/**
 * A library id, exactly as the proxy defines it (`proxy/src/libraries.ts`).
 *
 * Every caller that interpolates an id into a request path validates it first.
 * The id lands in the URL while the pull key travels in the Authorization
 * header, so a value carrying a slash or a scheme would address a different
 * host and hand that key to whoever answers. The stored id has always come
 * from a publish response, so this is a guard rather than a known hole, and it
 * is cheap enough to keep the class of bug closed.
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

/**
 * What a failed AI request cost, per kind of build. Every AI note, from a spent
 * allowance to an unreachable Spec Layer, names one of these.
 */
export const AI_CONSEQUENCE = {
  // Only the writing sections become placeholders; AI text inside sections
  // built from the spec (anatomy roles, property descriptions) is simply
  // absent, so the note names the sections that needed AI, not "the AI sections".
  component: 'sections that needed AI were added as placeholders',
  // A rebuild keeps the prose the document already had, so only what was
  // still empty is a placeholder; "added" would say the stored prose went.
  rebuild: 'sections that needed AI were left as placeholders',
  // A foundation frame has no AI sections, only group descriptions and
  // collection overviews on top of a frame that renders either way.
  foundation: 'the AI descriptions were left out',
} as const;

export type AiBuildKind = keyof typeof AI_CONSEQUENCE;

/**
 * One failure note: the cause and what it cost, then the fix.
 *
 * A rebuild ends at the cost. It is a Library update's one-time AI top-up for
 * a doc from an older extractor, and the rebuilt doc is no longer stale, so
 * updating it again never asks AI again. "Try again" would be false there.
 */
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

/**
 * Whether a thrown error is fetch failing to reach the network.
 *
 * fetch rejects with a TypeError whose message names the fetch ("Failed to
 * fetch", "fetch failed", "Load failed", "NetworkError when attempting to
 * fetch resource"). A TypeError from a bug in the code is not a network
 * failure, and telling the user to check their connection for it would be
 * false, so the message has to agree as well as the type.
 */
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

/**
 * The device name a new activation registers: "Figma plugin, added Sep 23,
 * 2026". It is what Manage subscription lists for each device, so a user
 * freeing a slot can tell one activation from another. The user's local date,
 * because that is the day they activated; a fixed month table rather than
 * Intl, so the name does not change with the machine's locale.
 */
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
