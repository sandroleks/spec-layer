import { build } from 'esbuild';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// fileURLToPath (not URL#pathname) because pathname percent-encodes spaces,
// and this repo's absolute path contains them ("Design System Docs"), which
// otherwise breaks entry-point resolution below.
await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  outfile: 'dist/cli.js',
  absWorkingDir: dirname(fileURLToPath(import.meta.url)),
});
