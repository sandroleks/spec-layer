import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';

export type IgnoreResult =
  | { kind: 'already' }
  | { kind: 'added' }
  | { kind: 'created' }
  | { kind: 'not-a-repo' }
  | { kind: 'refused'; line: string }
  | { kind: 'no-git'; line: string }
  | { kind: 'still-not-ignored'; line: string };

const COMMENT = '# Spec Layer pull key, not for committing';

/**
 * Quiet, never-throwing git call, with stdout captured.
 *
 * `{ ranGit: false }` means the `git` binary itself could not be run (missing
 * from PATH, spawn failure). That is distinct from git running and reporting
 * a nonzero exit, which is a real answer (e.g. "not a working tree").
 * Conflating the two would let a missing git binary pass silently as "not a
 * repository" even inside a real working tree, which is exactly the case
 * where the key must not be written unverified.
 *
 * stdout matters because some git answers live there rather than in the exit
 * status: `rev-parse --is-inside-work-tree` exits 0 while printing `false`
 * inside a bare repository's git directory.
 */
function git(
  cwd: string, args: string[],
): { ranGit: true; status: number; stdout: string } | { ranGit: false } {
  const res = spawnSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  if (res.error || res.status === null) return { ranGit: false };
  return { ranGit: true, status: res.status, stdout: res.stdout ?? '' };
}

/**
 * True when `cwd` or any ancestor holds a `.git` entry.
 *
 * Only used when git could not be run, so this cannot ask git itself. Plain
 * `node:fs` keeps the CLI dependency-free. `existsSync` deliberately covers a
 * `.git` file as well as a directory: linked worktrees and submodules use a
 * file holding a `gitdir:` pointer, and those are real working trees.
 *
 * Checking only `cwd` was the bug: running the pasted setup command from a
 * package subdirectory of a monorepo found no `.git` there and concluded there
 * was no repository, then wrote a plaintext key inside a real working tree.
 */
function insideWorkTreeWithoutGit(cwd: string): boolean {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Whether `.gitignore` already carries this exact entry as its own line. */
function hasEntryLine(body: string, fileName: string): boolean {
  return body.split('\n').some((line) => line.trim() === fileName);
}

/**
 * Make sure git ignores `fileName` in `cwd` before a secret is written there.
 *
 * Whether it is already ignored is git's answer, not a string match, so a
 * global ignore file, a broader pattern such as `*.local.json`, or a line
 * already present all count and a repeat run appends nothing.
 *
 * `.gitignore` in `cwd` rather than at `git rev-parse --show-toplevel`: git
 * honours a nested ignore file for its own directory, and that avoids guessing
 * wrong in a monorepo.
 *
 * Every success is confirmed by git after the write, not assumed from it:
 * `check-ignore` does not report a *tracked* file as ignored no matter what
 * `.gitignore` says, so appending the entry is not on its own proof that the
 * file will stay out of a commit.
 */
export function ensureIgnored(cwd: string, fileName: string): IgnoreResult {
  const inWorkTree = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inWorkTree.ranGit) {
    // git itself could not run. A `.git` entry here or above means we are
    // sitting inside a working tree we cannot verify or write ignore rules
    // for, so the key must not be written. No `.git` entry anywhere up to the
    // root means there is genuinely no repository to worry about, same as git
    // reporting that itself.
    return insideWorkTreeWithoutGit(cwd) ? { kind: 'no-git', line: fileName } : { kind: 'not-a-repo' };
  }
  // Inside a bare repository's git directory this command exits 0 and prints
  // `false`, so the status alone would have us create an inert `.gitignore`
  // there and report an outcome git never confirmed.
  if (inWorkTree.status !== 0 || inWorkTree.stdout.trim() !== 'true') return { kind: 'not-a-repo' };

  const checkIgnore = git(cwd, ['check-ignore', '-q', fileName]);
  if (checkIgnore.ranGit && checkIgnore.status === 0) return { kind: 'already' };

  const path = join(cwd, '.gitignore');
  const existed = existsSync(path);
  try {
    if (!existed) {
      writeFileSync(path, `${COMMENT}\n${fileName}\n`);
    } else {
      const body = readFileSync(path, 'utf8');
      // The entry can be present while git still does not ignore the file,
      // most often because it is already tracked. Appending a duplicate every
      // run would not help, so write only when the line is missing and let the
      // recheck below decide whether the outcome is honest.
      if (!hasEntryLine(body, fileName)) {
        const lead = body.length === 0 || body.endsWith('\n') ? '' : '\n';
        writeFileSync(path, `${body}${lead}${COMMENT}\n${fileName}\n`);
      }
    }
  } catch {
    return { kind: 'refused', line: fileName };
  }

  const recheck = git(cwd, ['check-ignore', '-q', fileName]);
  if (!recheck.ranGit || recheck.status !== 0) return { kind: 'still-not-ignored', line: fileName };
  return existed ? { kind: 'added' } : { kind: 'created' };
}
