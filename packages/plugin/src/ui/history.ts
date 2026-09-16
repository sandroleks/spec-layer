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

export interface HistoryState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'gone' | 'noLibrary' | 'noKey';
  log: VersionLog | null;
  etag: string | null;
  message: string | null;
  /** The one expanded record's version, or null. */
  expanded: string | null;
}

let state: HistoryState = { status: 'idle', log: null, etag: null, message: null, expanded: null };
let host: { repaint(): void } = { repaint: () => {} };

export function setHistoryHost(next: { repaint(): void }): void { host = next; }
export function historyState(): Readonly<HistoryState> { return state; }

const UNREACHABLE = 'Could not reach the publish service. Check your connection and try again.';
const BAD_LIBRARY_ID = 'The library id stored for this file is not valid, so the history cannot be loaded.';

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
  if (res.status === 401) return { kind: 'error', message: 'The pull key on this device no longer opens this library. Rotate the key and try again.' };
  if (res.status === 429) return { kind: 'error', message: 'Too many requests just now. Give it a minute.' };
  if (!res.ok) return { kind: 'error', message: `Loading the history failed with HTTP ${res.status}.` };
  let log: VersionLog;
  try {
    log = await res.json() as VersionLog;
  } catch {
    return { kind: 'error', message: 'The publish service answered with something that is not a version log.' };
  }
  if (!log || log.v !== 1 || !Array.isArray(log.records)) {
    return { kind: 'error', message: 'The publish service answered with something that is not a version log.' };
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
  const answer = await fetchVersionLog({ libraryId, pullKey, etag: state.etag, fetcher });
  switch (answer.kind) {
    case 'ok':
      state = { ...state, status: 'ready', log: answer.log, etag: answer.etag, message: null };
      break;
    case 'not_modified':
      state = { ...state, status: state.log ? 'ready' : 'error', message: state.log ? null : UNREACHABLE };
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
