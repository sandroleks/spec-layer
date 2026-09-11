import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { zipFiles } from '../src/ui/download';

const FILES = {
  'spec-layer/SKILL.md': '# Spec Layer\n',
  'spec-layer/components/button.yaml': 'name: Button\n',
  'spec-layer/tokens/resolver.json': '{}\n',
};

describe('zipFiles', () => {
  it('round-trips every file to the same text', () => {
    const unzipped = unzipSync(zipFiles(FILES));
    const out: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(unzipped)) out[path] = strFromU8(bytes);
    expect(out).toEqual(FILES);
  });

  it('produces identical bytes for the same input', () => {
    expect(Array.from(zipFiles(FILES))).toEqual(Array.from(zipFiles(FILES)));
  });

  it('writes an empty record as a valid empty archive', () => {
    expect(Object.keys(unzipSync(zipFiles({})))).toEqual([]);
  });
});
