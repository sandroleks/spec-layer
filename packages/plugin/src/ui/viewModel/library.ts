import {
  componentChangeGroups, foundationChangeGroups,
  type ChangeGroup, type FoundationUnitContent, type SpecHashProjection,
} from '@spec-layer/extractor';
import { resolveStatus, type DocBaseline } from '../../docLink';
import type { FoundationIconKind } from '../../foundationIcon';
import type { DocSourceIntent, LibraryEntry } from '../../messages';

/** Resolved apart from enumeration. `unavailable` means the check failed, never `inSync`. */
export type LibraryDriftState =
  | 'pending'
  | 'inSync'
  | 'drifted'
  | 'staleVersion'
  | 'unavailable';

export type LibraryRowStatus =
  | 'pending'
  | 'inSync'
  | 'updateAvailable'
  | 'rebuildNeeded'
  | 'edited'
  | 'orphaned'
  | 'unavailable';

export type LibraryFilter = 'all' | 'updates' | 'sync';

export function isLibraryFilter(value: string): value is LibraryFilter {
  return value === 'all' || value === 'updates' || value === 'sync';
}

/**
 * Decide at run start and store on the queue entry: `libraryDrift` is cleared
 * when a refresh lands, so reading it at dispatch turns a rebuild into an update.
 */
export function libraryUpdateIntent(drift: LibraryDriftState | undefined): DocSourceIntent {
  return drift === 'staleVersion' ? 'rebuild' : 'update';
}

/** `idle` for every unexpanded row; expanding is `pending` until main's baseline reply resolves. */
export type LibraryChangeState = 'idle' | 'pending' | 'ready' | 'unavailable';

export type LibraryChangeUnavailableReason =
  /** Main sent no baseline (none, over budget, or mismatched); an Update writes one. */
  | 'noBaseline'
  /** Anything else: no live side, or the diff itself failed. */
  | 'other';

export type LibraryChangeResult =
  | { state: 'pending' }
  | { state: 'ready'; groups: ChangeGroup[] }
  | { state: 'unavailable'; reason: LibraryChangeUnavailableReason };

export interface LibraryRowModel {
  docId: string;
  kind: LibraryEntry['kind'];
  /** Matches the Foundations picker glyph; `null` on component rows, `mixed` when scope is unreadable. */
  foundationIcon: FoundationIconKind | null;
  label: string;
  sourceLabel: string;
  sourceNodeId: string;
  ageLabel: string;
  status: LibraryRowStatus;
  expanded: boolean;
  canOpenFrame: boolean;
  canOpenSource: boolean;
  canUpdate: boolean;
  canDetach: boolean;
  canRemove: boolean;
  /**
   * Copy never mutates, so drifted and edited rows stay copyable. Never on
   * `unavailable`: Copy re-reads the source whose live read just failed.
   */
  canCopy: boolean;
  changeState: LibraryChangeState;
  /** Set only in the `ready` state. */
  changeGroups: ChangeGroup[] | null;
  /** Set only in the `unavailable` state. */
  changeUnavailableReason: LibraryChangeUnavailableReason | null;
}

export interface LibraryCounts {
  all: number;
  updates: number;
  inSync: number;
}

export interface LibraryModel {
  filter: LibraryFilter;
  counts: LibraryCounts;
  /** Registry order, before the filter. */
  allRows: LibraryRowModel[];
  rows: LibraryRowModel[];
}

export interface BuildLibraryModelOptions {
  drift?: ReadonlyMap<string, LibraryDriftState>;
  filter?: LibraryFilter;
  expandedDocId?: string | null;
  query?: string;
  now?: number;
  /** This refresh pass's results; an expanded row missing here reads `pending`. */
  changes?: ReadonlyMap<string, LibraryChangeResult>;
}

/** An invalid timestamp reads 'Unknown', never recent; a future one "just now" (clock skew). */
export function formatLibraryAge(
  generatedAt: number | undefined,
  now = Date.now(),
): string {
  if (!Number.isFinite(generatedAt) || !Number.isFinite(now)) return 'Unknown';

  const elapsed = Math.max(0, now - (generatedAt as number));
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return 'just now';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  return `${Math.floor(elapsed / day)}d ago`;
}

/**
 * The caption that makes a skipped check honest. Relative under an hour, then
 * clock time ("before or after my edit?"). Null with no stamp, never made up.
 */
export function formatLibraryCheckedAt(
  checkedAt: number | null,
  now = Date.now(),
  locale?: string,
): string | null {
  if (checkedAt === null || !Number.isFinite(checkedAt) || !Number.isFinite(now)) return null;
  const elapsed = Math.max(0, now - checkedAt);
  const minute = 60_000;
  if (elapsed < minute) return 'Checked just now';
  if (elapsed < 60 * minute) return `Checked ${Math.floor(elapsed / minute)} min ago`;
  const time = new Date(checkedAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `Checked at ${time}`;
}

/**
 * Ms until formatLibraryCheckedAt reads differently, or null when it never
 * will (no stamp, or a clock time). Minutes count from the check, not from
 * when the list opened, so a timer sleeping this long flips the label on time.
 */
export function libraryCheckedLabelChangesIn(
  checkedAt: number | null,
  now = Date.now(),
): number | null {
  if (checkedAt === null || !Number.isFinite(checkedAt) || !Number.isFinite(now)) return null;
  const minute = 60_000;
  const minutesShown = Math.floor(Math.max(0, now - checkedAt) / minute);
  if (minutesShown >= 60) return null;
  return checkedAt + (minutesShown + 1) * minute - now;
}

/**
 * Priority: orphaned > update available > edited > in sync. Pending stays
 * pending so the UI never flashes a lower claim; a failed check is neutral.
 */
export function resolveLibraryRowStatus(
  entry: LibraryEntry,
  drift: LibraryDriftState,
): LibraryRowStatus {
  if (!entry.sourceExists) return 'orphaned';
  if (drift === 'pending') return 'pending';
  if (drift === 'unavailable') return entry.selfEdited ? 'edited' : 'unavailable';
  // Another extractor's hash projection says nothing about content drift.
  if (drift === 'staleVersion') return 'rebuildNeeded';

  return resolveStatus({
    sourceExists: true,
    sourceDrifted: drift === 'drifted',
    selfEdited: entry.selfEdited,
  });
}

/** Component drift arrives later; a foundation with no live hash is unavailable, not in sync. */
export function libraryDriftForEntry(
  entry: LibraryEntry,
  drift: ReadonlyMap<string, LibraryDriftState>,
): LibraryDriftState {
  const explicit = drift.get(entry.docId);
  if (explicit) return explicit;

  if (entry.kind === 'foundation') {
    if (entry.currentContentHash === undefined) return 'unavailable';
    return entry.currentContentHash === entry.storedContentHash
      ? 'inSync'
      : 'drifted';
  }

  return 'pending';
}

/**
 * A row's state when a scan lands: `'check'`, its known state, or null when
 * the source is gone. A doc from another extractor version (or none) is
 * `staleVersion` at once; waiting for its check would raise the rebuild banner mid-pass.
 */
export function initialLibraryDrift(
  entry: LibraryEntry,
  extractorVersion: string,
): LibraryDriftState | 'check' | null {
  if (!entry.sourceExists) return null;
  if (entry.kind === 'foundation') return libraryDriftForEntry(entry, new Map());
  return entry.extractorVersion === extractorVersion ? 'check' : 'staleVersion';
}

export function buildLibraryRow(
  entry: LibraryEntry,
  options: BuildLibraryModelOptions = {},
): LibraryRowModel {
  const drift = libraryDriftForEntry(entry, options.drift ?? new Map());
  const status = resolveLibraryRowStatus(entry, drift);
  const componentSourceAvailable = entry.kind === 'component'
    && entry.sourceExists
    && entry.sourceNodeId.length > 0;
  const expanded = options.expandedDocId === entry.docId && status === 'updateAvailable';
  const change: LibraryChangeResult | null = expanded
    ? options.changes?.get(entry.docId) ?? { state: 'pending' }
    : null;

  return {
    docId: entry.docId,
    kind: entry.kind,
    // An older main thread sends no icon; `mixed` claims nothing.
    foundationIcon: entry.kind === 'foundation'
      ? entry.foundationIcon ?? 'mixed'
      : null,
    label: entry.label,
    sourceLabel: entry.sourceLabel,
    sourceNodeId: entry.sourceNodeId,
    ageLabel: formatLibraryAge(entry.generatedAt, options.now),
    status,
    expanded,
    canOpenFrame: true,
    canOpenSource: componentSourceAvailable,
    canUpdate: entry.sourceExists
      && status !== 'pending'
      && status !== 'unavailable'
      && status !== 'orphaned',
    canDetach: true,
    canRemove: true,
    canCopy: entry.kind === 'foundation'
      // No scope from an older main thread has no honest fallback: copying
      // the wrong collection is worse than not offering Copy.
      ? entry.foundationScope !== undefined
        && status !== 'unavailable'
        && status !== 'orphaned'
      : componentSourceAvailable && status !== 'unavailable',
    changeState: change ? change.state : 'idle',
    changeGroups: change?.state === 'ready' ? change.groups : null,
    changeUnavailableReason: change?.state === 'unavailable' ? change.reason : null,
  };
}

export function buildLibraryModel(
  entries: readonly LibraryEntry[],
  options: BuildLibraryModelOptions = {},
): LibraryModel {
  const filter = options.filter ?? 'all';
  const allRows = entries.map((entry) => buildLibraryRow(entry, options));
  // Both need action for the badge and filter; the row's own copy keeps them distinct.
  const needsAction = (row: LibraryRowModel) =>
    row.status === 'updateAvailable' || row.status === 'rebuildNeeded';
  const counts: LibraryCounts = {
    all: allRows.length,
    updates: allRows.filter(needsAction).length,
    inSync: allRows.filter((row) => row.status === 'inSync').length,
  };

  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const rows = allRows.filter((row) => {
    if (filter === 'updates' && !needsAction(row)) return false;
    if (filter === 'sync' && row.status !== 'inSync') return false;
    if (!query) return true;
    return `${row.label}\n${row.sourceLabel}`.toLocaleLowerCase().includes(query);
  });

  return { filter, counts, allRows, rows };
}

/**
 * A found update shows at once; a zero counts only once nothing is checking,
 * since `startLibraryDriftChecks` resets rows to `pending` and the badge would dip.
 */
export function libraryBadgeVisible(input: {
  updates: number;
  /** A refresh is in flight, or some row's source check has not landed. */
  checking: boolean;
  previous: boolean;
}): boolean {
  if (input.updates > 0) return true;
  return input.checking ? input.previous : false;
}

/** A `docBaseline` reply as the row's change result; any failure is `unavailable`, never a partial list. */
export function resolveLibraryChanges(input: {
  baseline: DocBaseline | null;
  live?: FoundationUnitContent | null | undefined;
  liveProjection?: SpecHashProjection | undefined;
}): LibraryChangeResult {
  if (!input.baseline) return { state: 'unavailable', reason: 'noBaseline' };
  try {
    if (input.baseline.kind === 'foundation') {
      if (!input.live) return { state: 'unavailable', reason: 'other' };
      return { state: 'ready', groups: foundationChangeGroups(input.baseline.projection, input.live) };
    }
    if (!input.liveProjection) return { state: 'unavailable', reason: 'other' };
    return { state: 'ready', groups: componentChangeGroups(input.baseline.projection, input.liveProjection) };
  } catch {
    return { state: 'unavailable', reason: 'other' };
  }
}
