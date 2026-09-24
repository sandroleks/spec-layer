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
 * So this runs the actual artifact three ways: with no arguments (the usage
 * banner, which proves the module graph evaluated), `tools --json` (a command
 * path and the version read from disk), and `show component` against a
 * synthetic bundle in a scratch directory (the local-read path through the
 * inlined bundle parser). None needs a network, a key, or repository state.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const BUNDLE = 'packages/cli/dist/cli.js';
const BANNER = 'spec-layer <command>';

if (!existsSync(BUNDLE)) {
  console.error(`${BUNDLE} not found. Run the CLI build before this check.`);
  process.exit(1);
}

const LICENSE = 'packages/cli/LICENSE';
if (!existsSync(LICENSE)) {
  console.error(`${LICENSE} not found. packages/cli/build.mjs copies the root LICENSE there so npm ships it; run the CLI build.`);
  process.exit(1);
}

const bundlePath = resolve(BUNDLE);
const pkg = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'));

function fail(title, run, lines) {
  console.error(`The CLI bundle (${BUNDLE}) does not run: ${title}\n`);
  console.error(`Got exit code ${run.status}${run.signal ? ` (signal ${run.signal})` : ''}:\n`);
  console.error(`${run.stdout ?? ''}${run.stderr ?? ''}`.trim() || '(no output)');
  for (const line of lines) console.error(line);
  process.exit(1);
}

// 1. No arguments: the usage banner. Reaching it proves the module graph
//    evaluated, which is the failure that shipped 0.2.0 dead.
const banner = spawnSync(process.execPath, [bundlePath], { encoding: 'utf8' });
if (!`${banner.stdout ?? ''}${banner.stderr ?? ''}`.includes(BANNER)) {
  fail('the usage banner did not print on a no-argument run.', banner, [
    '',
    'The bundle is ESM. A CommonJS dependency that calls require() as it',
    'evaluates will throw on import unless packages/cli/build.mjs gives the',
    'bundle a real require via node:module createRequire.',
  ]);
}

// 2. and 3. run in a scratch directory so nothing touches the repository.
const scratch = mkdtempSync(join(tmpdir(), 'sl-bundle-check-'));
try {
  // 2. `tools --json`: a command path, JSON on stdout, the package version read
  //    from disk by version.ts.
  const tools = spawnSync(process.execPath, [bundlePath, 'tools', '--json'], { cwd: scratch, encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(tools.stdout); } catch { parsed = null; }
  if (tools.status !== 0 || !parsed || parsed.cli !== 'spec-layer' || parsed.version !== pkg.version
    || !Array.isArray(parsed.tools) || !parsed.tools.some((t) => t.name === 'pull')) {
    fail(`\`tools --json\` did not print the catalogue for version ${pkg.version}.`, tools, []);
  }

  // 3. `show component Button` against a synthetic bundle: readLocalBundle,
  //    the inlined bundle parser, and the exact-bytes stdout path.
  const ai = 'spec_layer:\n  kind: component\nname: Button\n';
  const bundle = {
    schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'Smoke',
    pluginVersion: null, extractorVersion: '3', foundation: null,
    components: [{ name: 'Button', ai, artifact: { spec_layer: { export: { content_hash: '0'.repeat(64) } } } }],
  };
  mkdirSync(join(scratch, '.speclayer'));
  writeFileSync(join(scratch, '.speclayer', 'bundle.json'), JSON.stringify(bundle));
  const show = spawnSync(process.execPath, [bundlePath, 'show', 'component', 'Button'], { cwd: scratch, encoding: 'utf8' });
  if (show.status !== 0 || show.stdout !== ai) {
    fail('`show component Button` did not print the brief byte for byte.', show, [
      '',
      `Expected stdout: ${JSON.stringify(ai)}`,
    ]);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`CLI bundle ok: banner, tools --json (${pkg.version}), show component.`);
