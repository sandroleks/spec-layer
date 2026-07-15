import { sha256 } from 'js-sha256';

export const LICENSE_CACHE_TTL_MS = 24 * 3600_000;
export const LICENSE_GRACE_MS = 5 * 864e5;

export const LICENSE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 30 days — comfortably past the 5-day grace window, so grace reads never miss. */
export const LICENSE_CACHE_KV_TTL_S = 30 * 86400;

const LS_BASE = 'https://api.lemonsqueezy.com/v1/licenses';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface LicenseDeps { fetcher: typeof fetch; cache: KVLike; now: () => number }

export type LicenseReason = 'invalid' | 'expired' | 'inactive' | 'unreachable';
export type LicenseResult = { tier: 'pro' } | { tier: 'free'; reason: LicenseReason };

/** LS could not give a verdict (429, 5xx, or a body with no boolean `valid`). */
export class LsUnreachable extends Error {
  constructor() { super('lemon squeezy unreachable'); this.name = 'LsUnreachable'; }
}

interface CacheEntry { status: string; validatedAt: number }

const cacheKey = (key: string, instanceId: string | null) =>
  `lic:${sha256(instanceId ? `${key}:${instanceId}` : key)}`;

async function readCache(deps: LicenseDeps, key: string, instanceId: string | null): Promise<CacheEntry | null> {
  const raw = await deps.cache.get(cacheKey(key, instanceId));
  return raw ? (JSON.parse(raw) as CacheEntry) : null;
}

async function writeCache(deps: LicenseDeps, key: string, instanceId: string | null, entry: CacheEntry): Promise<void> {
  await deps.cache.put(cacheKey(key, instanceId), JSON.stringify(entry), { expirationTtl: LICENSE_CACHE_KV_TTL_S });
}

function toResult(status: string): LicenseResult {
  if (status === 'active') return { tier: 'pro' };
  const reason: LicenseReason =
    status === 'expired' ? 'expired' : status === 'inactive' ? 'inactive' : 'invalid';
  return { tier: 'free', reason };
}

type RawLsData = Record<string, unknown> & { license_key?: { status?: unknown }; instance?: { id?: unknown } };
type LsOutcome = { kind: 'verdict'; reportedStatus: string; data: RawLsData } | { kind: 'transient' };

/**
 * Fetches an LS endpoint and classifies the response as a verdict or a
 * transient failure. LS rate limits (429) and server errors (5xx) return
 * JSON error bodies that would otherwise read as 'invalid' and poison the
 * cache for 24h — those are transient, as is any 200 body missing the
 * endpoint's own verdict flag (`valid` for /validate, `activated` for
 * /activate — /activate's success payload has no top-level `valid`, so
 * checking for `valid` there would misclassify every real activation as
 * transient).
 */
async function callLs(path: string, body: unknown, deps: LicenseDeps, verdictKey: 'valid' | 'activated'): Promise<LsOutcome> {
  let res: Response;
  let data: unknown;
  try {
    res = await deps.fetcher(`${LS_BASE}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch {
    return { kind: 'transient' };
  }
  if (res.status === 429 || res.status >= 500) return { kind: 'transient' };
  const d = data as RawLsData;
  if (typeof d?.[verdictKey] !== 'boolean') return { kind: 'transient' };
  const reportedStatus = typeof d.license_key?.status === 'string' ? d.license_key.status : 'invalid';
  return { kind: 'verdict', reportedStatus, data: d };
}

/**
 * Defense-in-depth: a reported 'active' status paired with `valid !== true`
 * never grants pro, even in the status we cache — it maps to 'invalid'.
 * Every other reported status (expired/inactive/whatever LS sends) passes
 * through unchanged, since it's already a non-pro verdict.
 */
function effectiveStatus(reportedStatus: string, valid: boolean): string {
  if (valid) return 'active';
  return reportedStatus === 'active' ? 'invalid' : reportedStatus;
}

export async function checkLicense(
  key: string, instanceId: string | null, deps: LicenseDeps,
): Promise<LicenseResult> {
  if (!LICENSE_KEY_RE.test(key)) return { tier: 'free', reason: 'invalid' };
  const now = deps.now();
  const cached = await readCache(deps, key, instanceId);
  if (cached && now - cached.validatedAt < LICENSE_CACHE_TTL_MS) return toResult(cached.status);

  const body = instanceId ? { license_key: key, instance_id: instanceId } : { license_key: key };
  const out = await callLs('validate', body, deps, 'valid');
  if (out.kind === 'transient') {
    // Outage: honor a previously validated status within the grace window.
    if (cached && now - cached.validatedAt < LICENSE_GRACE_MS) return toResult(cached.status);
    return { tier: 'free', reason: 'unreachable' };
  }
  const valid = out.data.valid === true && out.reportedStatus === 'active';
  const status = effectiveStatus(out.reportedStatus, valid);
  await writeCache(deps, key, instanceId, { status, validatedAt: now });
  return toResult(status);
}

/**
 * Confirm a license (optionally a specific already-activated instance) without
 * consuming a device slot. Writes the cache on a definitive verdict so a
 * renewal seen here is immediately visible to checkLicense (quota/prose).
 * Throws LsUnreachable when LS gives no verdict. The returned `status` is
 * LS's raw reported status (callers may want to know it claimed 'active'
 * even when `valid` says otherwise); the *cached* status is the demoted one,
 * so a bad verdict can never be replayed as pro from the cache.
 */
export async function validateLicense(
  key: string, instanceId: string | null, deps: LicenseDeps,
): Promise<{ valid: boolean; status: string }> {
  const body = instanceId ? { license_key: key, instance_id: instanceId } : { license_key: key };
  const out = await callLs('validate', body, deps, 'valid');
  if (out.kind === 'transient') throw new LsUnreachable();
  const valid = out.data.valid === true && out.reportedStatus === 'active';
  await writeCache(deps, key, instanceId, { status: effectiveStatus(out.reportedStatus, valid), validatedAt: deps.now() });
  return { valid, status: out.reportedStatus };
}

export async function activateLicense(
  key: string, instanceName: string, deps: LicenseDeps,
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  const out = await callLs('activate', { license_key: key, instance_name: instanceName }, deps, 'activated');
  if (out.kind === 'transient') throw new LsUnreachable();
  const activated = Boolean(out.data.activated);
  const instanceId = typeof out.data.instance?.id === 'string' ? out.data.instance.id : undefined;
  if (activated) {
    // Cache under the instance-qualified key so it matches the bearer the
    // plugin will send on the very next request (`KEY:instanceId`).
    await writeCache(deps, key, instanceId ?? null, { status: out.reportedStatus, validatedAt: deps.now() });
  }
  return { valid: activated, status: out.reportedStatus, instanceId };
}
