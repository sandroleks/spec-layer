import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { fetchBundle } from '../src/api';

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
      headers: { ETag: `"${expectedHash}"`, 'X-Published-At': '2026-09-01T00:00:00.000Z' },
    })) as unknown as typeof fetch;

    const result = await fetchBundle({ api: 'https://api.example.com', libraryId: 'lib_1', key: 'sl_secret', fetcher });

    expect(result).toEqual({
      kind: 'ok',
      raw: body,
      publishedAt: '2026-09-01T00:00:00.000Z',
      bundleHash: expectedHash,
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

    expect(result).toEqual({ kind: 'not_modified' });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'If-None-Match': '"abc123"' });
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
});
