import { resolveStatus } from '../../docLink';
import type { FoundationIconKind } from '../../foundationIcon';
import type { LibraryEntry } from '../../messages';

/**
 * Drift is resolved independently from library enumeration. `unavailable`
 * means the check failed: it is deliberately distinct from `inSync`.
 */
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

export interface LibraryRowModel {
  docId: string;
  kind: LibraryEntry['kind'];
  /**
   * Which foundation source glyph this row gets, matching the Foundations
   * picker row for the same source. `null` on component rows, and `mixed` on a
   * foundation row from a main thread that could not read its scope.
   */
  foundationIcon: FoundationIconKind | null;
  label: string;
  sourceLabel: string;
  sourceNodeId: string;
  ageLabel: string;
  status: LibraryRowStatus;
  expanded: boolean;
  canOpenFrame: boolean;
  canOpenSource: boolean;
  canReconnect: boolean;
  canUpdate: boolean;
  canDetach: boolean;
  canRemove: boolean;
  /**
   * The current protocol establishes hash drift, not a reliable itemized diff.
   * `null` tells the screen to render its honest "Source changed" fallback.
   */
  changeGroups: null;
}

export interface LibraryCounts {
  all: number;
  updates: number;
  inSync: number;
}

export interface LibraryModel {
  filter: LibraryFilter;
  counts: LibraryCounts;
  /** All rows, in registry order, before the selected filter is applied. */
  allRows: LibraryRowModel[];
  /** Rows visible for the selected filter and optional search query. */
  rows: LibraryRowModel[];
}

export interface BuildLibraryModelOptions {
  drift?: ReadonlyMap<string, LibraryDriftState>;
  filter?: LibraryFilter;
  expandedDocId?: string | null;
  query?: string;
  /** Injectable wall clock, primarily so relative age labels are deterministic. */
  now?: number;
}

/**
 * Compact relative time used by the fixed-width age column.
 *
 * A missing or invalid timestamp stays visibly unknown instead of pretending
 * the document was generated recently. Future timestamps are treated as
 * "just now" to tolerate small clock differences.
 */
export function formatLibraryAge(
  generatedAt: number | undefined,
  now = Date.now(),
): string {
  if (!Number.isFinite(generatedAt) || !Number.isFinite(now)) return '—';

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
 * Status resolution preserves the domain priority:
 * orphaned > update available > edited > in sync.
 *
 * Pending checks stay pending so the UI never flashes a lower-priority claim.
 * A failed check is neutral unless the independently reliable self-edit fact is
 * already known.
 */
export function resolveLibraryRowStatus(
  entry: LibraryEntry,
  drift: LibraryDriftState,
): LibraryRowStatus {
  if (!entry.sourceExists) return 'orphaned';
  if (drift === 'pending') return 'pending';
  if (drift === 'unavailable') return entry.selfEdited ? 'edited' : 'unavailable';
  // A pre-0.2 doc's hash was produced by a different projection, so its drift
  // is meaningless as content drift: read it as "rebuild needed" rather than
  // routing it through the drifted/inSync hash comparison below.
  if (drift === 'staleVersion') return 'rebuildNeeded';

  return resolveStatus({
    sourceExists: true,
    sourceDrifted: drift === 'drifted',
    selfEdited: entry.selfEdited,
  });
}

/**
 * Foundation enumeration already carries its live content hash. Component
 * drift arrives asynchronously. Missing foundation extraction is unavailable,
 * not in sync.
 */
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

export function buildLibraryRow(
  entry: LibraryEntry,
  options: BuildLibraryModelOptions = {},
): LibraryRowModel {
  const drift = libraryDriftForEntry(entry, options.drift ?? new Map());
  const status = resolveLibraryRowStatus(entry, drift);
  const componentSourceAvailable = entry.kind === 'component'
    && entry.sourceExists
    && entry.sourceNodeId.length > 0;

  return {
    docId: entry.docId,
    kind: entry.kind,
    // An entry from an older main thread carries no icon; `mixed` is the same
    // "claims nothing" fallback the derivation itself uses.
    foundationIcon: entry.kind === 'foundation'
      ? entry.foundationIcon ?? 'mixed'
      : null,
    label: entry.label,
    sourceLabel: entry.sourceLabel,
    sourceNodeId: entry.sourceNodeId,
    ageLabel: formatLibraryAge(entry.generatedAt, options.now),
    status,
    expanded: options.expandedDocId === entry.docId
      && status === 'updateAvailable',
    canOpenFrame: true,
    canOpenSource: componentSourceAvailable,
    // There is no reconnect command in the current main-thread protocol.
    canReconnect: false,
    canUpdate: entry.sourceExists
      && status !== 'pending'
      && status !== 'unavailable'
      && status !== 'orphaned',
    canDetach: true,
    canRemove: true,
    changeGroups: null,
  };
}

export function buildLibraryModel(
  entries: readonly LibraryEntry[],
  options: BuildLibraryModelOptions = {},
): LibraryModel {
  const filter = options.filter ?? 'all';
  const allRows = entries.map((entry) => buildLibraryRow(entry, options));
  // 'rebuildNeeded' counts alongside 'updateAvailable': both mean "this row
  // needs action from the badge/filter's point of view", they just differ in
  // WHY (content drift vs. a stale extractor format). Keeping them as
  // distinct LibraryRowStatus values means a row's own copy still says
  // "Rebuild needed", never "Update available". Only this aggregate view
  // treats them the same, per the controller's call that the badge/filter
  // exclusion was an oversight, not an intended distinction.
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
 * Whether the Library rail badge should show, given a pass that may still be
 * running.
 *
 * The badge used to read `counts.updates` directly, which is not a fact until a
 * check pass finishes: `startLibraryDriftChecks` clears every result and marks
 * each component row `pending`, so a reload dropped the count to zero before it
 * climbed back one landed check at a time. The user saw the badge disappear and
 * then a number stepping 1, 2, 3.
 *
 * A found update is true immediately, so it shows at once. A zero only means
 * "nothing to report" once nothing is still being checked; until then the
 * previous answer stands.
 */
export function libraryBadgeVisible(input: {
  /** Updates known so far this pass. */
  updates: number;
  /** A refresh is in flight, or some row's source check has not landed. */
  checking: boolean;
  /** The last answer shown, kept while `checking`. */
  previous: boolean;
}): boolean {
  if (input.updates > 0) return true;
  return input.checking ? input.previous : false;
}
