import { describe, it, expect } from 'vitest';
import { readBodyCapped } from '../src/body';

/** A body that streams `chunks` blocks of `chunkBytes`, recording how many were pulled. */
function streamingRequest(chunks: number, chunkBytes: number, headers: Record<string, string> = {}) {
  const pulled = { count: 0 };
  // `type: 'bytes'` matters here, not just for realism: Node's fetch
  // implementation eagerly pulls one chunk from a default ReadableStream body
  // the moment a Request wraps it (before any reader is ever created), which
  // would otherwise show up as a false pull in a test that asserts zero reads
  // happened. A byte stream is read lazily instead, so `pulled.count` reflects
  // only what `readBodyCapped` itself pulled.
  const stream = new ReadableStream<Uint8Array>({
    type: 'bytes',
    pull(controller) {
      pulled.count += 1;
      if (pulled.count > chunks) { controller.close(); return; }
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
    },
  });
  const req = new Request('https://proxy.test/v1/libraries', {
    method: 'POST', headers, body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return { req, pulled };
}

describe('readBodyCapped', () => {
  it('returns the whole body as bytes when it fits', async () => {
    const req = new Request('https://proxy.test/x', { method: 'POST', body: 'héllo' });
    const out = await readBodyCapped(req, 100);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(new TextDecoder().decode(out.bytes)).toBe('héllo');
  });

  it('refuses on the declared length before reading a byte', async () => {
    const { req, pulled } = streamingRequest(100, 100_000, { 'content-length': '10000000' });
    expect(await readBodyCapped(req, 5_000_000)).toEqual({ kind: 'too_large', size: 10_000_000 });
    expect(pulled.count).toBe(0);
  });

  it('abandons an undeclared body the moment it crosses the cap', async () => {
    const { req, pulled } = streamingRequest(100, 100_000);
    const out = await readBodyCapped(req, 5_000_000);
    expect(out.kind).toBe('too_large');
    if (out.kind === 'too_large') {
      expect(out.size).toBeGreaterThan(5_000_000);
      expect(out.size).toBeLessThanOrEqual(5_200_000);
    }
    // 51 chunks cross the cap; the stream's own read-ahead may pull one or two more, never the whole body.
    expect(pulled.count).toBeLessThan(60);
  });

  it('reads an empty body as zero bytes', async () => {
    const out = await readBodyCapped(new Request('https://proxy.test/x', { method: 'POST' }), 10);
    expect(out).toEqual({ kind: 'ok', bytes: new Uint8Array(0) });
  });

  it('reports a body whose stream fails as unreadable', async () => {
    const stream = new ReadableStream<Uint8Array>({ pull() { throw new Error('reset'); } });
    const req = new Request('https://proxy.test/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
    expect(await readBodyCapped(req, 10)).toEqual({ kind: 'unreadable' });
  });
});
