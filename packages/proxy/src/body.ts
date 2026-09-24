/**
 * A request body read in chunks and dropped the moment the running total
 * passes `maxBytes`, so an oversized body is never held whole in memory.
 * `size` on refusal is the declared Content-Length when the header says so up
 * front, else the byte count at the chunk that crossed the cap: at least
 * `maxBytes + 1`, and never a guess at what the rest would have been.
 */
export type CappedBody =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'too_large'; size: number }
  | { kind: 'unreadable' };

export async function readBodyCapped(req: Request, maxBytes: number): Promise<CappedBody> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return { kind: 'too_large', size: declared };
  if (req.body === null) return { kind: 'ok', bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Fire-and-forget: a rejected cancel is not this request's problem, and
        // must never turn an already-decided `too_large` into `unreadable`.
        void reader.cancel().catch(() => {});
        return { kind: 'too_large', size: total };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: 'unreadable' };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}
