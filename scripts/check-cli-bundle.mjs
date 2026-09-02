#!/usr/bin/env node
/**
 * check-cli-bundle.mjs — fail the build if the published CLI bundle cannot be
 * loaded by Node.
 *
 * `build:cli` proves only that esbuild produced a file. It does not prove the
 * file runs, and the CLI ships to npm as an ESM bundle, a realm no other gate
 * exercises. `spec-layer@0.2.0` shipped dead for exactly this reason: adopting
 * the shared extractor parser pulled in `js-sha256`, a CommonJS module that
 * calls `require('crypto')` while it evaluates, esbuild rewrote that call into
 * a shim that throws in ESM output, and every command died on import with
 * "Dynamic require of 'crypto' is not supported". Lint, typecheck, the whole
 * test suite and the build itself all passed, because vitest imports the
 * TypeScript sources directly and never touches the bundle.
 *
 * So this runs the actual artifact. Invoked with no arguments the CLI prints
 * its usage banner and exits 1, which needs no network, no key and no
 * filesystem state, and reaching it proves the module graph evaluated.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BUNDLE = 'packages/cli/dist/cli.js';
const BANNER = 'spec-layer <command>';

if (!existsSync(BUNDLE)) {
  console.error(`${BUNDLE} not found. Run the CLI build before this check.`);
  process.exit(1);
}

const run = spawnSync(process.execPath, [BUNDLE], { encoding: 'utf8' });
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (!output.includes(BANNER)) {
  console.error(`The CLI bundle (${BUNDLE}) does not run.\n`);
  console.error(`Expected the usage banner ("${BANNER}") on a no-argument run.`);
  console.error(`Got exit code ${run.status}${run.signal ? ` (signal ${run.signal})` : ''}:\n`);
  console.error(output.trim() || '(no output)');
  console.error(
    '\nThe bundle is ESM. A CommonJS dependency that calls require() as it'
    + '\nevaluates will throw on import unless packages/cli/build.mjs gives the'
    + '\nbundle a real require via node:module createRequire.',
  );
  process.exit(1);
}
