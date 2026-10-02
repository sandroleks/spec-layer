import { sha256 } from 'js-sha256';

export const LICENSE_CACHE_TTL_MS = 24 * 3600_000;
export const LICENSE_GRACE_MS = 5 * 864e5;

export const LICENSE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 30 days, past the 5-day grace window, so grace reads never miss. */
export const LICENSE_CACHE_KV_TTL_S = 30 * 86400;

const LS_BASE = 'https://api.lemonsqueezy.com/v1/licenses';

/**
 * A Lemon Squeezy call that hangs is an outage, not a wait: past this it is
 * `transient`, so `checkLicense` reaches its grace window instead of holding
 * the request open until the Worker is killed.
 */
export const LS_TIMEOUT_MS = 10_000;

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface LibraryStore extends KVLike {
  list(opts: { prefix: string }): Promise<{ keys: Array<{ name: string }> }>;
  /** So a pull never holds the bundle as one string. */
  getStream(key: string): Promise<ReadableStream | null>;
}

export interface LicenseDeps {
  fetcher: typeof fetch;
  cache: KVLike;
  now: () => number;
  /** Overrides LS_TIMEOUT_MS; tests only. */
  lsTimeoutMs?: number;
}

export type LicenseReason = 'invalid' | 'expired' | 'inactive' | 'unreachable';
export type LicenseResult = { tier: 'pro' } | { tier: 'free'; reason: LicenseReason };

/** LS could not give a verdict (429, 5xx, or a body with no boolean `valid`). */
export class LsUnreachable extends Error {
  constructor() { super('lemon squeezy unreachable'); this.name = 'LsUnreachable'; }
}

interface CacheEntry { status: string; validatedAt: number }

const cacheKey = (key: string, instanceId: string | null) =>
  `lic:${sha256(instanceId ? `${key}:${instanceId}` : key)}`;

/**
 * A cached verdict, or null. An entry that does not parse to one is a miss,
 * so Lemon Squeezy is asked again and the entry is overwritten, rather than
 * every request with that key failing with a 500 until the KV TTL expires.
 */
async function readCache(deps: LicenseDeps, key: string, instanceId: string | null): Promise<CacheEntry | null> {
  const raw = await deps.cache.get(cacheKey(key, instanceId));
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as Partial<CacheEntry> | null;
    return typeof entry?.status === 'string' && typeof entry.validatedAt === 'number'
      ? { status: entry.status, validatedAt: entry.validatedAt }
      : null;
  } catch {
    return null;
  }
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

type RawLsData = Record<string, unknown> & { license_key?: { status?: unknown }; instance?: { id?: unknown }; deactivated?: boolean };
type LsOutcome = { kind: 'verdict'; reportedStatus: string; data: RawLsData } | { kind: 'transient' };

/**
 * Classifies an LS response as a verdict or transient. 429 and 5xx JSON
 * error bodies would otherwise read as 'invalid' and poison the cache for
 * 24h, so they are transient, as is a body missing this endpoint's own
 * verdict flag (each success payload lacks the other endpoints' flags).
 */
async function callLs(path: string, body: unknown, deps: LicenseDeps, verdictKey: 'valid' | 'activated' | 'deactivated'): Promise<LsOutcome> {
  let res: Response;
  let data: unknown;
  try {
    res = await deps.fetcher(`${LS_BASE}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.lsTimeoutMs ?? LS_TIMEOUT_MS),
    });
    // The signal also aborts a body still streaming.
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
 * Defense-in-depth: 'active' with `valid !== true` maps to 'invalid', even in
 * the cache, so it never grants pro. Other statuses are already non-pro.
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
 * Confirm a license without consuming a device slot, caching a definitive
 * verdict so checkLicense sees a renewal at once. Throws LsUnreachable with no
 * verdict. Returns LS's raw status, but caches the demoted one, so a bad
 * verdict can never be replayed as pro.
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
): Promise<{ valid: boolean; status: string; instanceId?: string | undefined }> {
  const out = await callLs('activate', { license_key: key, instance_name: instanceName }, deps, 'activated');
  if (out.kind === 'transient') throw new LsUnreachable();
  const activated = Boolean(out.data.activated);
  const instanceId = typeof out.data.instance?.id === 'string' ? out.data.instance.id : undefined;
  if (activated) {
    // Keyed to match the `KEY:instanceId` bearer the plugin sends next.
    await writeCache(deps, key, instanceId ?? null, { status: out.reportedStatus, validatedAt: deps.now() });
  }
  return { valid: activated, status: out.reportedStatus, instanceId };
}

/**
 * Frees a device slot at LS and drops both cache entries, so a device without
 * a slot never replays a stale pro verdict. Throws LsUnreachable with no verdict.
 */
export async function deactivateLicense(
  key: string, instanceId: string, deps: LicenseDeps,
): Promise<{ deactivated: boolean }> {
  const out = await callLs('deactivate', { license_key: key, instance_id: instanceId }, deps, 'deactivated');
  if (out.kind === 'transient') throw new LsUnreachable();
  const deactivated = Boolean(out.data.deactivated);
  if (deactivated) {
    await deps.cache.delete(cacheKey(key, instanceId));
    await deps.cache.delete(cacheKey(key, null));
  }
  return { deactivated };
}
