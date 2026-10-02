#!/usr/bin/env node
/**
 * check-secrets.mjs — fail when a known secret shape reaches the repository.
 *
 * The patterns used to live only in `.githooks/pre-commit`, which made the
 * hook the whole defence: `git commit --no-verify`, a clone that never ran
 * `npm ci`, or a commit made in the GitHub web editor skipped it. The hook now
 * calls this script, and CI calls it too, so there is one list of shapes and
 * a gate nobody can opt out of locally.
 *
 *   node scripts/check-secrets.mjs --staged         # added lines in the index (the hook)
 *   node scripts/check-secrets.mjs --range A B      # added lines in each commit in A..B (CI, pull requests)
 *   node scripts/check-secrets.mjs --tree           # every tracked text file (npm run check)
 *
 * Diff modes read only added lines, so removing a leaked value is never
 * blocked. Tree mode reads files whole, over the same text allowlist as the
 * NUL scan, so binary assets are never matched.
 *
 * A fixture that needs a value of one of these shapes builds it at runtime
 * (`sl_${'a'.repeat(48)}`), so this file and the tests never hold a string
 * the scan itself would reject.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isScannedPath } from './check-nul-bytes.mjs';

/** [label, pattern source]. The source is what a finding names, so keep it stable. */
export const SECRET_PATTERNS = [
  ['Anthropic API key', 'sk-ant-api[0-9A-Za-z_-]{20,}'],
  ['Figma personal access token', 'figd_[0-9A-Za-z_-]{20,}'],
  ['AWS access key', 'AKIA[A-Z0-9]{16}'],
  ['GitHub personal access token (classic)', 'ghp_[A-Za-z0-9]{36}'],
  ['GitHub fine-grained PAT', 'github_pat_[A-Za-z0-9_]{82}'],
  // PULL_KEY_RE in packages/proxy/src/libraries.ts.
  ['Spec Layer pull key', 'sl_[0-9a-f]{48}'],
  ['npm granular access token', 'npm_[A-Za-z0-9]{36}'],
  ['Cloudflare API token pasted as an env assignment', 'CLOUDFLARE_API_TOKEN=[A-Za-z0-9_-]{20,}'],
];

const COMPILED = SECRET_PATTERNS.map(([label, source]) => ({ label, source, re: new RegExp(source) }));

/** Every pattern a line matches, as `{ label, source }`. */
export function matchLine(line) {
  return COMPILED.filter(({ re }) => re.test(line)).map(({ label, source }) => ({ label, source }));
}

/**
 * Findings for the added lines of a unified diff. `+++` file headers are not
 * content; the path they name is carried onto each finding.
 */
export function scanDiff(diff) {
  const findings = [];
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
      continue;
    }
    if (!line.startsWith('+')) continue;
    for (const match of matchLine(line.slice(1))) findings.push({ file, line: line.slice(1), ...match });
  }
  return findings;
}

/** Findings for one file's text, with 1-based line numbers. */
export function scanText(file, text) {
  const findings = [];
  text.split('\n').forEach((line, index) => {
    for (const match of matchLine(line)) findings.push({ file, lineNumber: index + 1, line, ...match });
  });
  return findings;
}

/** Never echo the whole value: enough to find it, not enough to reuse it. */
function redact(line) {
  const trimmed = line.trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 16)}…(${trimmed.length} chars)` : trimmed;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function collect(argv) {
  if (argv[0] === '--staged') return { label: 'staged changes', findings: scanDiff(git(['diff', '--cached', '-U0', '--no-color'])) };
  if (argv[0] === '--range') {
    const [base, head] = [argv[1], argv[2]];
    if (!base || !head) throw new Error('--range needs a base and a head commit');
    // Every commit's own patch, not the net diff: a key added in one commit
    // and deleted in the next is still exposed on the pushed branch. Commits
    // already on the base, and merges of it, are not this change.
    const patches = git(['log', '-p', '-U0', '--no-color', '--no-merges', '--format=', `${base}..${head}`]);
    return { label: `commits from ${base} to ${head}`, findings: scanDiff(patches) };
  }
  if (argv[0] === '--tree') {
    const findings = [];
    let scanned = 0;
    for (const file of git(['ls-files']).split('\n').filter(Boolean)) {
      if (!isScannedPath(file)) continue;
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue; // Listed by git but deleted in a dirty working tree.
      }
      scanned += 1;
      findings.push(...scanText(file, text));
    }
    return { label: `${scanned} tracked text file${scanned === 1 ? '' : 's'}`, findings };
  }
  throw new Error('Usage: check-secrets.mjs --staged | --range <base> <head> | --tree');
}

function main() {
  let result;
  try {
    result = collect(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const { label, findings } = result;
  if (findings.length === 0) {
    // One line on success, so a scan that never ran cannot pass for a clean one.
    console.log(`Secret scan: ${label} clean.`);
    return;
  }
  const bySource = new Map();
  for (const f of findings) bySource.set(f.source, [...(bySource.get(f.source) ?? []), f]);
  for (const [source, group] of bySource) {
    console.error(`ERROR: Possible secret detected in ${label} (pattern: ${source}, ${group[0].label}):`);
    for (const f of group.slice(0, 5)) {
      const where = f.lineNumber ? `${f.file}:${f.lineNumber}` : f.file ?? '(unknown file)';
      console.error(`  ${where}: ${redact(f.line)}`);
    }
  }
  console.error('\nRemove the value and rotate it: a pushed secret is exposed even after it is deleted.');
  console.error('If this is a false positive, build the value at runtime instead of writing it literally.');
  process.exit(1);
}

function invokedRealPath() {
  if (!process.argv[1]) return null;
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return null;
  }
}

const invoked = invokedRealPath();
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
  main();
}
