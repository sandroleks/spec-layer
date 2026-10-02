import { describe, it, expect } from 'vitest';
import { sha256 } from 'js-sha256';
import { sha256Hex } from '../src/digest';

describe('sha256Hex', () => {
  it.each([
    ['empty', ''],
    ['ascii', '{"schema":"spec-layer-library-bundle"}'],
    ['multi-byte', 'Bouton – 按钮 – 🔘'],
    ['large', 'x'.repeat(5_000_000)],
  ])('matches js-sha256 byte for byte on %s input', async (_label, text) => {
    expect(await sha256Hex(text)).toBe(sha256(text));
  });

  it('answers the known digest of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
