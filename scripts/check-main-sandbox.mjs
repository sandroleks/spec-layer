#!/usr/bin/env node
/**
 * check-main-sandbox.mjs — fail the build if the plugin's MAIN THREAD bundle
 * references a global the Figma sandbox does not provide.
 *
 * Figma runs a plugin in two realms. `dist/ui.html` is a real browser iframe
 * and has the full DOM and network stack. `dist/main.js` is the plugin sandbox:
 * a bare JS realm carrying the `figma` API, the ECMAScript built-ins, `console`
 * and timers, and nothing else. No DOM, no fetch, no TextEncoder.
 *
 * This guard exists because that distinction is invisible to every other gate.
 * `serializeProse` measured a byte budget with `new TextEncoder()`, which is a
 * browser/Node global. It typechecked, it linted, and it passed 1269 tests,
 * because vitest runs in Node where TextEncoder IS defined. It failed on the
 * first real Figma run with "'TextEncoder' is not defined", after the whole
 * feature had been reviewed and signed off. Tests that exercise main-thread
 * code in Node are testing a realm the code never ships to.
 *
 * Matching is deliberately narrow to avoid false positives on a bundled
 * artifact: constructor globals are matched only as `new X(`, and
 * namespace globals only as `X.` or `X(`. That catches real use while ignoring
 * the same word appearing in a comment or a string literal.
 *
 * The bundle is minified since 2026-09; minifiers rename locals, never
 * globals, and they drop the parentheses on a zero-argument `new`, so
 * constructors are matched as `new X` followed by a word boundary rather
 * than `new X(`.
 *
 * Portable: plain Node, no shell pipeline, no `grep -P`.
 */
import { readFileSync, existsSync } from 'node:fs';

const DEFAULT_BUNDLE = 'packages/plugin/dist/main.js';

/** Globals that exist in a browser or in Node but NOT in the Figma sandbox. */
const CONSTRUCTORS = [
  'TextEncoder', 'TextDecoder', 'Blob', 'File', 'FileReader',
  'DOMParser', 'XMLHttpRequest', 'WebSocket', 'Worker', 'Image',
];
const NAMESPACES = [
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage',
  'indexedDB', 'location', 'history',
];
const CALLS = ['fetch', 'atob', 'btoa', 'structuredClone', 'requestAnimationFrame'];

function record(offenders, src, name, pattern) {
  const hits = src.match(pattern);
  if (hits) offenders.push({ name, count: hits.length });
}

/**
 * Scan bundle source text for references to globals the Figma sandbox does
 * not provide. Returns a list of `{ name, count }` offenders (empty when clean).
 */
export function scanSandboxBundle(src) {
  const offenders = [];
  for (const name of CONSTRUCTORS) record(offenders, src, name, new RegExp(`\\bnew\\s+${name}\\b`, 'g'));
  // A leading (?<![.\w]) keeps `foo.document` and `myWindow` from matching.
  for (const name of NAMESPACES) record(offenders, src, name, new RegExp(`(?<![.\\w])${name}\\s*[.(]`, 'g'));
  for (const name of CALLS) record(offenders, src, name, new RegExp(`(?<![.\\w])${name}\\s*\\(`, 'g'));
  return offenders;
}

function main(bundlePath = DEFAULT_BUNDLE) {
  if (!existsSync(bundlePath)) {
    console.error(`${bundlePath} not found. Run the plugin build before this check.`);
    process.exit(1);
  }

  const src = readFileSync(bundlePath, 'utf8');
  const offenders = scanSandboxBundle(src);

  if (offenders.length > 0) {
    console.error(`The plugin main-thread bundle (${bundlePath}) references globals the`);
    console.error('Figma sandbox does not provide:\n');
    for (const { name, count } of offenders) {
      console.error(`  ${name}  (${count} reference${count === 1 ? '' : 's'})`);
    }
    console.error(
      '\nThe main thread has the figma API and the ECMAScript built-ins, nothing'
      + '\nmore. Node and the browser both provide these, so tests and typecheck'
      + '\nwill not catch it. Either move the work to the UI iframe, or implement'
      + '\nit against the built-ins (see utf8ByteLength in src/docLink.ts).',
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2]);
}
