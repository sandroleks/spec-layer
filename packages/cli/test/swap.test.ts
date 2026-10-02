import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { swapInto, type SwapFs } from '../src/files';

let root: string;
const target = () => join(root, '.speclayer');
const staging = () => join(root, '.speclayer.partial-abc');

function dirWith(path: string, content: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'manifest.json'), content);
}

/** Real filesystem calls, except that the `n`th rename (1-based) throws like a held file on Windows. */
function failingRename(...failOn: number[]): SwapFs {
  let calls = 0;
  return {
    existsSync,
    rmSync,
    renameSync: (from, to) => {
      calls += 1;
      if (failOn.includes(calls)) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), { code: 'EPERM' });
      renameSync(from, to);
    },
  };
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sl-swap-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('swapInto', () => {
  it('moves the staged copy into place when there is no previous one', () => {
    dirWith(staging(), 'new');
    swapInto(staging(), target());
    expect(readFileSync(join(target(), 'manifest.json'), 'utf8')).toBe('new');
    expect(readdirSync(root)).toEqual(['.speclayer']);
  });

  it('replaces a previous copy and leaves nothing beside it', () => {
    dirWith(target(), 'old');
    dirWith(staging(), 'new');
    swapInto(staging(), target());
    expect(readFileSync(join(target(), 'manifest.json'), 'utf8')).toBe('new');
    expect(readdirSync(root)).toEqual(['.speclayer']);
  });

  it('keeps the previous copy when the new one cannot move in', () => {
    dirWith(target(), 'old');
    dirWith(staging(), 'new');
    expect(() => swapInto(staging(), target(), failingRename(2))).toThrow(/EPERM/);
    expect(readFileSync(join(target(), 'manifest.json'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['.speclayer']);
  });

  it('changes nothing when the previous copy cannot move aside', () => {
    dirWith(target(), 'old');
    dirWith(staging(), 'new');
    expect(() => swapInto(staging(), target(), failingRename(1))).toThrow(/EPERM/);
    expect(readFileSync(join(target(), 'manifest.json'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['.speclayer']);
  });

  it('names where the previous copy is when it cannot be moved back either', () => {
    dirWith(target(), 'old');
    dirWith(staging(), 'new');
    expect(() => swapInto(staging(), target(), failingRename(2, 3))).toThrow(/intact at .*\.speclayer\.partial-abc\.previous/);
    expect(readFileSync(join(`${staging()}.previous`, 'manifest.json'), 'utf8')).toBe('old');
  });

  it('removes the staged copy when the first-ever move fails', () => {
    dirWith(staging(), 'new');
    expect(() => swapInto(staging(), target(), failingRename(1))).toThrow(/EPERM/);
    expect(existsSync(staging())).toBe(false);
    expect(existsSync(target())).toBe(false);
  });

  it('succeeds when the previous copy will not delete', () => {
    dirWith(target(), 'old');
    dirWith(staging(), 'new');
    const fs: SwapFs = {
      existsSync, renameSync,
      rmSync: (path, opts) => {
        if (path.endsWith('.previous')) throw new Error('EBUSY');
        rmSync(path, opts);
      },
    };
    swapInto(staging(), target(), fs);
    expect(readFileSync(join(target(), 'manifest.json'), 'utf8')).toBe('new');
  });
});
