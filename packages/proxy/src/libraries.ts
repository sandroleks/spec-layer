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

/** UTF-8 bytes of the request body, the unit every size check here uses. */
export const MAX_BUNDLE_BYTES = 5_000_000;
export const LIBRARY_LIMITS: Record<Tier, number> = { free: 1, pro: 10 };
export const LIBRARY_ID_RE = /^lib_[0-9a-f]{24}$/;
export const PULL_KEY_RE = /^sl_[0-9a-f]{48}$/;
/** Code units of `fileName` kept in the meta and `library_limit`; the stored bundle is never cut. */
export const MAX_FILE_NAME_LENGTH = 256;

/**
 * `value` cut to at most `maxUnits` UTF-16 code units (`String.length`),
 * iterating whole code points so a surrogate pair is never split: a lone
 * surrogate has no valid UTF-8 encoding. A combining mark can still be cut
 * from its base, which drops a diacritic but never yields an invalid string.
 */
export function truncateUtf16(value: string, maxUnits: number): string {
  if (value.length <= maxUnits) return value;
  let result = '';
  for (const codePoint of value) {
    if (result.length + codePoint.length > maxUnits) break;
    result += codePoint;
  }
  return result;
}

export interface LibraryMeta {
  /** Legacy key digest from before `lib:<id>:key`; never written now, pull falls back to it. */
  keyHash?: string;
  licenseId: string;
  publishedAt: string;
  /** sha256 of the stored bytes. The pull `ETag`, and nothing else. */
  bundleHash: string;
  /** `libraryBundleContentHash`, envelope removed; absent on older libraries, which read as changed. */
  contentHash?: string;
  size: number;
  fileName: string | null;
  /**
   * The `free:<figmaHash>` identity present at create (or the owner's last
   * write), kept beside `licenseId`. For a Pro library it is a second proof of
   * ownership, because the license key lives in per-device storage that
   * "Remove license" or a fresh device can lose for good. Absent when no Figma
   * identity was ever present; publish backfills it.
   */
  figmaOwnerHash?: string;
  /** Cache of the newest log record (publish reads the log); absent before versioning, so no header. */
  version?: string;
}

/**
 * KV layout. Publish and rotate write disjoint records, so they can overlap:
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
/** Legacy layout, one JSON array per license; migrated on first sight. */
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
  /** Why a present bearer is not active, else null. */
  licenseReason: LicenseReason | null;
  /** `free:<figmaHash>` when a Figma proof was present, else null. */
  figmaIdentity: string | null;
}

/**
 * Who is calling and what they can prove. A bearer proves the license identity
 * even when inactive, since possession is the proof; only the tier needs it
 * active. Never 401s on tier alone: publish gates on `licenseReason`, rotate
 * does not.
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

/** Writes to a free-plan library must carry `X-Pull-Key`. */
const pullKeyOf = (req: Request): string | null => (req.headers.get('X-Pull-Key') ?? '').trim() || null;

/** True when `pullKey` hashes to this library's current (or legacy) key record. */
async function pullKeyMatches(store: LibraryStore, libraryId: string, meta: LibraryMeta, pullKey: string | null): Promise<boolean> {
  if (pullKey === null) return false;
  const keyHash = (await store.get(keyRecord(libraryId))) ?? meta.keyHash ?? null;
  return keyHash !== null && sha256(pullKey) === keyHash;
}

/**
 * The meta when the caller owns it, else the error Response. A license bearer
 * is a secret, so it proves ownership alone. A Figma identity is a
 * client-asserted header, so it proves ownership only with the pull key, which
 * only the creating publish or the last rotate handed out. That fallback keeps
 * a license-created library reachable once its key is lost (see figmaOwnerHash).
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
 * Ids owned by any proved identity. A legacy array is expanded into records
 * before it is deleted, so a concurrent create can over-count, never lose an id.
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
 * Writes in order: current bundle, per-version bundle, log, then the caller
 * writes the meta. KV is not atomic; a stop after the log is safe because
 * publish reads the log, and the next publish repairs the meta.
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

/** Epoch ms of the newest record, or NaN when empty or unparseable. */
const logHeadAt = (log: VersionLog): number => Date.parse(log.records[0]?.publishedAt ?? '');

/**
 * The head an update tells the reserve it read: the older of the meta's and
 * the log's times. KV caches each key separately per colo, so a fresh meta can
 * sit beside a stale log. A log ahead of its meta (a writer stopped between
 * them) recorded no head, so the meta's time passes. Empty log: the meta alone.
 */
function headBase(meta: LibraryMeta, log: VersionLog): number {
  const metaAt = Date.parse(meta.publishedAt);
  const logAt = logHeadAt(log);
  return Number.isNaN(logAt) ? metaAt : Math.min(metaAt, logAt);
}

/** `now`, or 1 ms past the meta's or log head's time when later; unparseable times are ignored. */
function nextHeadAt(now: number, meta: LibraryMeta, log: VersionLog): number {
  const after = [Date.parse(meta.publishedAt) + 1, logHeadAt(log) + 1].filter((at) => !Number.isNaN(at));
  return Math.max(now, ...after);
}

/**
 * The 403 for a library ceiling. Free callers get `existing`, the first listed
 * library, so the plugin can name the file; null, never a guess, when only the
 * counter knows a library the listing has not surfaced.
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

  // Charged before reading any body, so malformed or oversized bodies are
  // throttled too. The publish budget is charged once the body says which.
  if (!deps.requestLimiter.allow(`libreq:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });

  const read = await readBodyCapped(req, MAX_BUNDLE_BYTES);
  if (read.kind === 'too_large') {
    return json(413, { error: 'bundle_too_large', size: read.size, limit: MAX_BUNDLE_BYTES });
  }
  if (read.kind === 'unreadable') return json(400, { error: 'invalid body' });
  const bodyBytes = read.bytes.byteLength;
  let body: { libraryId?: unknown; bundle?: unknown; dryRun?: unknown; bump?: unknown; note?: unknown; initialVersion?: unknown };
  try { body = JSON.parse(new TextDecoder().decode(read.bytes)) as typeof body; } catch { return json(400, { error: 'invalid json' }); }

  // A dry run runs every time the Publish screen shows, so it spends the
  // request budget (two tokens with `libreq:`, fine at 60/min), not the 20/min
  // publish budget.
  const limiter = body.dryRun === true ? deps.requestLimiter : deps.licenseLimiter;
  const limiterKey = body.dryRun === true ? `libdry:${ip}` : `libpub:${ip}`;
  if (!limiter.allow(limiterKey, deps.now())) return json(429, { error: 'rate_limited' });

  const caller = await resolveCaller(req, deps);
  if (caller instanceof Response) return caller;
  // Publish needs a tier: a lapsed bearer with no Figma identity is refused.
  // So is `unreachable`: the license may be active, and publishing as free
  // would meter, cap, and own the library under the wrong identity.
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
  const fileName = typeof bundle.fileName === 'string' ? truncateUtf16(bundle.fileName, MAX_FILE_NAME_LENGTH) : null;
  const bundleHash = sha256(stored);
  // The byte hash is the pull ETag. The content hash answers "did this change
  // what developers pull": the bytes differ on every Publish (fresh generatedAt).
  const contentHash = libraryBundleContentHash(bundle);
  const store = deps.libraryStore;

  const quota = deps.quotaFor(caller.tierIdentity, 'publish');
  const respond = async (status: number, payload: Record<string, unknown>, extra: Record<string, string> = {}) =>
    json(status, payload, { ...quotaHeaders(await quota.snapshot(caller.tier)), ...extra });

  let libraryId: string | null = null;
  let meta: LibraryMeta | null = null;
  /** The KV listing's libraries for the caller; read only for a create. */
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
    // consistent, so the reservation also asks the Durable Object, which
    // counts creates atomically. A lapsed Pro license still owns every library
    // it created, so `owned` may exceed one on free.
    listed = await ownedLibraryIds(store, caller.owners);
    const limit = LIBRARY_LIMITS[caller.tier];
    if (listed.length >= limit) return libraryLimitResponse(store, caller.tier, limit, listed.length, listed);
  }

  // Same content already on this target: no write, no quota. Checked against
  // the target's stored hash, not the quota cache, so another library sharing
  // a content hash never matches. The stored version comes from the log.
  const log: VersionLog = libraryId ? await readVersionLog(store, libraryId) : { v: 1, records: [] };
  const storedVersion = currentVersion(log);
  const unchanged = Boolean(libraryId && meta && meta.contentHash === contentHash);

  // Recomputed on every publish and dry run; the client's dry run is never trusted.
  let diff: LibraryDiff | null = null;
  if (libraryId && meta && !unchanged) {
    const storedRaw = await store.get(bundleKey(libraryId));
    if (storedRaw !== null) {
      try {
        diff = libraryDiff(parseLibraryBundle(storedRaw), parsed);
      } catch {
        // An unparseable stored bundle has no baseline; the minimum is a patch.
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

  // Taken after the meta and log reads, never before: otherwise a publish
  // committed in between could leave this one writing an older time behind
  // it, moving the head backwards and letting a stale reader fork the
  // version. For the same reason an update lands at least 1 ms after both
  // times it read, whatever this Worker's clock says.
  const publishedAt = new Date(meta ? nextHeadAt(deps.now(), meta, log) : deps.now()).toISOString();

  // A create folds its fresh id into the key, so it never replays an earlier
  // create. An update is keyed by the stored state it replaces: keyed by
  // destination, A, B, A would replay A's commit within the 24 h TTL and
  // answer `unchanged` while KV held B (by content transition, so would
  // A, B, A, B). Every commit moves `publishedAt`, so only a retry racing the
  // write itself is replayed; a later retry hits the stored-hash check.
  const newId = libraryId ? null : newLibraryId();
  const cacheKey = libraryId
    ? `publish:${libraryId}:${meta?.publishedAt ?? 'none'}->${contentHash}`
    : `publish:new:${newId}`;
  // An update takes the library's lock, so a concurrent changed publish
  // answers 409 instead of assigning the same version; the lock never refuses
  // its own cache key, so a retry meets only its own reservation. The reserve
  // also carries the head this handler read (`headBase`): a newer committed
  // head makes this publish stale, so 409 rather than a forked version. A
  // create takes a slot in the identity's atomic library count.
  const lock = libraryId ? `publish:${libraryId}` : null;
  const reserved = await quota.reserve(caller.tier, cacheKey, lock !== null && meta
    ? { lock, base: headBase(meta, log) }
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
      // Below the limit, in-flight creates fill the ceiling and may yet fail,
      // so claim a publish in progress, not a library that may never exist.
      if (reserved.owned < reserved.limit) return respond(409, { error: 'publish_pending' });
      return libraryLimitResponse(store, caller.tier, reserved.limit, reserved.owned, listed);
    case 'proceed':
      break;
    default:
      return json(500, { error: 'internal' });
  }
  /** Set once the meta is in KV: the head to record, by commit or release. */
  let headWritten: { lock: string; at: number } | null = null;
  try {
    // Inside the try: a logger that throws must still release the reservation.
    if (reserved.kind === 'proceed' && reserved.flagged) {
      deps.log('fair_use_flag', { identityId: caller.tierIdentity, tier: caller.tier, surface: 'publish' });
    }
    if (libraryId && meta && lock !== null) {
      const record = versionRecord({
        version: resolution.version, publishedAt, bump: resolution.bump, minimumBump: resolution.minimumBump,
        note, contentHash, bundleHash, parsed, diff,
      });
      const next: LibraryMeta = {
        ...meta, publishedAt, bundleHash, contentHash, size: bodyBytes, fileName, version: record.version,
        // Backfill the Figma-identity fallback when the proven owner has one.
        ...(meta.figmaOwnerHash === undefined && caller.figmaIdentity ? { figmaOwnerHash: caller.figmaIdentity } : {}),
      };
      // The meta must never describe a bundle or version not yet written.
      const written = await writeVersion(store, libraryId, stored, log, record);
      await store.put(metaKey(libraryId), JSON.stringify(next));
      headWritten = { lock, at: Date.parse(publishedAt) };
      await Promise.all(bundlesToPrune(written).map((version) => store.delete(versionBundleKey(libraryId as string, version))));
      const snap = await quota.commit(caller.tier, cacheKey, JSON.stringify({ libraryId, publishedAt, version: record.version }), {
        head: headWritten,
      });
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
    // A create records its head too, so the first update is checked like the rest.
    headWritten = { lock: `publish:${id}`, at: Date.parse(publishedAt) };
    // The replay body never carries the pull key: it is handed out exactly once.
    const snap = await quota.commit(caller.tier, cacheKey, JSON.stringify({ libraryId: id, publishedAt, version: record.version }), {
      create: true, head: headWritten,
    });
    deps.log('library_publish', { libraryId: id, size: bodyBytes, created: true, version: record.version });
    return json(201, {
      libraryId: id, pullKey, publishedAt, version: record.version, bump: record.bump, minimumBump: record.minimumBump,
    }, { ...quotaHeaders(snap), 'X-Library-Version': record.version });
  } catch (err) {
    // A throw after the meta write leaves an unrecorded head in KV; freeing
    // the lock without it would let a stale reader fork the version, so the
    // release records it, uncounted. If the release fails too, the lock holds
    // for its three minutes, outlasting the roughly one-minute KV cache.
    await quota.release(cacheKey, headWritten ? { head: headWritten } : undefined);
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

/**
 * True when any comma-separated `If-None-Match` tag names `etag`. A weak tag
 * compares by value (the hash covers only the stored bytes); `*` matches; an
 * unquoted token never matches.
 */
export function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header.split(',').some((raw) => {
    const tag = raw.trim();
    if (tag === '*') return true;
    return (tag.startsWith('W/') ? tag.slice(2) : tag) === etag;
  });
}

/** Pull answers are per-key private data; nothing between the CLI and the Worker may keep a copy. */
const NO_STORE = 'private, no-store';

/** Applied to errors from keyed routes too. */
function noStore(res: Response): Response {
  res.headers.set('Cache-Control', NO_STORE);
  return res;
}

/** The meta when the bearer is this library's current pull key, else the error Response. */
async function pullAuthorized(req: Request, deps: HandlerDeps, libraryId: string): Promise<LibraryMeta | Response> {
  const auth = req.headers.get('Authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!PULL_KEY_RE.test(key)) return json(401, { error: 'invalid_key' });
  const metaRaw = await deps.libraryStore.get(metaKey(libraryId));
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  const keyHash = (await deps.libraryStore.get(keyRecord(libraryId))) ?? meta.keyHash ?? null;
  // Digest vs digest: timing over fixed-length hashes reveals nothing about the key.
  if (keyHash === null || sha256(key) !== keyHash) return json(401, { error: 'invalid_key' });
  return meta;
}

/** Every versions answer, the 401, 404 and 429 included, says `no-store`. */
export async function handleVersions(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  return noStore(await versionsAnswer(req, deps, libraryId));
}

async function versionsAnswer(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`libpull:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const meta = await pullAuthorized(req, deps, libraryId);
  if (meta instanceof Response) return meta;
  const raw = (await deps.libraryStore.get(versionsKey(libraryId))) ?? JSON.stringify({ v: 1, records: [] });
  const etag = `"${sha256(raw)}"`;
  const headers: Record<string, string> = { ETag: etag, 'content-type': 'application/json' };
  if (ifNoneMatchMatches(req.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
  return new Response(raw, { status: 200, headers });
}

/** Every pull answer, the 401, 404 and 429 included, says `no-store`. */
export async function handlePull(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  return noStore(await pullAnswer(req, deps, libraryId));
}

async function pullAnswer(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`libpull:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const meta = await pullAuthorized(req, deps, libraryId);
  if (meta instanceof Response) return meta;
  const etag = `"${meta.bundleHash}"`;
  const headers: Record<string, string> = {
    ETag: etag,
    'X-Published-At': meta.publishedAt,
    'content-type': 'application/json',
  };
  if (meta.version) headers['X-Library-Version'] = meta.version;
  if (ifNoneMatchMatches(req.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const bundle = await deps.libraryStore.getStream(bundleKey(libraryId));
  if (bundle === null) return json(404, { error: 'not_found' });
  return new Response(bundle, { status: 200, headers });
}
