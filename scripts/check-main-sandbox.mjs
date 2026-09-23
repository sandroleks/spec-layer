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
 * namespace globals only as `X.` or `X(`. That skips the bare word in prose,
 * but it does not understand strings or comments: a string literal or comment
 * containing `document.title` or `fetch(` still matches. The bundle test in
 * scripts/check-main-sandbox.test.ts is what shows the shipped bundle has none.
 *
 * The bundle is minified since 2026-09; minifiers rename locals, never
 * globals, and they drop the parentheses on a zero-argument `new`, so
 * constructors are matched as `new X` followed by a word boundary rather
 * than `new X(`.
 *
 * Portable: plain Node, no shell pipeline, no `grep -P`.
 *
 * Since 2026-09-23 the lists also carry the WHATWG URL, fetch and abort
 * classes, `crypto`, `performance` and `self`, the two extra scheduler calls,
 * a bare-identifier pass for a global used as a value, and a pass for a listed
 * name reached through `globalThis`, `self` or `window`. `globalThis` itself
 * is standard ES2020 and is not an offence.
 * The shapes that pass are pinned in scripts/check-main-sandbox.test.ts.
 */
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const DEFAULT_BUNDLE = 'packages/plugin/dist/main.js';

/** Globals that exist in a browser or in Node but NOT in the Figma sandbox. */
const CONSTRUCTORS = [
  'TextEncoder', 'TextDecoder', 'Blob', 'File', 'FileReader',
  'DOMParser', 'XMLHttpRequest', 'WebSocket', 'Worker', 'Image',
  'URL', 'URLSearchParams', 'AbortController', 'Headers', 'Request', 'Response',
];
const NAMESPACES = [
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage',
  'indexedDB', 'location', 'history',
  'crypto', 'performance', 'self',
];
const CALLS = [
  'fetch', 'atob', 'btoa', 'structuredClone', 'requestAnimationFrame',
  'setImmediate', 'queueMicrotask',
];

/**
 * A global used as a value rather than called or constructed: aliased
 * (`const f = fetch;`), passed along (`parts.map(atob)`), returned
 * (`return fetch`). The identifier has to sit in an expression position, so a
 * property (`obj.fetch`), an object key (`{ fetch: 1 }`), a `typeof` guard and
 * a longer identifier (`fetchAll`) do not match. A string literal could still
 * match if the word sits between these delimiters; the bundle test in
 * scripts/check-main-sandbox.test.ts is what keeps that honest.
 */
const bare = (name) => new RegExp(`(?<=(?:[=(,\\[?:!&|]|\\breturn)\\s*)${name}(?=\\s*[,;)\\]}])`, 'g');

/**
 * A forbidden global reached through a global object: `globalThis.fetch(u)`,
 * `window.atob(s)`. `globalThis` itself is ES2020 and exists in the sandbox,
 * so `globalThis.figma`, `globalThis.Symbol` and a `typeof globalThis` guard
 * pass; only a name from the lists above after the dot is an offence.
 */
const viaGlobal = (name) => new RegExp(`(?<![.\\w$])(?:globalThis|self|window)\\s*\\.\\s*${name}\\b`, 'g');

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
  // A leading (?<![.\w$]) keeps `foo.document`, `myWindow` and `$self` from matching.
  for (const name of NAMESPACES) record(offenders, src, name, new RegExp(`(?<![.\\w$])${name}\\s*[.(]`, 'g'));
  for (const name of CALLS) record(offenders, src, name, new RegExp(`(?<![.\\w$])${name}\\s*\\(`, 'g'));
  for (const name of [...CONSTRUCTORS, ...CALLS]) record(offenders, src, name, bare(name));
  for (const name of [...CONSTRUCTORS, ...CALLS, ...NAMESPACES]) record(offenders, src, name, viaGlobal(name));
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
      '\nEach of these is either absent from the main thread or kept out of it on'
      + '\npurpose: DOM and network work belong in the UI iframe. Node and the'
      + '\nbrowser both provide them, so tests and typecheck will not catch it.'
      + '\nEither move the work to the UI iframe, or implement it against the'
      + '\nECMAScript built-ins (see utf8ByteLength in src/docLink.ts).',
    );
    process.exit(1);
  }
}

// Compare URL to URL. The previous string form (`file://` + argv[1]) never
// matched on a checkout whose path has a space, because import.meta.url is
// percent-encoded, so the gate exited 0 without scanning. Same form as
// packages/brand/build.mjs.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv[2]);
}
