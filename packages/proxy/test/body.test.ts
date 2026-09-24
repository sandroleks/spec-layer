import { describe, it, expect } from 'vitest';
import { readBodyCapped } from '../src/body';

/** A body that streams `chunks` blocks of `chunkBytes`, recording how many were pulled. */
function streamingRequest(chunks: number, chunkBytes: number, headers: Record<string, string> = {}) {
  const pulled = { count: 0 };
  // `type: 'bytes'` matters here, not just for realism: a default stream's
  // queuing strategy has a highWaterMark of 1, so it eagerly calls `pull`
  // once to fill its internal queue the moment it is constructed, with no
  // reader and no Request involved at all. A byte stream has no such
  // read-ahead, so `pulled.count` reflects only what `readBodyCapped` itself
  // pulled, and this is also the closer model of a Workers request body,
  // which streams incoming bytes rather than pre-buffering them. Dropping the
  // `<Uint8Array>` type argument here is required, not cosmetic: with the
  // argument given, TS resolves the non-byte `ReadableStream` overload, whose
  // `UnderlyingDefaultSource` has no `type` field, so `type: 'bytes'` fails to
  // typecheck; omitting it lets TS pick the byte-source overload and infer
  // `ReadableStream<Uint8Array>` from `controller.enqueue`'s argument.
  const stream = new ReadableStream({
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
    // 50 chunks of 100,000 bytes reach the cap exactly; the 51st crosses it and
    // is the last one pulled. A byte stream has no read-ahead, so this is exact.
    expect(pulled.count).toBe(51);
  });

  it('abandons a body whose declared length undercounts once the stream itself crosses the cap', async () => {
    // The header lies low; only the bytes actually read decide the outcome.
    const { req, pulled } = streamingRequest(100, 100_000, { 'content-length': '1000' });
    const out = await readBodyCapped(req, 5_000_000);
    expect(out.kind).toBe('too_large');
    if (out.kind === 'too_large') {
      expect(out.size).toBeGreaterThan(5_000_000);
      expect(out.size).toBeLessThanOrEqual(5_100_000);
    }
    expect(pulled.count).toBe(51);
  });

  it('reassembles a multi-byte character split across a chunk boundary', async () => {
    // 'é' as UTF-8 is the two bytes 0xC3 0xA9; splitting them across two
    // pulled chunks proves the bytes are concatenated whole before any
    // decoding happens, rather than decoded chunk by chunk.
    let calls = 0;
    const stream = new ReadableStream({
      type: 'bytes',
      pull(controller) {
        calls += 1;
        if (calls === 1) { controller.enqueue(new Uint8Array([0x68, 0xc3])); return; } // 'h', half of 'é'
        if (calls === 2) { controller.enqueue(new Uint8Array([0xa9])); return; } // rest of 'é'
        controller.close();
      },
    });
    const req = new Request('https://proxy.test/x', {
      method: 'POST', body: stream, duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const out = await readBodyCapped(req, 100);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(new TextDecoder().decode(out.bytes)).toBe('hé');
  });

  it('reports too_large even when the cancel it triggers rejects', async () => {
    const stream = new ReadableStream({
      type: 'bytes',
      pull(controller) { controller.enqueue(new Uint8Array(20).fill(0x61)); },
      cancel() { throw new Error('cancel failed'); },
    });
    const req = new Request('https://proxy.test/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
    expect(await readBodyCapped(req, 10)).toEqual({ kind: 'too_large', size: 20 });
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
