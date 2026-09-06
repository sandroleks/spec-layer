#!/usr/bin/env node
/**
 * check-landing-live.mjs: fetch the deployed landing site and confirm that the
 * two permanent schema URLs serve the committed bytes and that a missing path
 * returns 404. Exit 1 on any problem. Usage:
 *
 *   node scripts/check-landing-live.mjs                      # spec-layer.com
 *   node scripts/check-landing-live.mjs --base https://speclayer-landing.pages.dev
 *
 * This is the release gate described in apps/landing/README.md, made
 * executable. A passing pages.dev run is not a substitute for the custom
 * domain; run it against both.
 */
import { readFileSync } from 'node:fs';
import { evaluateSchema, evaluateNotFound } from './site/live.mjs';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = (baseIndex === -1 ? 'https://spec-layer.com' : args[baseIndex + 1]).replace(/\/$/, '');

const SCHEMAS = [
  ['/schemas/foundation-context/v5.json', 'apps/landing/schemas/foundation-context/v5.json'],
  ['/schemas/component-context/v5.json', 'apps/landing/schemas/component-context/v5.json'],
];
const MISSING_PATH = '/this-path-must-not-exist-' + Date.now();

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  return { url, status: res.status, contentType: res.headers.get('content-type') || '', body: await res.text() };
}

const problems = [];
for (const [path, committed] of SCHEMAS) {
  const live = await fetchText(base + path);
  problems.push(...evaluateSchema({ ...live, expected: readFileSync(committed, 'utf8') }));
}
const missing = await fetchText(base + MISSING_PATH);
problems.push(...evaluateNotFound({ url: missing.url, status: missing.status }));

if (problems.length > 0) {
  console.error(`Live check against ${base} failed:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`Live check against ${base} passed: both schemas match the committed files and a missing path returns 404.`);
