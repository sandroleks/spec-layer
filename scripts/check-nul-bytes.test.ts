import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { controlOffence, isScannedPath } from './check-nul-bytes.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const script = join(here, 'check-nul-bytes.mjs');

describe('isScannedPath', () => {
  it.each([
    '.github/workflows/ci.yml',
    'eslint.config.mjs',
    'vitest.config.ts',
    'tsconfig.base.json',
    'package-lock.json',
    'CONTRIBUTING.md',
    'LICENSE',
    '.githooks/pre-commit',
    '.gitignore',
    '.github/CODEOWNERS',
    'scripts/check-main-sandbox.d.mts',
    'packages/brand/assets/Manrope-OFL.txt',
  ])('scans %s', (path) => {
    expect(isScannedPath(path)).toBe(true);
  });

  it.each([
    'packages/plugin/icon.png',
    'packages/brand/assets/manrope-400.ttf',
    'tools/some-binary-without-extension',
  ])('skips %s', (path) => {
    expect(isScannedPath(path)).toBe(false);
  });
});

describe('controlOffence', () => {
  it('names the first raw control byte wherever it sits', () => {
    expect(controlOffence('a.md', Buffer.from([0x61, 0x0a, 0x00, 0x62]))).toBe('raw control byte 0x00');
    expect(controlOffence('a.ts', Buffer.from([0x61, 0x01]))).toBe('raw control byte 0x01');
  });

  it('allows tab, line feed and carriage return', () => {
    expect(controlOffence('a.md', Buffer.from('a\tb\r\nc'))).toBeNull();
  });

  it('flags a source-level NUL escape in code files only', () => {
    // Built from a char code so this file does not itself carry the sequence.
    const escape = String.fromCharCode(92) + '0';
    expect(controlOffence('a.mjs', Buffer.from(`const k = a + '${escape}' + b;`))).toBe('NUL escape in source');
    expect(controlOffence('a.mts', Buffer.from(`const k = '${escape}';`))).toBe('NUL escape in source');
    expect(controlOffence('a.css', Buffer.from(`content: '${escape}0b7';`))).toBeNull();
  });
});

describe('the script entry point', () => {
  // check-main-sandbox.mjs once guarded its main() with a string comparison
  // (`import.meta.url === 'file://' + process.argv[1]`), which never matches
  // on a checkout path with a space (the URL form is percent-encoded), so the
  // gate exited 0 without scanning anything. This script's guard uses
  // pathToFileURL(resolve(...)) instead, which normalizes both sides before
  // comparing. Prove it actually runs main(), even from a directory whose
  // path contains a space, by pointing it at a scratch git repo that tracks
  // one offending file and checking it is reported, not silently passed.
  it('runs main() and reports an offence, even from a path with a space in it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl nul scan '));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'bad.md'), Buffer.from([0x61, 0x0a, 0x00, 0x62]));
      execFileSync('git', ['add', 'bad.md'], { cwd: dir });
      const run = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('bad.md (raw control byte 0x00)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 with no output on a clean scratch repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl nul scan clean '));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'good.md'), 'hello\n');
      execFileSync('git', ['add', 'good.md'], { cwd: dir });
      const run = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stderr).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
