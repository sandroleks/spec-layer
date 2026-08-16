#!/usr/bin/env node
/**
 * check-nul-bytes.mjs — fail the build if a raw NUL (0x00) byte reaches
 * tracked source.
 *
 * During the copy-for-ai branch a raw NUL byte reached committed source in
 * brief.ts. It compiled, passed 1240 tests, passed `check:ci`, AND passed
 * `git diff` review: the NUL sat past git's ~8000-byte binary-detection
 * window, so git never flagged the file as binary, and `grep` (without -P,
 * which macOS grep does not support) silently returned nothing on the file
 * that defined the function. Nothing in the toolchain caught it.
 *
 * Scope is deliberately narrow: git-tracked files under the npm workspaces
 * (`packages/`) and this repo's own tooling (`scripts/`), plus the root
 * `package.json`, whose extension marks them as source/text. That is
 * "tracked source" in the sense the bug actually occurred in: code that
 * compiles, is tested, and is reviewed via `git diff`. It deliberately
 * excludes `docs/`, `apps/`, and other prose/asset trees, and extensions are
 * an allowlist rather than a blacklist: the repo also tracks legitimate
 * binary assets (png, jpg, mp4) that contain NUL bytes as a normal part of
 * their format, and those must never be scanned regardless of location.
 *
 * Portable on macOS (BSD) and Linux: no shell pipeline, no `grep -P`. Plain
 * Node reading each tracked file's bytes directly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.html', '.yml', '.yaml',
]);

const SOURCE_ROOTS = ['packages/', 'scripts/'];
const SOURCE_FILES = new Set(['package.json']);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function hasTextExtension(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function inScope(path) {
  if (SOURCE_FILES.has(path)) return true;
  return SOURCE_ROOTS.some((root) => path.startsWith(root));
}

const offenders = [];
for (const file of trackedFiles()) {
  if (!inScope(file) || !hasTextExtension(file)) continue;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    // Listed by git but unreadable (e.g. deleted in a dirty working tree).
    // Not this script's concern.
    continue;
  }
  if (buf.includes(0)) offenders.push(file);
}

if (offenders.length > 0) {
  console.error('Found raw NUL (0x00) bytes in tracked source files:');
  for (const file of offenders) console.error(`  ${file}`);
  console.error(
    "\nA NUL byte can sit past git's binary-detection window and pass `grep` "
    + 'silently. Remove it before committing.',
  );
  process.exit(1);
}
