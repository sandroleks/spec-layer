import { build } from 'esbuild';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// The output is ESM, but `@spec-layer/extractor` pulls in js-sha256, a CommonJS
// module that calls require('crypto') and require('buffer') while it evaluates
// (its Node fast path). esbuild rewrites those into a shim that throws in ESM
// output, so without a real `require` in scope every command dies on import
// with "Dynamic require of 'crypto' is not supported". Defining `require`
// ahead of esbuild's own helpers satisfies the shim's `typeof require` probe.
// scripts/check-cli-bundle.mjs runs the built artifact to keep this honest.
const BANNER = `#!/usr/bin/env node
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);`;

// fileURLToPath (not URL#pathname) because pathname percent-encodes spaces,
// and this repo's absolute path contains them ("Design System Docs"), which
// otherwise breaks entry-point resolution below.
await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: BANNER },
  outfile: 'dist/cli.js',
  absWorkingDir: dirname(fileURLToPath(import.meta.url)),
});
