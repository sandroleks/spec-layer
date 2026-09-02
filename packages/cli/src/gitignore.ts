import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export type IgnoreResult =
  | { kind: 'already' }
  | { kind: 'added' }
  | { kind: 'created' }
  | { kind: 'not-a-repo' }
  | { kind: 'refused'; line: string };

const COMMENT = '# Spec Layer pull key, not for committing';

/** Quiet, never-throwing git call. `null` means git could not run at all. */
function git(cwd: string, args: string[]): number | null {
  const res = spawnSync('git', args, { cwd, stdio: 'ignore' });
  if (res.error || res.status === null) return null;
  return res.status;
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
  if (git(cwd, ['rev-parse', '--is-inside-work-tree']) !== 0) return { kind: 'not-a-repo' };
  if (git(cwd, ['check-ignore', '-q', fileName]) === 0) return { kind: 'already' };

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
