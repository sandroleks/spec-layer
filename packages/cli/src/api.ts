import { createHash } from 'node:crypto';

export type FetchBundleResult =
  | { kind: 'ok'; raw: string; publishedAt: string; bundleHash: string; version: string | null }
  | { kind: 'not_modified'; version: string | null }
  | { kind: 'error'; message: string };

/** How long one request may take, headers and body together, before the CLI gives up and says so. */
export const FETCH_TIMEOUT_MS = 30_000;

/** `AbortSignal.timeout` rejects with a DOMException named TimeoutError; nothing else in this path does. */
const isTimeout = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError';

export async function fetchBundle(opts: {
  api: string; libraryId: string; key: string; etag?: string; fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<FetchBundleResult> {
  const doFetch = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const timedOut: FetchBundleResult = {
    kind: 'error', message: `No response from ${opts.api} within ${timeoutMs / 1000} seconds.`,
  };
  // One signal covers the headers and the body. Without it a stalled server
  // hung pull and status forever, with nothing printed.
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await doFetch(`${opts.api}/v1/libraries/${encodeURIComponent(opts.libraryId)}`, {
      headers: {
        Authorization: `Bearer ${opts.key}`,
        ...(opts.etag ? { 'If-None-Match': `"${opts.etag}"` } : {}),
      },
      signal,
    });
  } catch (err) {
    return isTimeout(err) ? timedOut : { kind: 'error', message: `Could not reach ${opts.api}.` };
  }
  const version = res.headers.get('X-Library-Version');
  if (res.status === 304) return { kind: 'not_modified', version };
  if (res.status === 401) {
    return {
      kind: 'error',
      message: 'Key was rotated or revoked. Run the setup command from the plugin\'s '
        + 'Library screen to store the current key.',
    };
  }
  if (res.status === 404) return { kind: 'error', message: 'Library not found. It may have been unpublished.' };
  if (!res.ok) return { kind: 'error', message: `Request failed with HTTP ${res.status}.` };
  let raw: string;
  try {
    raw = await res.text();
  } catch (err) {
    return isTimeout(err) ? timedOut : { kind: 'error', message: `The response from ${opts.api} could not be read.` };
  }
  return {
    kind: 'ok',
    raw,
    publishedAt: res.headers.get('X-Published-At') ?? 'unknown',
    bundleHash: createHash('sha256').update(raw).digest('hex'),
    version,
  };
}
