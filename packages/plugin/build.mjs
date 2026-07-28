// Run: node build.mjs
// Builds the Figma plugin artefacts into dist/:
//   - dist/main.js   (IIFE bundle for the plugin main thread)
//   - dist/ui.html   (HTML doc embedding the UI iframe bundle, or placeholder)

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, 'dist');
mkdirSync(dist, { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const define = { __PLUGIN_VERSION__: JSON.stringify(pkg.version) };

// ---------------------------------------------------------------------------
// Build 1: main thread → dist/main.js (IIFE, bundled)
// ---------------------------------------------------------------------------
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/main.ts')],
  outfile: resolve(dist, 'main.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2017',
  define,
});
console.log('Built dist/main.js');

// ---------------------------------------------------------------------------
// Build 2: UI iframe → dist/ui.html
//   If src/ui/ui.ts exists: bundle it and embed in a minimal HTML document.
//   Otherwise: write a placeholder HTML so the manifest reference is valid.
// ---------------------------------------------------------------------------
const uiEntry = resolve(__dirname, 'src/ui/ui.ts');

// The design system is embedded from disk rather than imported through the
// TypeScript graph, so src/ui/design-system/*.css stays the single source and
// no second copy can drift. Order is the documented cascade: tokens define the
// roles, components consume them, patterns compose components.
const designSystemCss = ['tokens.css', 'components.css', 'patterns.css']
  .map((file) => readFileSync(resolve(__dirname, 'src/ui/design-system', file), 'utf-8'))
  .join('\n');

if (existsSync(uiEntry)) {
  const result = await esbuild.build({
    entryPoints: [uiEntry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2017',
    write: false, // capture output in memory
    define,
  });
  const js = result.outputFiles[0].text;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Spec Layer</title>
<style>${designSystemCss}</style>
</head>
<body>
<script>${js}</script>
</body>
</html>`;
  writeFileSync(resolve(dist, 'ui.html'), html, 'utf-8');
  console.log('Built dist/ui.html (from src/ui/ui.ts)');
} else {
  const placeholder = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Spec Layer</title></head>
<body>
<div id="root">Spec Layer UI (build pending)</div>
</body>
</html>`;
  writeFileSync(resolve(dist, 'ui.html'), placeholder, 'utf-8');
  console.log('Built dist/ui.html (placeholder — src/ui/ui.ts not found)');
}
