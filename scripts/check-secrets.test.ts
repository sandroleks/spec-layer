import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SECRET_PATTERNS, matchLine, scanDiff, scanText } from './check-secrets.mjs';
import { PULL_KEY_RE } from '../packages/proxy/src/libraries';

const script = resolve(fileURLToPath(new URL('.', import.meta.url)), 'check-secrets.mjs');

// Assembled at runtime, so this file never holds a value the scan would reject.
const PULL_KEY = `sl_${'0123456789abcdef'.repeat(3)}`;

function run(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

function scratchRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'sl-secrets-'));
  git(cwd, 'init', '-q');
  return cwd;
}

describe('SECRET_PATTERNS', () => {
  it('matches the pull key shape the proxy issues', () => {
    expect(PULL_KEY_RE.test(PULL_KEY)).toBe(true);
    expect(matchLine(`key: ${PULL_KEY}`).map((m) => m.source)).toEqual(['sl_[0-9a-f]{48}']);
  });

  it('does not match its own pattern sources', () => {
    for (const [, source] of SECRET_PATTERNS) expect(matchLine(source)).toEqual([]);
  });
});

describe('scanDiff', () => {
  it('reports added lines only, with the file they were added to', () => {
    const diff = [
      'diff --git a/notes.txt b/notes.txt',
      '--- a/notes.txt',
      '+++ b/notes.txt',
      `-old: ${PULL_KEY}`,
      `+new: ${PULL_KEY}`,
      ' context',
    ].join('\n');
    const findings = scanDiff(diff);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'notes.txt', source: 'sl_[0-9a-f]{48}' });
  });

  it('lets a removal through', () => {
    expect(scanDiff(['+++ b/notes.txt', `-gone: ${PULL_KEY}`].join('\n'))).toEqual([]);
  });
});

describe('scanText', () => {
  it('numbers lines from 1', () => {
    expect(scanText('a.md', `one\ntwo ${PULL_KEY}\n`)[0]).toMatchObject({ file: 'a.md', lineNumber: 2 });
  });
});

describe('check-secrets.mjs', { timeout: 20000 }, () => {
  it('--tree fails on a tracked text file and never echoes the whole value', () => {
    const cwd = scratchRepo();
    try {
      writeFileSync(join(cwd, 'notes.md'), `key: ${PULL_KEY}\n`);
      git(cwd, 'add', 'notes.md');
      const { status, output } = run(cwd, '--tree');
      expect(status).toBe(1);
      expect(output).toContain('notes.md:1');
      expect(output).not.toContain(PULL_KEY);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('--tree skips files outside the text allowlist', () => {
    const cwd = scratchRepo();
    try {
      writeFileSync(join(cwd, 'image.png'), `key: ${PULL_KEY}\n`);
      git(cwd, 'add', 'image.png');
      expect(run(cwd, '--tree')).toMatchObject({ status: 0 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('--range catches a value added and then removed inside the range', () => {
    const cwd = scratchRepo();
    try {
      writeFileSync(join(cwd, 'a.txt'), 'base\n');
      git(cwd, 'add', 'a.txt');
      git(cwd, 'commit', '-q', '-m', 'base');
      const base = git(cwd, 'rev-parse', 'HEAD');
      writeFileSync(join(cwd, 'a.txt'), `base\n${PULL_KEY}\n`);
      git(cwd, 'commit', '-q', '-am', 'leak');
      const leak = git(cwd, 'rev-parse', 'HEAD');
      expect(run(cwd, '--range', base, leak)).toMatchObject({ status: 1 });
      writeFileSync(join(cwd, 'a.txt'), 'base\n');
      git(cwd, 'commit', '-q', '-am', 'remove');
      expect(run(cwd, '--range', base, 'HEAD')).toMatchObject({ status: 1 });
      expect(run(cwd, '--range', leak, 'HEAD')).toMatchObject({ status: 0 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exits 2 on a usage error, so a broken invocation never reads as a finding or a pass', () => {
    expect(run(process.cwd(), '--range')).toMatchObject({ status: 2 });
    expect(run(process.cwd())).toMatchObject({ status: 2 });
  });
});
