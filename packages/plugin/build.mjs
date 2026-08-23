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

// vNext is the only UI. The old one and its UI_LEGACY rollback flag were
// removed once vNext shipped: both builds wrote the same dist/ui.html, so a
// stray legacy build silently replaced the real UI with an unstyled one and
// looked exactly like a catastrophic regression.
const define = {
  __PLUGIN_VERSION__: JSON.stringify(pkg.version),
};

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
//   If the entry exists: bundle it and embed in a minimal HTML document.
//   Otherwise: write a placeholder HTML so the manifest reference is valid.
// ---------------------------------------------------------------------------
const uiEntry = resolve(__dirname, 'src/ui/ui-vnext.ts');

// The design system is embedded from disk rather than imported through the
// TypeScript graph, so src/ui/design-system/*.css stays the single source and
// no second copy can drift. Order is the documented cascade: tokens define the
// roles, components consume them, patterns compose components.
//
// One value now, not two: with the legacy UI gone there is no build whose
// ui.html should omit the design system, so the CSS is unconditional.
const designSystemCss = ['tokens.css', 'components.css', 'patterns.css']
  .map((file) => readFileSync(resolve(__dirname, 'src/ui/design-system', file), 'utf-8'))
  .join('\n');

const uiHtmlCss = designSystemCss;

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
<style>${uiHtmlCss}</style>
</head>
<body>
<script>${js}</script>
</body>
</html>`;
  writeFileSync(resolve(dist, 'ui.html'), html, 'utf-8');
  console.log('Built dist/ui.html (from src/ui/ui-vnext.ts)');
} else {
  const placeholder = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Spec Layer</title></head>
<body>
<div id="root">Spec Layer UI (build pending)</div>
</body>
</html>`;
  writeFileSync(resolve(dist, 'ui.html'), placeholder, 'utf-8');
  console.log(`Built dist/ui.html (placeholder — ${uiEntry} not found)`);
}

// ---------------------------------------------------------------------------
// Build 3 (opt-in): dev harness → dist/ui-harness.html
//   Renders the vNext shell outside Figma for visual comparison against the
//   archived prototype screenshots. Emitted only under UI_HARNESS=1 and never
//   referenced by manifest.json, so it cannot ship as the plugin's UI.
// ---------------------------------------------------------------------------
if (process.env.UI_HARNESS === '1') {
  const harness = await esbuild.build({
    entryPoints: [resolve(__dirname, 'src/ui/harness.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2017',
    write: false,
    define,
  });
  writeFileSync(resolve(dist, 'ui-harness.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Spec Layer UI harness</title>
<style>${designSystemCss}</style>
<style>html,body{margin:0;width:480px;height:680px;overflow:hidden}</style>
</head>
<body data-theme="dark">
<script>${harness.outputFiles[0].text}</script>
</body>
</html>`, 'utf-8');
  console.log('Built dist/ui-harness.html (dev only)');
}
