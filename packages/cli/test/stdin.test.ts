import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { readFirstLine } from '../src/stdin';

describe('readFirstLine', () => {
  it('returns the first non-empty line, trimmed', async () => {
    expect(await readFirstLine(Readable.from(['  sl_abc  \n', 'second\n']))).toBe('sl_abc');
    expect(await readFirstLine(Readable.from(['\n', '\n', 'sl_x']))).toBe('sl_x');
  });

  it('returns null when the stream ends without a line', async () => {
    expect(await readFirstLine(Readable.from([]))).toBeNull();
    expect(await readFirstLine(Readable.from(['\n\n']))).toBeNull();
  });
});
