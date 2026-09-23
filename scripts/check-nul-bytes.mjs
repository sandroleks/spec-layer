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
 * Scope: every git-tracked file whose extension names a text format, plus the
 * extensionless text files named in EXTENSIONLESS_TEXT. Until 2026-09-23 the
 * scan was limited to packages/, scripts/ and six root documents, which left
 * .github/, the root configs, CONTRIBUTING.md, LICENSE and the hook unscanned.
 * Extensions are an allowlist rather than a blacklist: the repo tracks
 * legitimate binary assets (png, ttf) that contain NUL bytes as a normal part
 * of their format, and those must never be scanned regardless of location.
 *
 * Portable on macOS (BSD) and Linux: no shell pipeline, no `grep -P`. Plain
 * Node reading each tracked file's bytes directly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.html', '.yml', '.yaml',
  '.md', '.mdx', '.toml', '.svg', '.txt',
]);

/**
 * Extensions where a source-level NUL escape (backslash directly followed by
 * the digit zero) is a defect rather than content. Deliberately narrower than
 * TEXT_EXTENSIONS: `patterns.css` contains a CSS Unicode escape for a middle
 * dot that happens to start the same way (backslash, zero, zero, "b7"), and a
 * blanket substring scan would flag that legitimate content forever.
 */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Tracked text files with no extension to judge them by. Anything else
 * extensionless is skipped, so a new one has to be named here to be scanned.
 */
export const EXTENSIONLESS_TEXT = new Set([
  '.githooks/pre-commit', '.github/CODEOWNERS', '.gitignore', 'LICENSE',
]);

function extensionOf(path) {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  // `.gitignore` and `.githooks/pre-commit` have a leading dot, not an extension.
  if (dot <= slash + 1) return '';
  return path.slice(dot).toLowerCase();
}

/** Whether a git-tracked path is text this scan should read. */
export function isScannedPath(path) {
  return TEXT_EXTENSIONS.has(extensionOf(path)) || EXTENSIONLESS_TEXT.has(path);
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

/** The offence in `buf` for a file at `path`, or null when it is clean. */
export function controlOffence(path, buf) {
  const control = firstControlByte(buf);
  if (control !== null) return `raw control byte 0x${control.toString(16).padStart(2, '0')}`;
  if (CODE_EXTENSIONS.has(extensionOf(path)) && buf.toString('utf8').includes(NUL_ESCAPE)) {
    return 'NUL escape in source';
  }
  return null;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function main() {
  const offenders = [];
  let scanned = 0;
  for (const file of trackedFiles()) {
    if (!isScannedPath(file)) continue;
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      // Listed by git but unreadable (e.g. deleted in a dirty working tree).
      // Not this script's concern.
      continue;
    }
    scanned += 1;
    const offence = controlOffence(file, buf);
    if (offence !== null) offenders.push(`${file} (${offence})`);
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

  // One line on success, so a scan that never ran cannot pass for a clean one.
  console.log(`NUL scan: ${scanned} tracked text file${scanned === 1 ? '' : 's'} clean.`);
}

/**
 * The real path of the invoked script, or null when there is none. Node sets
 * import.meta.url to the real path of the entry module, so argv[1] has to be
 * resolved through any symlink before the two can be compared.
 */
function invokedRealPath() {
  if (!process.argv[1]) return null;
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return null;
  }
}

// URL compared to URL, real path to real path, so a checkout path with a
// space or a symlinked script still runs main() instead of exiting 0 silently.
const invoked = invokedRealPath();
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
  main();
}
