import { createHash } from 'node:crypto';

export type FetchBundleResult =
  | { kind: 'ok'; raw: string; publishedAt: string; bundleHash: string; version: string | null }
  | { kind: 'not_modified'; version: string | null }
  /**
   * `retryable` is true only for a failure the same request can get past on
   * its own: the network, the timeout, an unreadable body, or a 5xx. A 4xx
   * needs something changed first, so a caller must not suggest a bare retry.
   */
  | { kind: 'error'; message: string; retryable: boolean };

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
  // Worded for both places the deadline can fire: before the headers, and
  // while a slow body is still arriving.
  const timedOut: FetchBundleResult = {
    kind: 'error', message: `${opts.api} did not finish answering within ${timeoutMs / 1000} seconds.`, retryable: true,
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
    return isTimeout(err) ? timedOut : { kind: 'error', message: `Could not reach ${opts.api}.`, retryable: true };
  }
  const version = res.headers.get('X-Library-Version');
  if (res.status === 304) return { kind: 'not_modified', version };
  if (res.status === 401) {
    return {
      kind: 'error',
      message: 'Key was rotated or revoked. Run the setup command from the plugin\'s '
        + 'Publish screen to store the current key.',
      retryable: false,
    };
  }
  if (res.status === 404) return { kind: 'error', message: 'Library not found. It may have been unpublished.', retryable: false };
  if (!res.ok) return { kind: 'error', message: `Request failed with HTTP ${res.status}.`, retryable: res.status >= 500 };
  let raw: string;
  try {
    raw = await res.text();
  } catch (err) {
    return isTimeout(err)
      ? timedOut
      : { kind: 'error', message: `The response from ${opts.api} could not be read.`, retryable: true };
  }
  return {
    kind: 'ok',
    raw,
    publishedAt: res.headers.get('X-Published-At') ?? 'unknown',
    bundleHash: createHash('sha256').update(raw).digest('hex'),
    version,
  };
}
