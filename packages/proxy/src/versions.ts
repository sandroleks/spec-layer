/**
 * A published library's version log, and the pure rules that turn a diff and
 * a client request into the next version.
 *
 * KV layout, beside the keys libraries.ts owns:
 *   lib:<id>:versions           VersionLog JSON, newest record first
 *   lib:<id>:bundle:<version>   the bundle bytes for that version, last ten kept
 *
 * The log, not the meta, is the source of truth for the current version: KV
 * writes are not atomic, and publish writes bundles, then the log, then the
 * meta, so a failure before the meta write leaves a record only the log knows.
 */
import {
  compareBump, isSemver, nextVersion,
  type Bump, type LibraryChange, type LibraryDiff, type VersionLog, type VersionRecord,
} from '@spec-layer/extractor';
import type { KVLike } from './license';

// The extractor's shapes, so the plugin and the CLI read what this writes.
export type { VersionLog, VersionRecord };

export const MAX_CHANGES_BYTES = 65_536;
export const RETAINED_BUNDLES = 10;
export const MAX_NOTE_LENGTH = 500;
/** Newest records that keep their change list; older ones are compacted (`compactLog`). */
export const DETAILED_RECORDS = 50;

export const versionsKey = (libraryId: string): string => `lib:${libraryId}:versions`;
export const versionBundleKey = (libraryId: string, version: string): string => `lib:${libraryId}:bundle:${version}`;

const BUMPS: ReadonlySet<string> = new Set(['major', 'minor', 'patch']);
const isBump = (value: unknown): value is Bump => typeof value === 'string' && BUMPS.has(value);

/** Cut the sorted list after the last change whose JSON fits in `maxBytes` UTF-8 bytes. */
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
 * The version a changed publish gets: at least a patch, raised but never
 * lowered by the client, and never trusting a client's dry-run result.
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
 * The dry-run body for a changed bundle. `diff` is null with no stored bundle
 * or an unparseable one. An invalid `initialVersion` is never rejected here;
 * the caller validates it first.
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
 * The one bundle to delete after this publish: the record that just fell past
 * RETAINED_BUNDLES. Deleting every record past the window would grow by one
 * subrequest per publish until it crosses the Worker's subrequest limit.
 */
export function bundlesToPrune(log: VersionLog): string[] {
  return log.records.slice(RETAINED_BUNDLES, RETAINED_BUNDLES + 1).map((record) => record.version);
}

/**
 * Older records past `DETAILED_RECORDS` lose their change list (`[]` plus
 * `changesTruncated: true`), so the log cannot grow without bound. `counts`,
 * `note`, `version` and dates are kept. Idempotent.
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
