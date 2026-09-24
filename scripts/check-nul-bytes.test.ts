import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  // The entry guard once compared import.meta.url to `file://` + argv[1],
  // which fails on a path with a space (the URL form is percent-encoded), and
  // then to pathToFileURL(resolve(argv[1])), which fails when the script is
  // reached through a symlink (Node sets import.meta.url to the real path).
  // Either way the gate exited 0 without scanning. The script is copied into
  // a directory whose name has a space and run through an explicit symlink,
  // so a regression fails on Linux CI as well as on macOS, where tmpdir()
  // itself sits behind a symlink. It imports only node: modules, so the copy
  // runs on its own; the scratch git repo it scans is the working directory.
  let toolDir: string;
  let link: string;

  beforeAll(() => {
    toolDir = mkdtempSync(join(tmpdir(), 'sl nul tool '));
    mkdirSync(join(toolDir, 'real dir'));
    const copy = join(toolDir, 'real dir', 'check-nul-bytes.mjs');
    copyFileSync(script, copy);
    link = join(toolDir, 'linked check.mjs');
    symlinkSync(copy, link);
  });

  afterAll(() => {
    rmSync(toolDir, { recursive: true, force: true });
  });

  function scratchRepo(prefix: string, file: string, contents: Buffer | string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, file), contents);
    execFileSync('git', ['add', file], { cwd: dir });
    return dir;
  }

  it('runs main() and reports an offence when reached through a symlink in a path with a space', () => {
    const dir = scratchRepo('sl nul scan ', 'bad.md', Buffer.from([0x61, 0x0a, 0x00, 0x62]));
    try {
      const run = spawnSync(process.execPath, [link], { cwd: dir, encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('bad.md (raw control byte 0x00)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints one success line on a clean scratch repo, so a skipped scan cannot look clean', () => {
    const dir = scratchRepo('sl nul scan clean ', 'good.md', 'hello\n');
    try {
      const run = spawnSync(process.execPath, [link], { cwd: dir, encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('NUL scan: 1 tracked text file clean.\n');
      expect(run.stderr).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
