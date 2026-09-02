import { sha256 } from 'js-sha256';
import { LibraryBundleError, parseLibraryBundle } from '@spec-layer/extractor';
import { identityFromHeaders, licenseIdentityId } from './identity';
import { checkLicense, type LibraryStore } from './license';
import type { HandlerDeps } from './handlers';

/** UTF-8 bytes of the request body. Every size check here uses the same unit. */
export const MAX_BUNDLE_BYTES = 5_000_000;
export const LIBRARY_LIMIT = 10;
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

/** License-authenticated Pro caller, or the error Response to return. */
async function proCaller(req: Request, deps: HandlerDeps): Promise<{ licenseId: string } | Response> {
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity || identity.kind !== 'license') return json(401, { error: 'unauthenticated' });
  const lic = await checkLicense(identity.key, identity.instanceId, {
    fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now,
  });
  if (lic.tier !== 'pro') return json(401, { error: 'license_not_active', reason: lic.reason });
  return { licenseId: licenseIdentityId(identity.key) };
}

/** The library's meta when the caller owns it, else the error Response. */
async function ownedMeta(
  store: LibraryStore, libraryId: string, licenseId: string,
): Promise<LibraryMeta | Response> {
  const metaRaw = await store.get(metaKey(libraryId));
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  if (meta.licenseId !== licenseId) return json(403, { error: 'not_owner' });
  return meta;
}

/**
 * Ids this license owns. A legacy array is expanded into per-library records
 * first and then deleted, so a concurrent create in the same window can only
 * over-count, never lose an id.
 */
async function ownedLibraryIds(store: LibraryStore, licenseId: string): Promise<string[]> {
  const prefix = ownerPrefix(licenseId);
  const legacyRaw = await store.get(legacyOwnerKey(licenseId));
  if (legacyRaw !== null) {
    const legacy = JSON.parse(legacyRaw) as string[];
    await Promise.all(legacy.map((id) => store.put(`${prefix}${id}`, '1')));
    await store.delete(legacyOwnerKey(licenseId));
  }
  const { keys } = await store.list({ prefix });
  return keys.map((k) => k.name.slice(prefix.length));
}

export async function handlePublish(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(`libpub:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const caller = await proCaller(req, deps);
  if (caller instanceof Response) return caller;

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

  if (body.libraryId !== undefined) {
    if (typeof body.libraryId !== 'string' || !LIBRARY_ID_RE.test(body.libraryId)) {
      return json(400, { error: 'invalid libraryId' });
    }
    const meta = await ownedMeta(store, body.libraryId, caller.licenseId);
    if (meta instanceof Response) return meta;
    const next: LibraryMeta = { ...meta, publishedAt, bundleHash, size: bytes.byteLength, fileName };
    // Bundle first: meta must never describe a bundle that is not there yet.
    await store.put(bundleKey(body.libraryId), stored);
    await store.put(metaKey(body.libraryId), JSON.stringify(next));
    deps.log('library_publish', { libraryId: body.libraryId, size: bytes.byteLength });
    return json(200, { libraryId: body.libraryId, publishedAt });
  }

  const owned = await ownedLibraryIds(store, caller.licenseId);
  if (owned.length >= LIBRARY_LIMIT) return json(403, { error: 'library_limit', limit: LIBRARY_LIMIT });
  const libraryId = newLibraryId();
  const pullKey = newPullKey();
  const meta: LibraryMeta = {
    licenseId: caller.licenseId, publishedAt, bundleHash, size: bytes.byteLength, fileName,
  };
  await store.put(bundleKey(libraryId), stored);
  await Promise.all([
    store.put(metaKey(libraryId), JSON.stringify(meta)),
    store.put(keyRecord(libraryId), sha256(pullKey)),
    store.put(`${ownerPrefix(caller.licenseId)}${libraryId}`, publishedAt),
  ]);
  deps.log('library_publish', { libraryId, size: bytes.byteLength, created: true });
  return json(201, { libraryId, pullKey, publishedAt });
}

export async function handleRotate(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(`librot:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const caller = await proCaller(req, deps);
  if (caller instanceof Response) return caller;
  const meta = await ownedMeta(deps.libraryStore, libraryId, caller.licenseId);
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
