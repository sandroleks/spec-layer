#!/usr/bin/env node
/**
 * check-nul-bytes.mjs — fail the build if a raw C0 control byte, or a source-
 * level NUL escape (a backslash immediately followed by the digit zero) used
 * as a key separator, reaches tracked source.
 *
 * During the copy-for-ai branch a raw NUL byte reached committed source in
 * brief.ts. It compiled, passed 1240 tests, passed `check:ci`, AND passed
 * `git diff` review: the NUL sat past git's ~8000-byte binary-detection
 * window, so git never flagged the file as binary, and `grep` (without -P,
 * which macOS grep does not support) silently returned nothing on the file
 * that defined the function. Nothing in the toolchain caught it.
 *
 * The brief-resolution-fidelity work found the same class of bug twice more:
 * a raw SOH (0x01) byte used as a key separator in tokens.ts and validate.ts,
 * and a dozen source-level NUL escapes used the same way — neither of which a
 * NUL-only scan catches. Both are widened for here.
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

/**
 * Extensions where a source-level NUL escape (backslash directly followed by
 * the digit zero) is a defect rather than content. Deliberately narrower than
 * TEXT_EXTENSIONS: `patterns.css` contains a CSS Unicode escape for a middle
 * dot that happens to start the same way (backslash, zero, zero, "b7"), and a
 * blanket substring scan would flag that legitimate content forever.
 */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

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

/** C0 controls that are never legitimate in source: everything below 0x20
 *  except tab, line feed and carriage return. NUL is the one that has actually
 *  bitten this repo; SOH reached tokens.ts and validate.ts as a key separator
 *  and passed every check because the scan was NUL-only. */
function firstControlByte(buf) {
  for (const b of buf) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return b;
  }
  return null;
}

// Built from a char code, not written as the literal escape sequence: this
// file is itself a `.mjs` file under CODE_EXTENSIONS, and spelling the two
// characters directly here would put the exact sequence the scan below hunts
// for into this file's own source, so the checker would flag itself on every
// run.
const NUL_ESCAPE = String.fromCharCode(92) + '0';

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
  const control = firstControlByte(buf);
  if (control !== null) {
    offenders.push(`${file} (raw control byte 0x${control.toString(16).padStart(2, '0')})`);
    continue;
  }
  const dot = file.lastIndexOf('.');
  if (CODE_EXTENSIONS.has(file.slice(dot).toLowerCase()) && buf.toString('utf8').includes(NUL_ESCAPE)) {
    offenders.push(`${file} (NUL escape in source)`);
  }
}

if (offenders.length > 0) {
  console.error('Found NUL or other control characters in tracked source files:');
  for (const file of offenders) console.error(`  ${file}`);
  console.error(
    "\nA control byte can sit past git's binary-detection window and pass `grep` "
    + 'silently, and a NUL escape used as a key separator is invisible in a diff. '
    + 'Use JSON.stringify for composite keys instead.',
  );
  process.exit(1);
}
