import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FETCH_TIMEOUT_MS, fetchBundle } from '../src/api';

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

    expect(result).toEqual({ kind: 'error', message: 'No response from https://api.example.com within 0.02 seconds.' });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
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

    expect(result).toEqual({ kind: 'error', message: 'The response from https://api.example.com could not be read.' });
  });

  it('URL-encodes the library id, so an id with a slash cannot change the path', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1/../../admin', key: 'sl_secret', fetcher });

    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://api.example.com/v1/libraries/lib_1%2F..%2F..%2Fadmin');
  });
});
