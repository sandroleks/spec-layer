/**
 * versions.ts: the version log a published library carries, and the pure
 * rules that turn a diff and a client request into the next version.
 *
 * KV layout, beside the keys libraries.ts owns:
 *   lib:<id>:versions           VersionLog JSON, newest record first
 *   lib:<id>:bundle:<version>   the bundle bytes for that version, last ten kept
 *
 * The log, not the meta, is the source of truth for the current version. KV
 * writes are not atomic, and publish writes bundles, then the log, then the
 * meta; a failure between the last two leaves a log record the meta does not
 * know about, so the next publish reads the log and the meta is a cache.
 */
import {
  compareBump, isSemver, nextVersion,
  type Bump, type LibraryChange, type LibraryDiff, type VersionLog, type VersionRecord,
} from '@spec-layer/extractor';
import type { KVLike } from './license';

// The record and log shapes are the extractor's (libraryDiff.ts), so the
// plugin's history pane and the CLI read the same declaration this writes.
export type { VersionLog, VersionRecord };

export const MAX_CHANGES_BYTES = 65_536;
export const RETAINED_BUNDLES = 10;
export const MAX_NOTE_LENGTH = 500;
/** How many of the newest log records keep their full change list. Older
 *  records are compacted (see `compactLog`) so the log itself cannot grow
 *  without bound across a library's lifetime. */
export const DETAILED_RECORDS = 50;

export const versionsKey = (libraryId: string): string => `lib:${libraryId}:versions`;
export const versionBundleKey = (libraryId: string, version: string): string => `lib:${libraryId}:bundle:${version}`;

const BUMPS: ReadonlySet<string> = new Set(['major', 'minor', 'patch']);
const isBump = (value: unknown): value is Bump => typeof value === 'string' && BUMPS.has(value);

/**
 * Cut the sorted change list after the last change that fits in `maxBytes`
 * of UTF-8 bytes. Bytes are measured with TextEncoder, including the JSON
 * structure (brackets, commas, quotes).
 */
export function truncateChanges(
  changes: LibraryChange[],
  maxBytes: number = MAX_CHANGES_BYTES,
): { changes: LibraryChange[]; changesTruncated: boolean } {
  const full = JSON.stringify(changes);
  if (new TextEncoder().encode(full).byteLength <= maxBytes) return { changes, changesTruncated: false };
  let size = 2; // the brackets
  const kept: LibraryChange[] = [];
  for (const change of changes) {
    const next = new TextEncoder().encode(JSON.stringify(change)).byteLength + (kept.length > 0 ? 1 : 0);
    if (size + next > maxBytes) break;
    size += next;
    kept.push(change);
  }
  return { changes: kept, changesTruncated: true };
}

export async function readVersionLog(store: KVLike, libraryId: string): Promise<VersionLog> {
  const raw = await store.get(versionsKey(libraryId));
  if (raw === null) return { v: 1, records: [] };
  const parsed = JSON.parse(raw) as VersionLog;
  return Array.isArray(parsed.records) ? parsed : { v: 1, records: [] };
}

export const currentVersion = (log: VersionLog): string | null => log.records[0]?.version ?? null;

export type BumpResolution =
  | { ok: true; version: string; bump: Bump | 'initial'; minimumBump: Bump | null }
  | {
    ok: false;
    status: 400;
    body:
      | { error: 'bump_below_minimum'; minimumBump: Bump; proposedVersion: string }
      | { error: 'invalid_bump' }
      | { error: 'invalid_initial_version' };
  };

/**
 * The version a changed publish gets. Content that changed with no property
 * changes (a description edit, say) is at least a patch. A client may raise
 * the bump and never lower it. Nothing here trusts a client's dry-run result.
 */
export function resolveBump(input: {
  storedVersion: string | null;
  minimumBump: Bump | null;
  bump: unknown;
  initialVersion: unknown;
}): BumpResolution {
  if (input.storedVersion === null) {
    if (input.initialVersion !== undefined && input.initialVersion !== null && !isSemver(input.initialVersion)) {
      return { ok: false, status: 400, body: { error: 'invalid_initial_version' } };
    }
    const version = isSemver(input.initialVersion) ? input.initialVersion : '1.0.0';
    return { ok: true, version, bump: 'initial', minimumBump: null };
  }
  const minimum: Bump = input.minimumBump ?? 'patch';
  if (input.bump !== undefined && input.bump !== null && !isBump(input.bump)) {
    return { ok: false, status: 400, body: { error: 'invalid_bump' } };
  }
  const requested: Bump = isBump(input.bump) ? input.bump : minimum;
  if (compareBump(requested, minimum) < 0) {
    return {
      ok: false, status: 400,
      body: { error: 'bump_below_minimum', minimumBump: minimum, proposedVersion: nextVersion(input.storedVersion, minimum) },
    };
  }
  return { ok: true, version: nextVersion(input.storedVersion, requested), bump: requested, minimumBump: minimum };
}

/** Trimmed note, null when absent or empty, undefined when the value is not acceptable. */
export function readNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) return undefined;
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The dry-run body for a changed bundle. `diff` is null when there is no
 * stored bundle to compare against, or when the stored one could not be
 * parsed. `initialVersion` mirrors what a real first publish would assign
 * when it is a valid semver; this function never rejects it (it returns a
 * proposal, not a response) — the caller validates before calling in.
 */
export function proposalFor(storedVersion: string | null, diff: LibraryDiff | null, initialVersion: unknown = undefined): {
  currentVersion: string | null;
  minimumBump: Bump | null;
  proposedVersion: string;
  counts: LibraryDiff['counts'];
  changes: LibraryChange[];
  changesTruncated: boolean;
} {
  if (storedVersion === null) {
    return {
      currentVersion: null, minimumBump: null,
      proposedVersion: isSemver(initialVersion) ? initialVersion : '1.0.0',
      counts: diff?.counts ?? { major: 0, minor: 0, patch: 0 },
      ...truncateChanges(diff?.changes ?? []),
    };
  }
  if (diff === null) {
    return {
      currentVersion: storedVersion,
      minimumBump: 'patch',
      proposedVersion: nextVersion(storedVersion, 'patch'),
      counts: { major: 0, minor: 0, patch: 0 },
      changes: [],
      changesTruncated: false,
    };
  }
  const minimum: Bump = diff.minimumBump ?? 'patch';
  return {
    currentVersion: storedVersion,
    minimumBump: minimum,
    proposedVersion: nextVersion(storedVersion, minimum),
    counts: diff.counts,
    ...truncateChanges(diff.changes),
  };
}

/**
 * The one version whose per-version bundle should be deleted after this
 * publish: the record that just fell past the newest RETAINED_BUNDLES. Each
 * publish pushes exactly one record onto the log, so at most one bundle ever
 * falls out of the window; deleting every record past the window (as this
 * once did) means one subrequest per publish forever, which crosses the
 * Worker's subrequest limit by roughly the thousandth publish.
 */
export function bundlesToPrune(log: VersionLog): string[] {
  return log.records.slice(RETAINED_BUNDLES, RETAINED_BUNDLES + 1).map((record) => record.version);
}

/**
 * Caps the log's stored detail: the newest `DETAILED_RECORDS` keep their
 * change list untouched; every older record with a non-empty `changes` has it
 * replaced with `[]` and gains `changesTruncated: true`. `counts`, `note`,
 * `version` and the dates are never touched, so the summary a library's
 * history keeps forever stays intact even once the change list is gone. Pure
 * and idempotent: compacting an already-compacted log changes nothing.
 */
export function compactLog(log: VersionLog): VersionLog {
  return {
    v: log.v,
    records: log.records.map((record, i) => {
      if (i < DETAILED_RECORDS || record.changes.length === 0) return record;
      return { ...record, changes: [], changesTruncated: true };
    }),
  };
}
