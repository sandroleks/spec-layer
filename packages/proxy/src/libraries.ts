import { sha256 } from 'js-sha256';
import { identityFromHeaders, licenseIdentityId } from './identity';
import { checkLicense } from './license';
import type { HandlerDeps } from './handlers';

export const MAX_BUNDLE_CHARS = 5_000_000;
export const LIBRARY_LIMIT = 10;
export const LIBRARY_ID_RE = /^lib_[0-9a-f]{24}$/;
export const PULL_KEY_RE = /^sl_[0-9a-f]{48}$/;

export interface LibraryMeta {
  /** sha256 of the pull key. The key itself is never stored. */
  keyHash: string;
  licenseId: string;
  publishedAt: string;
  bundleHash: string;
  size: number;
  fileName: string | null;
}

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

export async function handlePublish(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(`libpub:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const caller = await proCaller(req, deps);
  if (caller instanceof Response) return caller;

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BUNDLE_CHARS + 4096) {
    return json(413, { error: 'bundle_too_large', size: declared, limit: MAX_BUNDLE_CHARS });
  }
  let raw: string;
  try { raw = await req.text(); } catch { return json(400, { error: 'invalid body' }); }
  if (raw.length > MAX_BUNDLE_CHARS + 4096) {
    return json(413, { error: 'bundle_too_large', size: raw.length, limit: MAX_BUNDLE_CHARS });
  }
  let body: { libraryId?: unknown; bundle?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return json(400, { error: 'invalid json' }); }

  const bundle = body.bundle as Record<string, unknown> | null;
  if (
    !bundle || typeof bundle !== 'object' || Array.isArray(bundle) ||
    bundle.schema !== 'spec-layer-library-bundle' ||
    typeof bundle.version !== 'string' ||
    !Array.isArray(bundle.components)
  ) {
    return json(400, { error: 'invalid bundle' });
  }
  const stored = JSON.stringify(bundle);
  if (stored.length > MAX_BUNDLE_CHARS) {
    return json(413, { error: 'bundle_too_large', size: stored.length, limit: MAX_BUNDLE_CHARS });
  }
  const fileName = typeof bundle.fileName === 'string' ? bundle.fileName : null;
  const publishedAt = new Date(deps.now()).toISOString();
  const bundleHash = sha256(stored);

  if (body.libraryId !== undefined) {
    if (typeof body.libraryId !== 'string' || !LIBRARY_ID_RE.test(body.libraryId)) {
      return json(400, { error: 'invalid libraryId' });
    }
    const metaRaw = await deps.libraryStore.get(`lib:${body.libraryId}:meta`);
    if (metaRaw === null) return json(404, { error: 'not_found' });
    const meta = JSON.parse(metaRaw) as LibraryMeta;
    if (meta.licenseId !== caller.licenseId) return json(403, { error: 'not_owner' });
    const next: LibraryMeta = { ...meta, publishedAt, bundleHash, size: stored.length, fileName };
    await deps.libraryStore.put(`lib:${body.libraryId}:bundle`, stored);
    await deps.libraryStore.put(`lib:${body.libraryId}:meta`, JSON.stringify(next));
    deps.log('library_publish', { libraryId: body.libraryId, size: stored.length });
    return json(200, { libraryId: body.libraryId, publishedAt });
  }

  const ownerKey = `libowner:${caller.licenseId}`;
  const owned = JSON.parse((await deps.libraryStore.get(ownerKey)) ?? '[]') as string[];
  if (owned.length >= LIBRARY_LIMIT) return json(403, { error: 'library_limit', limit: LIBRARY_LIMIT });
  const libraryId = newLibraryId();
  const pullKey = newPullKey();
  const meta: LibraryMeta = {
    keyHash: sha256(pullKey), licenseId: caller.licenseId, publishedAt, bundleHash, size: stored.length, fileName,
  };
  await deps.libraryStore.put(`lib:${libraryId}:bundle`, stored);
  await deps.libraryStore.put(`lib:${libraryId}:meta`, JSON.stringify(meta));
  await deps.libraryStore.put(ownerKey, JSON.stringify([...owned, libraryId]));
  deps.log('library_publish', { libraryId, size: stored.length, created: true });
  return json(201, { libraryId, pullKey, publishedAt });
}

export async function handlePull(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`libpull:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const auth = req.headers.get('Authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!PULL_KEY_RE.test(key)) return json(401, { error: 'invalid_key' });
  const metaRaw = await deps.libraryStore.get(`lib:${libraryId}:meta`);
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  // Digest-vs-digest comparison: timing over two fixed-length hashes reveals
  // nothing about the key itself, so plain equality is safe here.
  if (sha256(key) !== meta.keyHash) return json(401, { error: 'invalid_key' });
  const headers: Record<string, string> = {
    ETag: `"${meta.bundleHash}"`,
    'X-Published-At': meta.publishedAt,
    'content-type': 'application/json',
  };
  if (req.headers.get('If-None-Match') === `"${meta.bundleHash}"`) {
    return new Response(null, { status: 304, headers });
  }
  const bundle = await deps.libraryStore.get(`lib:${libraryId}:bundle`);
  if (bundle === null) return json(404, { error: 'not_found' });
  return new Response(bundle, { status: 200, headers });
}
