import type { ProxyQuota } from '@spec-layer/extractor';

export const PROXY_URL = 'https://spec-layer-proxy.spec-layer-test.workers.dev';
export const CHECKOUT_URL = 'https://speclayertest.lemonsqueezy.com/checkout/buy/bb2d0913-6243-47f5-94f1-dfc24a33b713';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';

export interface ProxyAuth { licenseKey: string | null; figmaUserId: string | null }

/** License wins over the free identity — mirrors the proxy's own precedence. */
export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  if (auth.licenseKey) return { Authorization: `Bearer ${auth.licenseKey}` };
  if (auth.figmaUserId) return { 'X-Figma-User': auth.figmaUserId };
  return null;
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
  key: string, fetcher: typeof fetch = window.fetch.bind(window),
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  const res = await fetcher(`${PROXY_URL}/v1/license/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, instanceName: 'Figma plugin' }),
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
