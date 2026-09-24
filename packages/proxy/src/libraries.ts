import { sha256 } from 'js-sha256';
import {
  LibraryBundleError, isSemver, libraryBundleContentHash, libraryDiff, parseLibraryBundle,
  type LibraryBundleV1, type LibraryDiff,
} from '@spec-layer/extractor';
import {
  bundlesToPrune, compactLog, currentVersion, proposalFor, readNote, readVersionLog, resolveBump, truncateChanges,
  versionBundleKey, versionsKey, type VersionLog, type VersionRecord,
} from './versions';
import { callerProofs, licenseIdentityId } from './identity';
import { checkLicense, type LibraryStore, type LicenseReason } from './license';
import { quotaHeaders } from './quota';
import type { HandlerDeps } from './handlers';
import { readBodyCapped } from './body';
import type { Tier } from './quota';

/** UTF-8 bytes of the request body. Every size check here uses the same unit. */
export const MAX_BUNDLE_BYTES = 5_000_000;
/** How many libraries one identity may own, per tier. */
export const LIBRARY_LIMITS: Record<Tier, number> = { free: 1, pro: 10 };
export const LIBRARY_ID_RE = /^lib_[0-9a-f]{24}$/;
export const PULL_KEY_RE = /^sl_[0-9a-f]{48}$/;

export interface LibraryMeta {
  /** Legacy only: libraries published before `lib:<id>:key` existed carry the
   *  digest here. New writes never set it; pull falls back to it. */
  keyHash?: string;
  licenseId: string;
  publishedAt: string;
  /** sha256 of the stored bytes. The pull `ETag`, and nothing else. */
  bundleHash: string;
  /**
   * `libraryBundleContentHash` of the stored bundle: what a developer pulls,
   * with the per-export envelope removed, so a rebuild of unchanged sources
   * matches. Absent on libraries published before it existed, and a missing
   * value can never equal a computed one, so those read as changed.
   */
  contentHash?: string;
  size: number;
  fileName: string | null;
  /**
   * The `free:<figmaHash>` identity present when this library was created (or
   * last written by its owner), if any, kept alongside `licenseId` rather than
   * instead of it. For a Pro-owned library it is a second, independent proof
   * of ownership: the license key is the only other one, and it lives in
   * per-device storage that "Remove license" (or a fresh device) can make
   * disappear for good, with no way back in. Absent on libraries written
   * before this field existed, or ones never published from a signed-in
   * Figma session; `ownedMeta` backfills it opportunistically.
   */
  figmaOwnerHash?: string;
  /**
   * The library's current semantic version, a cache of the newest record in
   * `lib:<id>:versions`. Publish reads the log, not this field, so a write
   * that stopped between the log and the meta cannot fork the version. Absent
   * on libraries published before versioning; pull then omits the header.
   */
  version?: string;
}

/**
 * KV layout. The three records a publish writes never share a field with the
 * one a rotate writes, so the two can overlap without clobbering each other:
 *   lib:<id>:bundle             the bundle JSON, verbatim
 *   lib:<id>:meta               LibraryMeta (no key digest)
 *   lib:<id>:key                sha256 of the current pull key
 *   lib:<id>:versions           VersionLog, newest first (versions.ts)
 *   lib:<id>:bundle:<version>   that version's bundle bytes, newest ten kept
 *   libowner:<licenseId>:<id>   one record per owned library, listed by prefix;
 *                               the ceiling itself is counted in the quota object
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

/** The `X-Pull-Key` header, else null. Writes to a free-plan library must carry it. */
const pullKeyOf = (req: Request): string | null => (req.headers.get('X-Pull-Key') ?? '').trim() || null;

/** True when `pullKey` hashes to this library's current (or legacy) key record. */
async function pullKeyMatches(store: LibraryStore, libraryId: string, meta: LibraryMeta, pullKey: string | null): Promise<boolean> {
  if (pullKey === null) return false;
  const keyHash = (await store.get(keyRecord(libraryId))) ?? meta.keyHash ?? null;
  return keyHash !== null && sha256(pullKey) === keyHash;
}

/**
 * The library's meta when the caller owns it, else the error Response.
 *
 * A license bearer is a secret, so possession proves ownership on its own. A
 * Figma identity is a client-asserted header that anyone who knows the user id
 * can send, so on its own it proves nothing: paired with the pull key — which
 * only the publish that created the library (or the last rotate) ever handed
 * out — it proves exactly as much as the license bearer does, and is checked
 * the same way regardless of which identity originally created the library.
 * That fallback matters most for a library created under a license key: the
 * key is this library's *only* other proof of ownership, and it lives in
 * per-device storage that "Remove license" (or a fresh device) can make
 * disappear for good, with no way back in without it.
 */
async function ownedMeta(
  store: LibraryStore, libraryId: string, owners: string[], pullKey: string | null,
): Promise<LibraryMeta | Response> {
  const metaRaw = await store.get(metaKey(libraryId));
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  if (owners.includes(meta.licenseId)) {
    if (meta.licenseId.startsWith('free:') && !(await pullKeyMatches(store, libraryId, meta, pullKey))) {
      return json(403, { error: 'not_owner' });
    }
    return meta;
  }
  if (meta.figmaOwnerHash && owners.includes(meta.figmaOwnerHash) && (await pullKeyMatches(store, libraryId, meta, pullKey))) {
    return meta;
  }
  return json(403, { error: 'not_owner' });
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

/**
 * The version record for this publish and the ordered writes that store it.
 * Order: the current bundle, the per-version bundle, the log, then the meta
 * (written by the caller). KV is not atomic, so a stop after the log leaves a
 * record the meta does not know about; publish reads the log, so that is
 * safe, and the meta is repaired on the next publish.
 */
async function writeVersion(
  store: LibraryStore,
  libraryId: string,
  stored: string,
  log: VersionLog,
  record: VersionRecord,
): Promise<VersionLog> {
  const next: VersionLog = { v: 1, records: [record, ...log.records] };
  await store.put(bundleKey(libraryId), stored);
  await store.put(versionBundleKey(libraryId, record.version), stored);
  await store.put(versionsKey(libraryId), JSON.stringify(compactLog(next)));
  return next;
}

function versionRecord(input: {
  version: string; publishedAt: string; bump: VersionRecord['bump']; minimumBump: VersionRecord['minimumBump'];
  note: string | null; contentHash: string; bundleHash: string; parsed: LibraryBundleV1; diff: LibraryDiff | null;
}): VersionRecord {
  const changes = input.diff?.changes ?? [];
  return {
    version: input.version,
    publishedAt: input.publishedAt,
    bump: input.bump,
    minimumBump: input.minimumBump,
    note: input.note,
    contentHash: input.contentHash,
    bundleHash: input.bundleHash,
    extractorVersion: input.parsed.extractorVersion,
    pluginVersion: input.parsed.pluginVersion ?? 'unknown',
    counts: input.diff?.counts ?? { major: 0, minor: 0, patch: 0 },
    ...truncateChanges(changes),
  };
}

/**
 * The 403 for a library ceiling, from the KV pre-check or from the Durable
 * Object's create count. Free callers get `existing`, the first library the
 * listing names, so the plugin can say which file already publishes; when the
 * counter knows a library the eventually consistent listing has not surfaced
 * yet, `existing` is null rather than a guess.
 */
async function libraryLimitResponse(
  store: LibraryStore, tier: Tier, limit: number, owned: number, ids: string[],
): Promise<Response> {
  if (tier !== 'free') return json(403, { error: 'library_limit', limit, owned });
  const first = ids[0];
  if (first === undefined) return json(403, { error: 'library_limit', limit, owned, existing: null });
  const existingRaw = await store.get(metaKey(first));
  const existing = existingRaw ? (JSON.parse(existingRaw) as LibraryMeta) : null;
  return json(403, { error: 'library_limit', limit, owned, existing: { libraryId: first, fileName: existing?.fileName ?? null } });
}

export async function handlePublish(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';

  // Every request spends one token from the shared request budget before
  // the Worker reads a byte of body, so a client that sends nothing but
  // malformed or oversized bodies is throttled like any other caller. The
  // publish budget below is charged only once the body says which it is.
  if (!deps.requestLimiter.allow(`libreq:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });

  const read = await readBodyCapped(req, MAX_BUNDLE_BYTES);
  if (read.kind === 'too_large') {
    return json(413, { error: 'bundle_too_large', size: read.size, limit: MAX_BUNDLE_BYTES });
  }
  if (read.kind === 'unreadable') return json(400, { error: 'invalid body' });
  const bodyBytes = read.bytes.byteLength;
  let body: { libraryId?: unknown; bundle?: unknown; dryRun?: unknown; bump?: unknown; note?: unknown; initialVersion?: unknown };
  try { body = JSON.parse(new TextDecoder().decode(read.bytes)) as typeof body; } catch { return json(400, { error: 'invalid json' }); }

  // A dry run opens the Publish screen every time it is shown, not just when
  // the publisher commits, so it must not spend the same 20/min publish
  // budget a real publish does. It shares the pull/versions request budget
  // instead, so a dry run spends two requestLimiter tokens in total (the
  // `libreq:` charge above plus this `libdry:` one): fine at 60/min, and
  // simpler than exempting the second charge for one caller.
  const limiter = body.dryRun === true ? deps.requestLimiter : deps.licenseLimiter;
  const limiterKey = body.dryRun === true ? `libdry:${ip}` : `libpub:${ip}`;
  if (!limiter.allow(limiterKey, deps.now())) return json(429, { error: 'rate_limited' });

  const caller = await resolveCaller(req, deps);
  if (caller instanceof Response) return caller;
  // A legacy plugin build that sends only a lapsed bearer gets the answer it
  // always got: publish needs a tier, rotate does not. An `unreachable`
  // verdict is not a tier either: the license may well be active, so
  // publishing it as free would meter, cap, and own the library under the
  // wrong identity. Refuse without writing and let the client retry.
  if (caller.tier === 'free' && caller.licenseReason
    && (!caller.figmaIdentity || caller.licenseReason === 'unreachable')) {
    return json(401, { error: 'license_not_active', reason: caller.licenseReason });
  }

  let parsed: LibraryBundleV1;
  try {
    parsed = parseLibraryBundle(body.bundle);
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
  // Two hashes, two questions. The byte hash is the pull ETag. The content
  // hash is "did this change what developers pull", which the byte hash cannot
  // answer: the plugin stamps a fresh generatedAt into every artifact's export
  // envelope, so the bytes differ on every click of Publish.
  const contentHash = libraryBundleContentHash(bundle);
  const store = deps.libraryStore;

  const quota = deps.quotaFor(caller.tierIdentity, 'publish');
  const respond = async (status: number, payload: Record<string, unknown>, extra: Record<string, string> = {}) =>
    json(status, payload, { ...quotaHeaders(await quota.snapshot(caller.tier)), ...extra });

  let libraryId: string | null = null;
  let meta: LibraryMeta | null = null;
  /** Libraries the KV listing attributes to the caller. Only read for a create. */
  let listed: string[] = [];
  if (body.libraryId !== undefined) {
    if (typeof body.libraryId !== 'string' || !LIBRARY_ID_RE.test(body.libraryId)) {
      return json(400, { error: 'invalid libraryId' });
    }
    const owned = await ownedMeta(store, body.libraryId, caller.owners, pullKeyOf(req));
    if (owned instanceof Response) return owned;
    libraryId = body.libraryId;
    meta = owned;
  } else {
    // The listing is the fast path and names `existing`. It is eventually
    // consistent, so the reservation below also asks the identity's Durable
    // Object, which counts creates atomically, before anything is written.
    // Usually one id on free, but a lapsed Pro license still owns every
    // library it created, so `owned` says how many and names the first.
    listed = await ownedLibraryIds(store, caller.owners);
    const limit = LIBRARY_LIMITS[caller.tier];
    if (listed.length >= limit) return libraryLimitResponse(store, caller.tier, limit, listed.length, listed);
  }

  // The same content already published to this exact target: no write, no quota
  // spent. Checked against the target's own stored hash rather than the quota
  // cache, so it can never be confused with a different library that happens
  // to share a content hash. `meta.contentHash` is undefined on libraries
  // published before it was stored, which never equals a computed hash, so
  // those republish once and gain one.
  // The stored version comes from the log. The meta's copy is a cache.
  const log: VersionLog = libraryId ? await readVersionLog(store, libraryId) : { v: 1, records: [] };
  const storedVersion = currentVersion(log);
  const unchanged = Boolean(libraryId && meta && meta.contentHash === contentHash);

  // The diff against what is stored, recomputed here on every publish and on
  // every dry run. The client's own dry-run result is never trusted.
  let diff: LibraryDiff | null = null;
  if (libraryId && meta && !unchanged) {
    const storedRaw = await store.get(bundleKey(libraryId));
    if (storedRaw !== null) {
      try {
        diff = libraryDiff(parseLibraryBundle(storedRaw), parsed);
      } catch {
        // A stored bundle this reader cannot parse has no baseline; the
        // publish still proceeds and the minimum is a patch.
        diff = null;
      }
    }
  }

  if (body.dryRun === true) {
    if (unchanged) {
      return json(200, {
        currentVersion: storedVersion, unchanged: true, minimumBump: null, proposedVersion: null,
        counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
      });
    }
    if (storedVersion === null && body.initialVersion !== undefined && body.initialVersion !== null && !isSemver(body.initialVersion)) {
      return json(400, { error: 'invalid_initial_version' });
    }
    return json(200, { unchanged: false, ...proposalFor(storedVersion, diff, body.initialVersion) });
  }

  if (unchanged && libraryId && meta) {
    return respond(200, { libraryId, publishedAt: meta.publishedAt, unchanged: true, version: storedVersion },
      storedVersion ? { 'X-Library-Version': storedVersion } : {});
  }

  const note = readNote(body.note);
  if (note === undefined) return json(400, { error: 'invalid_note' });
  const resolution = resolveBump({ storedVersion, minimumBump: diff?.minimumBump ?? null, bump: body.bump, initialVersion: body.initialVersion });
  if (!resolution.ok) return json(resolution.status, resolution.body);

  // A create is a new library by definition, so its reservation must never
  // replay an earlier one: the id is generated up front and folded into the
  // cache key itself, so two creates from identical bundles can never collide.
  // The `unchanged` case for an *existing* library is handled by the
  // stored-hash comparison above, not by this cache.
  //
  // An update is keyed by the stored state it replaces, not by its
  // destination. Keyed by destination alone, publish A, then B, then A again
  // would replay A's committed reservation inside the 24-hour response TTL
  // and answer `unchanged` while KV still held B; keyed by the content
  // transition, A, B, A, B would do the same on the fourth publish. Every
  // committed write moves `publishedAt`, so no two writes share a key, and a
  // retry that arrives after the commit is answered by the stored-hash check
  // above, not by this cache. Only a retry racing the write itself is
  // replayed, which is what the reservation is for.
  const newId = libraryId ? null : newLibraryId();
  const cacheKey = libraryId
    ? `publish:${libraryId}:${meta?.publishedAt ?? 'none'}->${contentHash}`
    : `publish:new:${newId}`;
  // An update also takes the library's lock, so a second changed publish to
  // the same library while this one is writing answers 409 instead of
  // assigning the same version. The lock remembers which cache key holds it
  // and never refuses that key, so a retry of this same publish meets only
  // its own reservation, as before. A create takes a slot in the identity's
  // library count, which the Durable Object settles atomically.
  const reserved = await quota.reserve(caller.tier, cacheKey, libraryId
    ? { lock: `publish:${libraryId}` }
    : { create: { limit: LIBRARY_LIMITS[caller.tier], listed: listed.length } });
  switch (reserved.kind) {
    case 'cached': {
      const prior = JSON.parse(reserved.body) as { libraryId: string; publishedAt: string; version?: string };
      return respond(200, { ...prior, unchanged: true }, prior.version ? { 'X-Library-Version': prior.version } : {});
    }
    case 'pending':
      return respond(409, { error: 'publish_pending' });
    case 'exhausted':
      return respond(402, { error: 'quota_exhausted', resetsAt: reserved.resetsAt });
    case 'rate_limited':
      return respond(429, { error: 'rate_limited', retryAfterMs: reserved.retryAfterMs });
    case 'library_limit':
      // `owned` counts committed and listed libraries only. Below the limit,
      // the ceiling is full of creates still in flight, any of which may yet
      // fail: saying "already publishes" would claim a library that may never
      // exist, so answer what is true, a publish in progress.
      if (reserved.owned < reserved.limit) return respond(409, { error: 'publish_pending' });
      return libraryLimitResponse(store, caller.tier, reserved.limit, reserved.owned, listed);
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
      const record = versionRecord({
        version: resolution.version, publishedAt, bump: resolution.bump, minimumBump: resolution.minimumBump,
        note, contentHash, bundleHash, parsed, diff,
      });
      const next: LibraryMeta = {
        ...meta, publishedAt, bundleHash, contentHash, size: bodyBytes, fileName, version: record.version,
        // Plants the Figma-identity fallback on a library that predates it,
        // the next time its real owner (who still holds whatever proved
        // ownership just now) publishes with a Figma identity present.
        ...(meta.figmaOwnerHash === undefined && caller.figmaIdentity ? { figmaOwnerHash: caller.figmaIdentity } : {}),
      };
      // Bundles, then the log, then the meta: the meta must never describe a
      // bundle or a version that is not there yet.
      const written = await writeVersion(store, libraryId, stored, log, record);
      await store.put(metaKey(libraryId), JSON.stringify(next));
      await Promise.all(bundlesToPrune(written).map((version) => store.delete(versionBundleKey(libraryId as string, version))));
      const snap = await quota.commit(caller.tier, cacheKey, JSON.stringify({ libraryId, publishedAt, version: record.version }));
      deps.log('library_publish', { libraryId, size: bodyBytes, version: record.version, bump: record.bump });
      return json(200, {
        libraryId, publishedAt, version: record.version, bump: record.bump, minimumBump: record.minimumBump,
      }, { ...quotaHeaders(snap), 'X-Library-Version': record.version });
    }
    const id = newId as string; // set above whenever libraryId is null
    const pullKey = newPullKey();
    const record = versionRecord({
      version: resolution.version, publishedAt, bump: resolution.bump, minimumBump: resolution.minimumBump,
      note, contentHash, bundleHash, parsed, diff: null,
    });
    const created: LibraryMeta = {
      licenseId: caller.tierIdentity, publishedAt, bundleHash, contentHash,
      size: bodyBytes, fileName, version: record.version,
      ...(caller.figmaIdentity ? { figmaOwnerHash: caller.figmaIdentity } : {}),
    };
    await writeVersion(store, id, stored, { v: 1, records: [] }, record);
    await Promise.all([
      store.put(metaKey(id), JSON.stringify(created)),
      store.put(keyRecord(id), sha256(pullKey)),
      store.put(`${ownerPrefix(caller.tierIdentity)}${id}`, publishedAt),
    ]);
    // The replay body never carries the pull key: it is handed out exactly once.
    const snap = await quota.commit(caller.tier, cacheKey, JSON.stringify({ libraryId: id, publishedAt, version: record.version }), { create: true });
    deps.log('library_publish', { libraryId: id, size: bodyBytes, created: true, version: record.version });
    return json(201, {
      libraryId: id, pullKey, publishedAt, version: record.version, bump: record.bump, minimumBump: record.minimumBump,
    }, { ...quotaHeaders(snap), 'X-Library-Version': record.version });
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
  const meta = await ownedMeta(deps.libraryStore, libraryId, caller.owners, pullKeyOf(req));
  if (meta instanceof Response) return meta;
  const pullKey = newPullKey();
  // Only the key record changes. Meta belongs to publish.
  await deps.libraryStore.put(keyRecord(libraryId), sha256(pullKey));
  deps.log('library_rotate', { libraryId });
  return json(200, { pullKey });
}

/** The meta when the bearer is this library's current pull key, else the error Response. Shared by pull and versions. */
async function pullAuthorized(req: Request, deps: HandlerDeps, libraryId: string): Promise<LibraryMeta | Response> {
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
  return meta;
}

export async function handleVersions(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`libpull:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const meta = await pullAuthorized(req, deps, libraryId);
  if (meta instanceof Response) return meta;
  const raw = (await deps.libraryStore.get(versionsKey(libraryId))) ?? JSON.stringify({ v: 1, records: [] });
  const etag = `"${sha256(raw)}"`;
  const headers: Record<string, string> = { ETag: etag, 'content-type': 'application/json' };
  if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  return new Response(raw, { status: 200, headers });
}

export async function handlePull(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`libpull:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const meta = await pullAuthorized(req, deps, libraryId);
  if (meta instanceof Response) return meta;
  const headers: Record<string, string> = {
    ETag: `"${meta.bundleHash}"`,
    'X-Published-At': meta.publishedAt,
    'content-type': 'application/json',
  };
  if (meta.version) headers['X-Library-Version'] = meta.version;
  if (req.headers.get('If-None-Match') === `"${meta.bundleHash}"`) {
    return new Response(null, { status: 304, headers });
  }
  const bundle = await deps.libraryStore.get(bundleKey(libraryId));
  if (bundle === null) return json(404, { error: 'not_found' });
  return new Response(bundle, { status: 200, headers });
}
