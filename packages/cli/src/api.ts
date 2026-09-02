import { createHash } from 'node:crypto';

export type FetchBundleResult =
  | { kind: 'ok'; raw: string; publishedAt: string; bundleHash: string }
  | { kind: 'not_modified' }
  | { kind: 'error'; message: string };

export async function fetchBundle(opts: {
  api: string; libraryId: string; key: string; etag?: string; fetcher?: typeof fetch;
}): Promise<FetchBundleResult> {
  const doFetch = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.api}/v1/libraries/${opts.libraryId}`, {
      headers: {
        Authorization: `Bearer ${opts.key}`,
        ...(opts.etag ? { 'If-None-Match': `"${opts.etag}"` } : {}),
      },
    });
  } catch {
    return { kind: 'error', message: `Could not reach ${opts.api}.` };
  }
  if (res.status === 304) return { kind: 'not_modified' };
  if (res.status === 401) {
    return {
      kind: 'error',
      message: 'Key was rotated or revoked. Run the setup command from the plugin\'s '
        + 'Library screen to store the current key.',
    };
  }
  if (res.status === 404) return { kind: 'error', message: 'Library not found. It may have been unpublished.' };
  if (!res.ok) return { kind: 'error', message: `Request failed with HTTP ${res.status}.` };
  const raw = await res.text();
  return {
    kind: 'ok',
    raw,
    publishedAt: res.headers.get('X-Published-At') ?? 'unknown',
    bundleHash: createHash('sha256').update(raw).digest('hex'),
  };
}
