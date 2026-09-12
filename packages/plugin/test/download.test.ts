import { describe, it, expect, vi, afterEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { zipFiles } from '../src/ui/download';

const FILES = {
  'spec-layer/SKILL.md': '# Spec Layer\n',
  'spec-layer/components/button.yaml': 'name: Button\n',
  'spec-layer/tokens/resolver.json': '{}\n',
};

describe('zipFiles', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips every file to the same text', () => {
    const unzipped = unzipSync(zipFiles(FILES));
    const out: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(unzipped)) out[path] = strFromU8(bytes);
    expect(out).toEqual(FILES);
  });

  it('does not depend on wall-clock time', () => {
    // fflate's DOS timestamp has ~2-second resolution, so two calls in the
    // same tick would agree even if `zipFiles` used `Date.now()` internally.
    // Move the clock more than two seconds between calls to actually exercise
    // independence from wall-clock time, not same-tick coincidence.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const first = zipFiles(FILES);
    vi.setSystemTime(new Date('2020-01-01T00:00:05.000Z'));
    const second = zipFiles(FILES);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('writes an empty record as a valid empty archive', () => {
    expect(Object.keys(unzipSync(zipFiles({})))).toEqual([]);
  });
});
