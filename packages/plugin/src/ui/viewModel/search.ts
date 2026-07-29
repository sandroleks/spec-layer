import type { IconName } from '../shell/icons';
import type { PluginView } from './contracts';

/**
 * The command palette searches the five stable workflow destinations and the
 * current Library rows. The host remains responsible for opening a workflow
 * or focusing a connected documentation frame.
 */
export interface SearchDocument {
  docId: string;
  label: string;
  sourceLabel: string;
}

export interface SearchWorkflowDefinition {
  view: PluginView;
  label: string;
  detail: string;
  icon: IconName;
}

export interface SearchWorkflowResult extends SearchWorkflowDefinition {
  kind: 'workflow';
  index: number;
}

export interface SearchDocumentResult extends SearchDocument {
  kind: 'document';
  index: number;
}

export type SearchResult = SearchWorkflowResult | SearchDocumentResult;

export interface SearchModel {
  query: string;
  workflowResults: SearchWorkflowResult[];
  documentResults: SearchDocumentResult[];
  /** Workflow results followed by Library results, matching their visual order. */
  results: SearchResult[];
  /** Always zero when there are no results, otherwise clamped to a valid result. */
  activeIndex: number;
}

export const SEARCH_WORKFLOWS: readonly SearchWorkflowDefinition[] = [
  {
    view: 'component',
    label: 'Component docs',
    detail: 'Document the current Figma selection',
    icon: 'fileDescription',
  },
  {
    view: 'library',
    label: 'Library',
    detail: 'Maintain connected documentation',
    icon: 'folder',
  },
  {
    view: 'foundations',
    label: 'Foundation docs',
    detail: 'Generate system documentation',
    icon: 'layoutGrid',
  },
  {
    view: 'settings',
    label: 'Settings',
    detail: 'Generated frame appearance',
    icon: 'settings',
  },
  {
    view: 'license',
    label: 'License',
    detail: 'Plan and license',
    icon: 'key',
  },
] as const;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matches(query: string, ...values: string[]): boolean {
  return !query || values.join('\n').toLocaleLowerCase().includes(query);
}

/**
 * Builds the complete presentation state. Four Library results are useful
 * before typing; a focused query can show up to eight without overwhelming the
 * native 480 × 680 plugin frame.
 */
export function buildSearchModel(
  documents: readonly SearchDocument[],
  query = '',
  requestedActiveIndex = 0,
): SearchModel {
  const normalizedQuery = normalized(query);
  const matchingWorkflows = SEARCH_WORKFLOWS.filter((workflow) =>
    matches(normalizedQuery, workflow.label, workflow.detail));
  const matchingDocuments = documents
    .filter((document) =>
      matches(normalizedQuery, document.label, document.sourceLabel))
    .slice(0, normalizedQuery ? 8 : 4);

  const workflowResults: SearchWorkflowResult[] = matchingWorkflows.map(
    (workflow, index) => ({ ...workflow, kind: 'workflow', index }),
  );
  const documentResults: SearchDocumentResult[] = matchingDocuments.map(
    (document, offset) => ({
      ...document,
      kind: 'document',
      index: workflowResults.length + offset,
    }),
  );
  const results: SearchResult[] = [...workflowResults, ...documentResults];
  const activeIndex = results.length
    ? Math.min(Math.max(0, requestedActiveIndex), results.length - 1)
    : 0;

  return {
    query,
    workflowResults,
    documentResults,
    results,
    activeIndex,
  };
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
