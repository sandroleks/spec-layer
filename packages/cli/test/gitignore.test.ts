import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureIgnored } from '../src/gitignore';

const NAME = 'speclayer.local.json';

function gitInit(cwd: string, args: string[] = []): void {
  const res = spawnSync('git', ['init', '-q', ...args], { cwd });
  if (res.status !== 0) throw new Error('git init failed; git must be on PATH for these tests');
}

/** Commits `fileName` so git tracks it, which is what defeats check-ignore. */
function gitCommit(cwd: string, fileName: string): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
  };
  for (const args of [['add', '--force', fileName], ['commit', '-q', '-m', 'add']]) {
    const res = spawnSync('git', args, { cwd, env, stdio: 'ignore' });
    if (res.status !== 0) throw new Error(`git ${args[0]} failed`);
  }
}

/**
 * Runs `fn` with PATH pointed at an empty directory, so any `spawnSync('git',
 * ...)` inside it fails to find the binary (ENOENT) rather than running git.
 * This simulates a slim environment without git installed, without touching
 * the real PATH outside the call.
 */
function withoutGitOnPath<T>(fn: () => T): T {
  const emptyDir = mkdtempSync(join(tmpdir(), 'sl-no-git-path-'));
  const originalPath = process.env.PATH;
  process.env.PATH = emptyDir;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
    rmSync(emptyDir, { recursive: true, force: true });
  }
}

describe('ensureIgnored', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-ignore-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('reports not-a-repo outside a git working tree', () => {
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'not-a-repo' });
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false);
  });

  it('creates .gitignore with the entry when there is none', () => {
    gitInit(cwd);
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'created' });
    expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain(NAME);
  });

  it('appends to an existing .gitignore', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, '.gitignore'), 'node_modules\n');
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'added' });
    const body = readFileSync(join(cwd, '.gitignore'), 'utf8');
    expect(body).toContain('node_modules');
    expect(body).toContain(NAME);
  });

  it('appends cleanly when the file has no trailing newline', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, '.gitignore'), 'node_modules');
    ensureIgnored(cwd, NAME);
    const lines = readFileSync(join(cwd, '.gitignore'), 'utf8').split('\n');
    expect(lines).toContain('node_modules');
    expect(lines).toContain(NAME);
  });

  it('is idempotent: a second call adds nothing', () => {
    gitInit(cwd);
    ensureIgnored(cwd, NAME);
    const first = readFileSync(join(cwd, '.gitignore'), 'utf8');
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'already' });
    expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toBe(first);
  });

  // A broad pattern already covers the file, so appending the name would be
  // noise. git decides, so this passes without any pattern parsing.
  it('reports already when a wildcard pattern covers the file', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, '.gitignore'), '*.local.json\n');
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'already' });
  });

  it('refuses when .gitignore cannot be written', () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits
    gitInit(cwd);
    const path = join(cwd, '.gitignore');
    writeFileSync(path, 'node_modules\n');
    chmodSync(path, 0o444);
    const result = ensureIgnored(cwd, NAME);
    expect(result.kind).toBe('refused');
    expect((result as { kind: 'refused'; line: string }).line).toBe(NAME);
    chmodSync(path, 0o644);
  });

  // The important case: a real working tree, but git cannot be run at all.
  // Reporting this as "not a repository" would be a false reassurance that
  // lets a caller write an un-ignored secret into a real git checkout.
  it('reports no-git when a working tree exists but git cannot run', () => {
    gitInit(cwd);
    const result = withoutGitOnPath(() => ensureIgnored(cwd, NAME));
    expect(result).toEqual({ kind: 'no-git', line: NAME });
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false);
  });

  it('still reports not-a-repo when git cannot run and there is no .git', () => {
    const result = withoutGitOnPath(() => ensureIgnored(cwd, NAME));
    expect(result).toEqual({ kind: 'not-a-repo' });
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false);
  });

  // Running the pasted setup command from a package subdirectory is normal in
  // a monorepo, and a missing git binary is a slim-container thing. Looking
  // only at cwd for `.git` found nothing here and called it "no repository".
  it('reports no-git from a subdirectory of a working tree when git cannot run', () => {
    gitInit(cwd);
    const sub = join(cwd, 'apps', 'web');
    mkdirSync(sub, { recursive: true });
    const result = withoutGitOnPath(() => ensureIgnored(sub, NAME));
    expect(result).toEqual({ kind: 'no-git', line: NAME });
    expect(existsSync(join(sub, '.gitignore'))).toBe(false);
  });

  // A linked worktree or a submodule has a `.git` FILE, not a directory, and
  // it is just as much a real working tree.
  it('treats a .git file as a working tree when git cannot run', () => {
    writeFileSync(join(cwd, '.git'), 'gitdir: /elsewhere/.git/worktrees/w\n');
    const result = withoutGitOnPath(() => ensureIgnored(cwd, NAME));
    expect(result).toEqual({ kind: 'no-git', line: NAME });
  });

  /**
   * `check-ignore` does not report a tracked file as ignored, whatever
   * `.gitignore` says. Claiming success here would let the next `git commit
   * -a` publish a freshly written key.
   */
  it('reports still-not-ignored when the file is already tracked', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, NAME), '{}\n');
    gitCommit(cwd, NAME);

    const result = ensureIgnored(cwd, NAME);

    expect(result).toEqual({ kind: 'still-not-ignored', line: NAME });
    expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain(NAME);
  });

  it('does not re-append the entry on a repeat run against a tracked file', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, NAME), '{}\n');
    gitCommit(cwd, NAME);
    expect(ensureIgnored(cwd, NAME).kind).toBe('still-not-ignored');
    const first = readFileSync(join(cwd, '.gitignore'), 'utf8');

    expect(ensureIgnored(cwd, NAME).kind).toBe('still-not-ignored');

    expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toBe(first);
    expect(first.split('\n').filter((l) => l.trim() === NAME)).toHaveLength(1);
  });

  // `rev-parse --is-inside-work-tree` exits 0 while printing `false` here, so
  // reading the status alone left an inert .gitignore inside the git directory
  // and reported an outcome git never confirmed.
  it('reports not-a-repo inside a bare repository', () => {
    gitInit(cwd, ['--bare']);
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'not-a-repo' });
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false);
  });
});
