import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export type IgnoreResult =
  | { kind: 'already' }
  | { kind: 'added' }
  | { kind: 'created' }
  | { kind: 'not-a-repo' }
  | { kind: 'refused'; line: string }
  | { kind: 'no-git'; line: string };

const COMMENT = '# Spec Layer pull key, not for committing';

/**
 * Quiet, never-throwing git call.
 *
 * `{ ranGit: false }` means the `git` binary itself could not be run (missing
 * from PATH, spawn failure). That is distinct from git running and reporting
 * a nonzero exit, which is a real answer (e.g. "not a working tree").
 * Conflating the two would let a missing git binary pass silently as "not a
 * repository" even inside a real working tree, which is exactly the case
 * where the key must not be written unverified.
 */
function git(cwd: string, args: string[]): { ranGit: true; status: number } | { ranGit: false } {
  const res = spawnSync('git', args, { cwd, stdio: 'ignore' });
  if (res.error || res.status === null) return { ranGit: false };
  return { ranGit: true, status: res.status };
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
 */
export function ensureIgnored(cwd: string, fileName: string): IgnoreResult {
  const inWorkTree = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inWorkTree.ranGit) {
    // git itself could not run. A `.git` entry means we are sitting inside a
    // working tree we cannot verify or write ignore rules for, so the key
    // must not be written. No `.git` entry means there is genuinely no
    // repository to worry about, same as git reporting that itself.
    return existsSync(join(cwd, '.git')) ? { kind: 'no-git', line: fileName } : { kind: 'not-a-repo' };
  }
  if (inWorkTree.status !== 0) return { kind: 'not-a-repo' };

  const checkIgnore = git(cwd, ['check-ignore', '-q', fileName]);
  if (checkIgnore.ranGit && checkIgnore.status === 0) return { kind: 'already' };

  const path = join(cwd, '.gitignore');
  const existed = existsSync(path);
  try {
    if (!existed) {
      writeFileSync(path, `${COMMENT}\n${fileName}\n`);
      return { kind: 'created' };
    }
    const body = readFileSync(path, 'utf8');
    const lead = body.length === 0 || body.endsWith('\n') ? '' : '\n';
    writeFileSync(path, `${body}${lead}${COMMENT}\n${fileName}\n`);
    return { kind: 'added' };
  } catch {
    return { kind: 'refused', line: fileName };
  }
}
