import { sha256 } from 'js-sha256';
import { LibraryBundleError, parseLibraryBundle } from '@spec-layer/extractor';
import { callerProofs, licenseIdentityId } from './identity';
import { checkLicense, type LibraryStore, type LicenseReason } from './license';
import { quotaHeaders } from './quota';
import type { HandlerDeps } from './handlers';
import type { Tier } from './quota';

/** UTF-8 bytes of the request body. Every size check here uses the same unit. */
export const MAX_BUNDLE_BYTES = 5_000_000;
export const LIBRARY_LIMITS: Record<Tier, number> = { free: 1, pro: 10 };
/** The Pro limit, kept for callers that predate per-tier limits. */
export const LIBRARY_LIMIT = LIBRARY_LIMITS.pro;
export const LIBRARY_ID_RE = /^lib_[0-9a-f]{24}$/;
export const PULL_KEY_RE = /^sl_[0-9a-f]{48}$/;

export interface LibraryMeta {
  /** Legacy only: libraries published before `lib:<id>:key` existed carry the
   *  digest here. New writes never set it; pull falls back to it. */
  keyHash?: string;
  licenseId: string;
  publishedAt: string;
  bundleHash: string;
  size: number;
  fileName: string | null;
}

/**
 * KV layout. The three records a publish writes never share a field with the
 * one a rotate writes, so the two can overlap without clobbering each other:
 *   lib:<id>:bundle             the bundle JSON, verbatim
 *   lib:<id>:meta               LibraryMeta (no key digest)
 *   lib:<id>:key                sha256 of the current pull key
 *   libowner:<licenseId>:<id>   one record per owned library, counted by prefix
 */
const bundleKey = (id: string) => `lib:${id}:bundle`;
const metaKey = (id: string) => `lib:${id}:meta`;
const keyRecord = (id: string) => `lib:${id}:key`;
const ownerPrefix = (licenseId: string) => `libowner:${licenseId}:`;
/** Pre-hardening layout: one JSON array per license. Migrated on first sight. */
const legacyOwnerKey = (licenseId: string) => `libowner:${licenseId}`;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const newLibraryId = (): string => `lib_${randomHex(12)}`;
export const newPullKey = (): string => `sl_${randomHex(24)}`;

interface Caller {
  tier: Tier;
  /** Identity the quota is counted under: license for Pro, else Figma, else license. */
  tierIdentity: string;
  /** Every identity the request proved. Any of them may own a library. */
  owners: string[];
  /** The reason checkLicense gave when a bearer was present and not active, else null. */
  licenseReason: LicenseReason | null;
  /** The free:<figmaHash> identity when a Figma proof was present, else null. */
  figmaIdentity: string | null;
}

/**
 * Who is calling and what they can prove. A bearer proves the license identity
 * whether or not the license is active, because possession of the key is the
 * proof of ownership; only the tier depends on the license being active.
 *
 * This never 401s on tier alone: a caller with any proof gets a Caller back,
 * with `licenseReason` set when a bearer was present and not active. Callers
 * that need a tier (publish) gate on that field themselves; callers that only
 * need ownership (rotate) do not.
 */
async function resolveCaller(req: Request, deps: HandlerDeps): Promise<Caller | Response> {
  const proofs = callerProofs(req.headers, deps.salt);
  if (!proofs.license && !proofs.figmaHash) return json(401, { error: 'unauthenticated' });
  const owners: string[] = [];
  let tier: Tier = 'free';
  let licenseId: string | null = null;
  let licenseReason: LicenseReason | null = null;
  if (proofs.license) {
    licenseId = licenseIdentityId(proofs.license.key);
    owners.push(licenseId);
    const lic = await checkLicense(proofs.license.key, proofs.license.instanceId, {
      fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now,
    });
    if (lic.tier === 'pro') tier = 'pro';
    else licenseReason = lic.reason;
  }
  const figmaId = proofs.figmaHash ? `free:${proofs.figmaHash}` : null;
  if (figmaId) owners.push(figmaId);
  const tierIdentity = tier === 'pro' ? (licenseId as string) : (figmaId ?? (licenseId as string));
  return { tier, tierIdentity, owners, licenseReason, figmaIdentity: figmaId };
}

/** The library's meta when the caller owns it, else the error Response. */
async function ownedMeta(
  store: LibraryStore, libraryId: string, owners: string[],
): Promise<LibraryMeta | Response> {
  const metaRaw = await store.get(metaKey(libraryId));
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  if (!owners.includes(meta.licenseId)) return json(403, { error: 'not_owner' });
  return meta;
}

/**
 * Ids owned by any of the caller's proved identities. A legacy array is
 * expanded into per-library records first and then deleted, so a concurrent
 * create in the same window can only over-count, never lose an id.
 */
async function ownedLibraryIds(store: LibraryStore, owners: string[]): Promise<string[]> {
  const all: string[] = [];
  for (const owner of owners) {
    const prefix = ownerPrefix(owner);
    const legacyRaw = await store.get(legacyOwnerKey(owner));
    if (legacyRaw !== null) {
      const legacy = JSON.parse(legacyRaw) as string[];
      await Promise.all(legacy.map((id) => store.put(`${prefix}${id}`, '1')));
      await store.delete(legacyOwnerKey(owner));
    }
    const { keys } = await store.list({ prefix });
    all.push(...keys.map((k) => k.name.slice(prefix.length)));
  }
  return all;
}

export async function handlePublish(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(`libpub:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const caller = await resolveCaller(req, deps);
  if (caller instanceof Response) return caller;
  // A legacy plugin build that sends only a lapsed bearer gets the answer it
  // always got: publish needs a tier, rotate does not.
  if (caller.tier === 'free' && caller.licenseReason && !caller.figmaIdentity) {
    return json(401, { error: 'license_not_active', reason: caller.licenseReason });
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BUNDLE_BYTES) {
    return json(413, { error: 'bundle_too_large', size: declared, limit: MAX_BUNDLE_BYTES });
  }
  let bytes: ArrayBuffer;
  try { bytes = await req.arrayBuffer(); } catch { return json(400, { error: 'invalid body' }); }
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    return json(413, { error: 'bundle_too_large', size: bytes.byteLength, limit: MAX_BUNDLE_BYTES });
  }
  let body: { libraryId?: unknown; bundle?: unknown };
  try { body = JSON.parse(new TextDecoder().decode(bytes)) as typeof body; } catch { return json(400, { error: 'invalid json' }); }

  try {
    parseLibraryBundle(body.bundle);
  } catch (err) {
    if (err instanceof LibraryBundleError && err.code === 'unsupported_version') {
      const version = (body.bundle as { version?: unknown }).version;
      return json(400, { error: 'unsupported bundle version', version: typeof version === 'string' ? version : null });
    }
    return json(400, { error: 'invalid bundle' });
  }
  const bundle = body.bundle as Record<string, unknown>;
  // Stored as the client sent it, so the pulled bytes are the published bytes.
  const stored = JSON.stringify(bundle);
  const fileName = typeof bundle.fileName === 'string' ? bundle.fileName : null;
  const publishedAt = new Date(deps.now()).toISOString();
  const bundleHash = sha256(stored);
  const store = deps.libraryStore;

  const quota = deps.quotaFor(caller.tierIdentity, 'publish');
  const respond = async (status: number, payload: Record<string, unknown>) =>
    json(status, payload, quotaHeaders(await quota.snapshot(caller.tier)));

  let libraryId: string | null = null;
  let meta: LibraryMeta | null = null;
  if (body.libraryId !== undefined) {
    if (typeof body.libraryId !== 'string' || !LIBRARY_ID_RE.test(body.libraryId)) {
      return json(400, { error: 'invalid libraryId' });
    }
    const owned = await ownedMeta(store, body.libraryId, caller.owners);
    if (owned instanceof Response) return owned;
    libraryId = body.libraryId;
    meta = owned;
  } else {
    const owned = await ownedLibraryIds(store, caller.owners);
    const limit = LIBRARY_LIMITS[caller.tier];
    if (owned.length >= limit) {
      if (caller.tier === 'free') {
        // The free limit is 1, so a free caller at the limit owns exactly one id.
        const existingRaw = await store.get(metaKey(owned[0]));
        const existing = existingRaw ? (JSON.parse(existingRaw) as LibraryMeta) : null;
        return json(403, {
          error: 'library_limit', limit,
          existing: { libraryId: owned[0], fileName: existing?.fileName ?? null },
        });
      }
      return json(403, { error: 'library_limit', limit });
    }
  }

  // Same bytes already published to this exact target: no write, no quota spent.
  // Checked against the target's own stored hash rather than the quota cache,
  // so it can never be confused with a different library that happens to share
  // a content hash.
  if (libraryId && meta && meta.bundleHash === bundleHash) {
    return respond(200, { libraryId, publishedAt: meta.publishedAt, unchanged: true });
  }

  // A create is a new library by definition, so its reservation must never
  // replay an earlier one: the id is generated up front and folded into the
  // cache key itself, so two creates from byte-identical bundles can never
  // collide. The `unchanged` case for an *existing* library is handled by the
  // stored-hash comparison above, not by this cache.
  const newId = libraryId ? null : newLibraryId();
  const cacheKey = libraryId ? `publish:${libraryId}:${bundleHash}` : `publish:new:${newId}`;
  const reserved = await quota.reserve(caller.tier, cacheKey);
  switch (reserved.kind) {
    case 'cached': {
      const prior = JSON.parse(reserved.body) as { libraryId: string; publishedAt: string };
      return respond(200, { ...prior, unchanged: true });
    }
    case 'pending':
      return respond(409, { error: 'publish_pending' });
    case 'exhausted':
      return respond(402, { error: 'quota_exhausted', resetsAt: reserved.resetsAt });
    case 'rate_limited':
      return respond(429, { error: 'rate_limited', retryAfterMs: reserved.retryAfterMs });
    case 'proceed':
      break;
    default:
      return json(500, { error: 'internal' });
  }
  if (reserved.kind === 'proceed' && reserved.flagged) {
    deps.log('fair_use_flag', { identityId: caller.tierIdentity, tier: caller.tier, surface: 'publish' });
  }

  try {
    if (libraryId && meta) {
      const next: LibraryMeta = { ...meta, publishedAt, bundleHash, size: bytes.byteLength, fileName };
      // Bundle first: meta must never describe a bundle that is not there yet.
      await store.put(bundleKey(libraryId), stored);
      await store.put(metaKey(libraryId), JSON.stringify(next));
      await quota.commit(cacheKey, JSON.stringify({ libraryId, publishedAt }));
      deps.log('library_publish', { libraryId, size: bytes.byteLength });
      return respond(200, { libraryId, publishedAt });
    }
    const id = newId as string; // set above whenever libraryId is null
    const pullKey = newPullKey();
    const created: LibraryMeta = {
      licenseId: caller.tierIdentity, publishedAt, bundleHash, size: bytes.byteLength, fileName,
    };
    await store.put(bundleKey(id), stored);
    await Promise.all([
      store.put(metaKey(id), JSON.stringify(created)),
      store.put(keyRecord(id), sha256(pullKey)),
      store.put(`${ownerPrefix(caller.tierIdentity)}${id}`, publishedAt),
    ]);
    // The replay body never carries the pull key: it is handed out exactly once.
    await quota.commit(cacheKey, JSON.stringify({ libraryId: id, publishedAt }));
    deps.log('library_publish', { libraryId: id, size: bytes.byteLength, created: true });
    return respond(201, { libraryId: id, pullKey, publishedAt });
  } catch (err) {
    await quota.release(cacheKey);
    throw err;
  }
}

export async function handleRotate(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(`librot:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const caller = await resolveCaller(req, deps);
  if (caller instanceof Response) return caller;
  const meta = await ownedMeta(deps.libraryStore, libraryId, caller.owners);
  if (meta instanceof Response) return meta;
  const pullKey = newPullKey();
  // Only the key record changes. Meta belongs to publish.
  await deps.libraryStore.put(keyRecord(libraryId), sha256(pullKey));
  deps.log('library_rotate', { libraryId });
  return json(200, { pullKey });
}

export async function handlePull(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`libpull:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const auth = req.headers.get('Authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!PULL_KEY_RE.test(key)) return json(401, { error: 'invalid_key' });
  const metaRaw = await deps.libraryStore.get(metaKey(libraryId));
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  const keyHash = (await deps.libraryStore.get(keyRecord(libraryId))) ?? meta.keyHash ?? null;
  // Digest-vs-digest comparison: timing over two fixed-length hashes reveals
  // nothing about the key itself, so plain equality is safe here.
  if (keyHash === null || sha256(key) !== keyHash) return json(401, { error: 'invalid_key' });
  const headers: Record<string, string> = {
    ETag: `"${meta.bundleHash}"`,
    'X-Published-At': meta.publishedAt,
    'content-type': 'application/json',
  };
  if (req.headers.get('If-None-Match') === `"${meta.bundleHash}"`) {
    return new Response(null, { status: 304, headers });
  }
  const bundle = await deps.libraryStore.get(bundleKey(libraryId));
  if (bundle === null) return json(404, { error: 'not_found' });
  return new Response(bundle, { status: 200, headers });
}
