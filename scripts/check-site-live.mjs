#!/usr/bin/env node
/**
 * check-site-live.mjs: fetch the deployed site and confirm that the two
 * permanent schema URLs serve the committed bytes and that a missing path
 * returns 404. Exit 1 on any problem. Usage:
 *
 *   node scripts/check-site-live.mjs                      # spec-layer.com
 *   node scripts/check-site-live.mjs --base https://speclayer-landing.pages.dev
 *
 * The published schema URL is a permanent contract: an artifact validated
 * against it must stay valid, so the live bytes have to match the committed
 * ones before a release. A passing pages.dev run is not a substitute for the
 * custom domain; run it against both.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluateSchema, evaluateNotFound } from './site/live.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const baseArg = baseIndex === -1 ? 'https://spec-layer.com' : args[baseIndex + 1];
if (!baseArg || baseArg.startsWith('--')) {
  console.error('Usage: node scripts/check-site-live.mjs [--base https://host]');
  process.exit(1);
}
const base = baseArg.replace(/\/$/, '');

// The website that serves these URLs lives outside this repository, so the
// extractor's own schema files are the committed bytes to compare against.
// They are the source the site publishes, not a second copy of it.
const SCHEMAS = [
  ['/schemas/foundation-context/v5.json', 'packages/extractor/src/v5/schema/foundation-5.1.0.json'],
  ['/schemas/component-context/v5.json', 'packages/extractor/src/v5/schema/component-5.2.0.json'],
];
const MISSING_PATH = '/this-path-must-not-exist-' + Date.now();

async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return { url, status: res.status, contentType: res.headers.get('content-type') || '', body: await res.text() };
  } catch (err) {
    const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    return { url, status: 0, contentType: '', body: '', error: `${url}: could not be fetched (${reason})` };
  }
}

const problems = [];
for (const [path, committed] of SCHEMAS) {
  const live = await fetchText(base + path);
  if (live.error) { problems.push(live.error); continue; }
  problems.push(...evaluateSchema({ ...live, expected: readFileSync(resolve(repoRoot, committed), 'utf8') }));
}
const missing = await fetchText(base + MISSING_PATH);
if (missing.error) problems.push(missing.error);
else problems.push(...evaluateNotFound({ url: missing.url, status: missing.status }));

if (problems.length > 0) {
  console.error(`Live check against ${base} failed:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`Live check against ${base} passed: both schemas match the committed files and a missing path returns 404.`);
