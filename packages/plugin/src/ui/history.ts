/**
 * history.ts: state and fetch for the version history pane. Same shape as
 * publish.ts's controller: module state, a host for repaint, and pure fetch
 * helpers that take a fetcher for tests.
 *
 * The log is fetched with the pull key, like a pull, and cached by ETag for
 * the session: reopening the pane sends If-None-Match and keeps what it has
 * on a 304.
 */
import type { VersionLog } from '@spec-layer/extractor';
import { PROXY_URL, isLibraryId } from './proxy';

interface HistoryStateBase {
  log: VersionLog | null;
  etag: string | null;
  /** The one expanded record's version, or null. */
  expanded: string | null;
}

/** An error always carries the sentence the pane shows; no other status carries one. */
export type HistoryState = HistoryStateBase & (
  | { status: 'error'; message: string }
  | { status: 'idle' | 'loading' | 'ready' | 'gone' | 'noLibrary' | 'noKey'; message: null }
);

let state: HistoryState = { status: 'idle', log: null, etag: null, message: null, expanded: null };
let host: { repaint(): void } = { repaint: () => {} };

export function setHistoryHost(next: { repaint(): void }): void { host = next; }
export function historyState(): Readonly<HistoryState> { return state; }

const UNREACHABLE = 'Couldn’t reach Spec Layer. Check your connection and try again.';
const BAD_LIBRARY_ID = 'Couldn’t load versions. This file’s link to its published library is damaged.';
const UNREADABLE = 'Couldn’t load versions. Spec Layer sent a reply the plugin couldn’t read. Try again in a moment.';

export async function fetchVersionLog(opts: {
  libraryId: string; pullKey: string; etag: string | null; fetcher?: typeof fetch;
}): Promise<
  | { kind: 'ok'; log: VersionLog; etag: string | null }
  | { kind: 'not_modified' }
  | { kind: 'gone' }
  | { kind: 'error'; message: string }
> {
  const doFetch = opts.fetcher ?? fetch;
  // The id goes into the path and the pull key into the header, so an id that
  // is not the shape the proxy issues never becomes a request.
  if (!isLibraryId(opts.libraryId)) return { kind: 'error', message: BAD_LIBRARY_ID };
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries/${opts.libraryId}/versions`, {
      headers: { Authorization: `Bearer ${opts.pullKey}`, ...(opts.etag ? { 'If-None-Match': opts.etag } : {}) },
    });
  } catch {
    return { kind: 'error', message: UNREACHABLE };
  }
  if (res.status === 304) return { kind: 'not_modified' };
  if (res.status === 404) return { kind: 'gone' };
  if (res.status === 401) {
    return {
      kind: 'error',
      message: 'Couldn’t load versions. This device’s pull key no longer works, likely because it was rotated elsewhere. ' +
        'Open History there, or rotate the key on the Publish screen.',
    };
  }
  if (res.status === 429) {
    return { kind: 'error', message: 'Couldn’t load versions. Too many requests in the last minute. Try again in a minute.' };
  }
  if (!res.ok) return { kind: 'error', message: `Couldn’t load versions. Try again in a moment (HTTP ${res.status}).` };
  let log: VersionLog;
  try {
    log = await res.json() as VersionLog;
  } catch {
    return { kind: 'error', message: UNREADABLE };
  }
  if (!log || log.v !== 1 || !Array.isArray(log.records)) {
    return { kind: 'error', message: UNREADABLE };
  }
  return { kind: 'ok', log, etag: res.headers.get('ETag') };
}

export async function onHistoryOpen(libraryId: string | null, pullKey: string | null, fetcher?: typeof fetch): Promise<void> {
  if (!libraryId) {
    state = { ...state, status: 'noLibrary', log: null, message: null };
    host.repaint();
    return;
  }
  if (!pullKey) {
    state = { ...state, status: 'noKey', log: null, message: null };
    host.repaint();
    return;
  }
  state = { ...state, status: 'loading', message: null };
  host.repaint();
  let answer = await fetchVersionLog({ libraryId, pullKey, etag: state.etag, fetcher });
  // A 304 means Spec Layer answered, so it is never a connection failure. With
  // no log cached to keep, ask again without If-None-Match for the whole log.
  if (answer.kind === 'not_modified' && !state.log) {
    answer = await fetchVersionLog({ libraryId, pullKey, etag: null, fetcher });
  }
  switch (answer.kind) {
    case 'ok':
      state = { ...state, status: 'ready', log: answer.log, etag: answer.etag, message: null };
      break;
    case 'not_modified':
      // Still a 304 to a request that named no version: an answer, not a log.
      state = state.log
        ? { ...state, status: 'ready', message: null }
        : { ...state, status: 'error', message: UNREADABLE };
      break;
    case 'gone':
      state = { ...state, status: 'gone', log: null, etag: null, message: null };
      break;
    case 'error':
      state = { ...state, status: 'error', message: answer.message };
      break;
  }
  host.repaint();
}

export function onHistoryToggle(version: string): void {
  state = { ...state, expanded: state.expanded === version ? null : version };
  host.repaint();
}
