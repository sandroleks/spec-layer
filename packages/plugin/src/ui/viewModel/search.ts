/**
 * The command palette searches connected Library documents and nothing else.
 * With no query typed it lists the most recently generated component docs, so
 * the palette opens on something useful rather than on a list of rail
 * destinations the sidebar already shows. The host remains responsible for
 * opening the Library and revealing the row the user picked.
 */
export interface SearchDocument {
  docId: string;
  /** Which document type this row is, mirroring `LibraryEntry.kind`. */
  kind: 'component' | 'foundation';
  label: string;
  sourceLabel: string;
  /**
   * Last successful generation time, copied from the doc link. Orders the
   * default recent list. A missing or invalid value sorts last rather than
   * reading as brand new.
   */
  generatedAt: number;
}

export interface SearchDocumentResult extends SearchDocument {
  index: number;
}

export type SearchResult = SearchDocumentResult;

export interface SearchModel {
  query: string;
  /**
   * True while no query is typed, which is when `results` is the recent
   * component list rather than a match set. The presentation layer titles the
   * group from this, and it is the difference between "nothing documented yet"
   * and "no matches".
   */
  recent: boolean;
  results: SearchDocumentResult[];
  /** Always zero when there are no results, otherwise clamped to a valid result. */
  activeIndex: number;
}

/** Recent components shown before typing. */
const RECENT_LIMIT = 6;
/** Matches shown for a typed query, which can reach both document kinds. */
const QUERY_LIMIT = 8;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matches(query: string, ...values: string[]): boolean {
  return values.join('\n').toLocaleLowerCase().includes(query);
}

function recency(document: SearchDocument): number {
  return Number.isFinite(document.generatedAt) ? document.generatedAt : 0;
}

/**
 * Builds the complete presentation state.
 *
 * No query lists component docs newest first: the palette's job before typing
 * is "take me back to what I was documenting". A query searches every
 * connected document, components and foundations alike, in registry order —
 * recency is not a relevance signal once the user has said what they want.
 */
export function buildSearchModel(
  documents: readonly SearchDocument[],
  query = '',
  requestedActiveIndex = 0,
): SearchModel {
  const normalizedQuery = normalized(query);
  const recent = !normalizedQuery;
  const matching = recent
    ? [...documents]
      .filter((document) => document.kind === 'component')
      .sort((left, right) => recency(right) - recency(left))
      .slice(0, RECENT_LIMIT)
    : documents
      .filter((document) =>
        matches(normalizedQuery, document.label, document.sourceLabel))
      .slice(0, QUERY_LIMIT);

  const results: SearchDocumentResult[] = matching.map((document, index) => ({
    ...document,
    index,
  }));
  const activeIndex = results.length
    ? Math.min(Math.max(0, requestedActiveIndex), results.length - 1)
    : 0;

  return { query, recent, results, activeIndex };
}

export type SearchNavigationKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'Home'
  | 'End';

/**
 * Pure keyboard pointer movement for the host controller. Arrow navigation
 * wraps, while Home and End jump to the list boundaries.
 */
export function nextSearchIndex(
  current: number,
  key: SearchNavigationKey,
  resultCount: number,
): number {
  if (resultCount <= 0) return 0;
  const safeCurrent = Math.min(Math.max(0, current), resultCount - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return resultCount - 1;
  if (key === 'ArrowDown') return (safeCurrent + 1) % resultCount;
  return (safeCurrent - 1 + resultCount) % resultCount;
}
