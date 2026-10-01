/**
 * The command palette searches connected Library documents only. The host
 * opens the Library and reveals the picked row.
 */
export interface SearchDocument {
  docId: string;
  /** Mirrors `LibraryEntry.kind`. */
  kind: 'component' | 'foundation';
  label: string;
  sourceLabel: string;
  /** Last generation time from the doc link; an invalid value sorts last, never as new. */
  generatedAt: number;
}

export interface SearchDocumentResult extends SearchDocument {
  index: number;
}

export type SearchResult = SearchDocumentResult;

export interface SearchModel {
  query: string;
  /**
   * No query typed, so `results` is the recent component list, not a match
   * set: "nothing documented yet" rather than "no matches".
   */
  recent: boolean;
  results: SearchDocumentResult[];
  /** Zero with no results, otherwise clamped to a valid result. */
  activeIndex: number;
}

const RECENT_LIMIT = 6;
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
 * No query lists component docs newest first. A query searches every
 * connected document in registry order: recency is not a relevance signal.
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

/** Arrows wrap; Home and End jump to the ends. */
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
