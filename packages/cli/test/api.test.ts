import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FETCH_TIMEOUT_MS, MAX_RETRY_WAIT_MS, fetchBundle, fetchBundleWithRetry, retriesFromEnv, userAgent } from '../src/api';
import { cliVersion } from '../src/version';

const GOOD = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: null,
  components: [],
};

describe('fetchBundle', () => {
  it('returns raw body, hash, and publishedAt on 200', async () => {
    const body = JSON.stringify(GOOD);
    const expectedHash = createHash('sha256').update(body).digest('hex');
    const fetcher = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { ETag: `"${expectedHash}"`, 'X-Published-At': '2026-09-01T00:00:00.000Z', 'X-Library-Version': '1.5.0' },
    })) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });

    expect(result).toEqual({
      kind: 'ok',
      raw: body,
      publishedAt: '2026-09-01T00:00:00.000Z',
      bundleHash: expectedHash,
      version: '1.5.0',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/libraries/lib_1');
    // The key must travel in the Authorization header only, never in the URL.
    expect(url).not.toContain('sl_secret');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sl_secret' });
  });

  it('returns not_modified on 304 and sends If-None-Match when etag given', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;

    const result = await fetchBundle({
      api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', etag: 'abc123', fetcher,
    });

    expect(result).toEqual({ kind: 'not_modified', version: null });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'If-None-Match': '"abc123"' });
  });

  it('reads a missing version header as null, on 200 and on 304', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200, headers: { 'X-Published-At': '2026-09-01T00:00:00.000Z' } })) as unknown as typeof fetch;
    expect(await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher: ok })).toMatchObject({ kind: 'ok', version: null });
    const notModified = vi.fn(async () => new Response(null, { status: 304, headers: { 'X-Library-Version': '1.5.0' } })) as unknown as typeof fetch;
    expect(await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', etag: 'e', fetcher: notModified })).toEqual({ kind: 'not_modified', version: '1.5.0' });
  });

  it('maps 401 to the rotated-key message', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });

    expect(result.kind).toBe('error');
    expect((result as { kind: 'error'; message: string }).message).toMatch(/rotated or revoked/);
    expect((result as { kind: 'error'; message: string }).message).toContain('Publish screen');
  });

  it('maps 404 to the not-found message', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });

    expect(result.kind).toBe('error');
    const message = (result as { kind: 'error'; message: string }).message;
    expect(message).toMatch(/not found/i);
    expect(message).toMatch(/unpublished/);
  });

  it('maps other statuses to an HTTP message', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });

    expect(result.kind).toBe('error');
    expect((result as { kind: 'error'; message: string }).message).toMatch(/HTTP 500/);
  });

  it('maps a thrown fetch to an unreachable message', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });

    expect(result.kind).toBe('error');
    expect((result as { kind: 'error'; message: string }).message).toMatch(/Could not reach/);
    expect((result as { kind: 'error'; message: string }).message).toContain('https://api.example.com');
  });

  it('gives up on a stalled server after the timeout and says so plainly', async () => {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('fetchBundle passed no signal'));
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason));
    })) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher, timeoutMs: 20 });

    expect(result).toEqual({ kind: 'error', message: 'https://api.example.com did not finish answering within 0.02 seconds.', retryable: true });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // The headers arrived, then the body stalled. A stub Response is not wired
  // to the signal the way a real fetch body is, so the stream wires it.
  it('gives the timeout message when the deadline fires during the body read', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error('fetchBundle passed no signal');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"schema":'));
          signal.addEventListener('abort', () => controller.error(signal.reason));
        },
      });
      return new Response(body, { status: 200, headers: { 'X-Published-At': '2026-09-01T00:00:00.000Z' } });
    }) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher, timeoutMs: 20 });

    expect(result).toEqual({ kind: 'error', message: 'https://api.example.com did not finish answering within 0.02 seconds.', retryable: true });
  });

  it('waits 30 seconds by default', () => {
    expect(FETCH_TIMEOUT_MS).toBe(30_000);
  });

  it('reports a body that cannot be read as an error instead of throwing', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('socket hang up')); },
    });
    const fetcher = vi.fn(async () => new Response(broken, {
      status: 200, headers: { 'X-Published-At': '2026-09-01T00:00:00.000Z' },
    })) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });

    expect(result).toEqual({ kind: 'error', message: 'The response from https://api.example.com could not be read.', retryable: true });
  });

  it('marks only a network, timeout, 5xx or 429 failure as worth retrying', async () => {
    const withStatus = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;
    const retryable = async (fetcher: typeof fetch): Promise<unknown> => {
      const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });
      return (result as { retryable?: unknown }).retryable;
    };
    for (const status of [429, 500, 502, 503, 504]) expect(await retryable(withStatus(status)), String(status)).toBe(true);
    for (const status of [400, 401, 403, 404]) expect(await retryable(withStatus(status)), String(status)).toBe(false);
    const down = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    expect(await retryable(down)).toBe(true);
  });

  it('URL-encodes the library id, so an id with a slash cannot change the path', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1/../../admin', key: 'sl_secret', fetcher });

    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://api.example.com/v1/libraries/lib_1%2F..%2F..%2Fadmin');
  });

  it('sends a User-Agent naming the CLI and Node versions', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'User-Agent': `spec-layer/${cliVersion()} node/${process.versions.node}` });
    expect(userAgent()).not.toContain('unknown');
  });

  it('names the system error code under a failed connection', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    }) as unknown as typeof fetch;
    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher, env: {} });
    expect(result).toEqual({ kind: 'error', message: 'Could not reach https://api.example.com (ENOTFOUND).', retryable: true });
  });

  it('points at NODE_USE_ENV_PROXY when a proxy variable is set without it', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const message = async (env: Record<string, string>) => (await fetchBundle({
      api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher, env,
    }) as { message: string }).message;
    expect(await message({ HTTPS_PROXY: 'http://proxy:3128' })).toMatch(/HTTPS_PROXY is set, but Node's built-in fetch only uses it when NODE_USE_ENV_PROXY=1/);
    expect(await message({ HTTPS_PROXY: 'http://proxy:3128', NODE_USE_ENV_PROXY: '1' })).toBe('Could not reach https://api.example.com.');
    expect(await message({})).toBe('Could not reach https://api.example.com.');
  });

  it('points at NODE_EXTRA_CA_CERTS on a certificate error', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('self-signed'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) });
    }) as unknown as typeof fetch;
    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher, env: {} });
    expect((result as { message: string }).message).toMatch(/\(SELF_SIGNED_CERT_IN_CHAIN\)\. .*NODE_EXTRA_CA_CERTS/);
  });

  it('refuses a response past the size cap, declared or streamed', async () => {
    const declared = vi.fn(async () => new Response('x'.repeat(10), { status: 200, headers: { 'content-length': '999999' } })) as unknown as typeof fetch;
    const streamed = vi.fn(async () => new Response('x'.repeat(2048), { status: 200 })) as unknown as typeof fetch;
    for (const fetcher of [declared, streamed]) {
      const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher, maxBytes: 1024 });
      expect(result).toMatchObject({ kind: 'error', retryable: false });
      expect((result as { message: string }).message).toMatch(/larger than/);
    }
    const fits = vi.fn(async () => new Response('x'.repeat(1024), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher: fits, maxBytes: 1024 })).toMatchObject({ kind: 'ok' });
  });
});

describe('fetchBundleWithRetry', () => {
  const OPTS = { api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', env: {} };
  /** Answers each call with the next status in `statuses`; the last one repeats. */
  const sequence = (...statuses: Array<number | 'down'>) => {
    let i = 0;
    return vi.fn(async () => {
      const s = statuses[Math.min(i++, statuses.length - 1)];
      if (s === 'down') throw new TypeError('fetch failed');
      return new Response(s === 200 ? '{}' : null, { status: s, headers: s === 429 ? { 'retry-after': '2' } : {} });
    }) as unknown as typeof fetch;
  };

  it('retries a 503 and a dropped connection, then returns the answer', async () => {
    const fetcher = sequence(503, 'down', 200);
    const sleep = vi.fn(async () => {});
    const notes: string[] = [];
    const result = await fetchBundleWithRetry({ ...OPTS, fetcher }, { sleep, random: () => 0, onRetry: (m) => notes.push(m) });
    expect(result.kind).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
    expect(notes[0]).toMatch(/HTTP 503\. Retrying in 1 s \(1 of 2\)\./);
  });

  it('waits what Retry-After says on a 429', async () => {
    const sleep = vi.fn(async () => {});
    await fetchBundleWithRetry({ ...OPTS, fetcher: sequence(429, 200) }, { sleep });
    expect(sleep.mock.calls).toEqual([[2000]]);
  });

  it('jitters the backoff by up to half again', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    await fetchBundleWithRetry({ ...OPTS, fetcher: sequence(500, 200) }, { sleep, random: () => 0.999 });
    expect(sleep.mock.calls[0][0]).toBe(1500);
  });

  it('never retries what a retry cannot fix', async () => {
    for (const status of [400, 401, 403, 404]) {
      const fetcher = sequence(status);
      await fetchBundleWithRetry({ ...OPTS, fetcher }, { sleep: async () => {} });
      expect(fetcher, String(status)).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after the retries and returns the last error', async () => {
    const fetcher = sequence(502);
    const result = await fetchBundleWithRetry({ ...OPTS, fetcher }, { sleep: async () => {} });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ kind: 'error', message: 'Request failed with HTTP 502.' });
  });

  it('reports at once rather than wait out a Retry-After past the cap', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503, headers: { 'retry-after': String(MAX_RETRY_WAIT_MS / 1000 + 1) } })) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    await fetchBundleWithRetry({ ...OPTS, fetcher }, { sleep });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('makes one attempt with retries: 0', async () => {
    const fetcher = sequence(503);
    await fetchBundleWithRetry({ ...OPTS, fetcher }, { retries: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('retriesFromEnv', () => {
  it.each([
    [undefined, 2], ['0', 0], ['1', 1], [' 3 ', 3], ['-1', 2], ['ten', 2], ['12', 2],
  ])('SPEC_LAYER_RETRIES=%s → %i', (raw, expected) => {
    expect(retriesFromEnv(raw === undefined ? {} : { SPEC_LAYER_RETRIES: raw })).toBe(expected);
  });
});
