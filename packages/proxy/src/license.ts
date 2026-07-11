export const LICENSE_CACHE_TTL_MS = 24 * 3600_000;
export const LICENSE_GRACE_MS = 5 * 864e5;

const LS_BASE = 'https://api.lemonsqueezy.com/v1/licenses';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface LicenseDeps { fetcher: typeof fetch; cache: KVLike; now: () => number }

export type LicenseResult = { tier: 'pro' } | { tier: 'free'; reason: 'invalid' | 'expired' | 'unreachable' };

interface CacheEntry { status: string; validatedAt: number }

const cacheKey = (key: string) => `lic:${key}`;

async function readCache(deps: LicenseDeps, key: string): Promise<CacheEntry | null> {
  const raw = await deps.cache.get(cacheKey(key));
  return raw ? (JSON.parse(raw) as CacheEntry) : null;
}

function toResult(status: string): LicenseResult {
  if (status === 'active') return { tier: 'pro' };
  return { tier: 'free', reason: status === 'expired' ? 'expired' : 'invalid' };
}

export async function checkLicense(key: string, deps: LicenseDeps): Promise<LicenseResult> {
  const now = deps.now();
  const cached = await readCache(deps, key);
  if (cached && now - cached.validatedAt < LICENSE_CACHE_TTL_MS) return toResult(cached.status);

  let status: string;
  try {
    const res = await deps.fetcher(`${LS_BASE}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });
    const data = (await res.json()) as { valid?: boolean; license_key?: { status?: string } };
    // An LS response with valid !== true never maps to 'active', even if
    // its status field claims 'active' (defense-in-depth on the pro grant).
    const reported = data.license_key?.status ?? 'invalid';
    status = data.valid === true && reported === 'active'
      ? 'active'
      : reported === 'active' ? 'invalid' : reported;
  } catch {
    // Outage: honor a previously validated status within the grace window.
    if (cached && now - cached.validatedAt < LICENSE_GRACE_MS) return toResult(cached.status);
    return { tier: 'free', reason: 'unreachable' };
  }
  await deps.cache.put(cacheKey(key), JSON.stringify({ status, validatedAt: now } satisfies CacheEntry));
  return toResult(status);
}

export async function activateLicense(
  key: string, instanceName: string, deps: LicenseDeps,
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  const res = await deps.fetcher(`${LS_BASE}/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_name: instanceName }),
  });
  const data = (await res.json()) as {
    activated?: boolean; instance?: { id?: string }; license_key?: { status?: string };
  };
  const status = data.license_key?.status ?? 'invalid';
  if (data.activated) {
    await deps.cache.put(cacheKey(key), JSON.stringify({ status, validatedAt: deps.now() }));
  }
  return { valid: Boolean(data.activated), status, instanceId: data.instance?.id };
}
