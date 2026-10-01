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
  | { kind: 'still-not-ignored'; line: string; tracked: boolean };

const COMMENT = '# Spec Layer pull key, not for committing';

/**
 * Quiet, never-throwing git call, with stdout captured. `{ ranGit: false }`
 * means the binary could not run, which must never pass as "not a repository"
 * inside a real working tree; a nonzero exit is a real answer.
 */
function git(
  cwd: string, args: string[],
): { ranGit: true; status: number; stdout: string } | { ranGit: false } {
  const res = spawnSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  if (res.error || res.status === null) return { ranGit: false };
  return { ranGit: true, status: res.status, stdout: res.stdout ?? '' };
}

/**
 * True when `cwd` or any ancestor holds a `.git` entry; used only when git
 * cannot run. A `.git` file counts (worktrees, submodules). Ancestors matter:
 * setup run from a monorepo package has no `.git` of its own.
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
 * "Already ignored" is git's answer, not a string match, so global ignores and
 * broad patterns count. Writes `.gitignore` in `cwd`, not the toplevel, since
 * git honours nested ignore files. Every success is rechecked by git, because
 * `check-ignore` never reports a tracked file as ignored.
 */
export function ensureIgnored(cwd: string, fileName: string): IgnoreResult {
  const inWorkTree = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inWorkTree.ranGit) {
    // A `.git` here or above means a working tree we cannot verify, so the key
    // must not be written.
    return insideWorkTreeWithoutGit(cwd) ? { kind: 'no-git', line: fileName } : { kind: 'not-a-repo' };
  }
  // Inside a bare repository's git directory this exits 0 but prints `false`.
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
      // The entry can be present while git still does not ignore the file
      // (often it is tracked), so append only when missing; the recheck decides.
      if (!hasEntryLine(body, fileName)) {
        const lead = body.length === 0 || body.endsWith('\n') ? '' : '\n';
        writeFileSync(path, `${body}${lead}${COMMENT}\n${fileName}\n`);
      }
    }
  } catch {
    return { kind: 'refused', line: fileName };
  }

  const recheck = git(cwd, ['check-ignore', '-q', fileName]);
  if (!recheck.ranGit || recheck.status !== 0) {
    // `ls-files --error-unmatch` exits 0 only for a tracked path, so the
    // caller can state the cause git confirmed rather than the likeliest one.
    const tracked = git(cwd, ['ls-files', '--error-unmatch', '--', fileName]);
    return { kind: 'still-not-ignored', line: fileName, tracked: tracked.ranGit && tracked.status === 0 };
  }
  return existed ? { kind: 'added' } : { kind: 'created' };
}
