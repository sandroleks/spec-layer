import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const brand = new URL('../../../packages/brand/', import.meta.url);
const text = path => readFile(path, 'utf8');
const tokens = JSON.parse(await text(new URL('src/tokens.json', brand)));
assert.equal(await text(resolve(root, 'brand/tokens.css')), await text(new URL('dist/tokens.css', brand)), 'Website palette differs from the shared build');
const sharedAssets = [
  ['logo.svg', 'logo.svg'], ['Manrope-OFL.txt', 'fonts/OFL.txt'],
  ...[400, 500, 600, 700].map(weight => [`manrope-${weight}.ttf`, `fonts/manrope-${weight}.ttf`]),
];
for (const [source, destination] of sharedAssets) {
  assert.deepEqual(await readFile(resolve(root, destination)), await readFile(new URL(`assets/${source}`, brand)), `Shared asset drift: ${destination}`);
}
assert.doesNotMatch(await text(resolve(root, 'logo.svg')), /<animate\b|@keyframes/i, 'The shared brand symbol is static');

// Walk CSS imports and font URLs as well as HTML links. A missing transitive
// token stylesheet can leave a page entirely unstyled while its HTML passes.
const visited = new Set();
async function inspectCss(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const css = await text(path);
  assert.doesNotMatch(css, /--brand-size-(?:body|control):/, 'Plugin density must not be imported by the website');
  const references = [...css.matchAll(/@import\s+["']([^"']+)["']|url\(["']?([^\s"')]+)["']?\)/g)];
  for (const match of references) {
    const url = match[1] || match[2];
    assert.doesNotMatch(url, /^(?:https?:)?\/\//, 'Brand assets must be self-hosted');
    if (url.startsWith('data:')) continue;
    const target = resolve(url.startsWith('/') ? root : dirname(path), url.replace(/^\//, '').split(/[?#]/)[0]);
    assert.ok(target.startsWith(root + '/'), `Asset escapes output: ${url}`);
    await access(target);
    if (target.endsWith('.css')) await inspectCss(target);
  }
}
await inspectCss(resolve(root, 'styles.bundle.css'));
assert.ok((await text(resolve(root, 'styles.bundle.css'))).includes(await text(resolve(root, 'brand/tokens.css'))), 'Bundled CSS must contain the exact shared palette');
await inspectCss(resolve(root, 'docs.css'));
assert.doesNotMatch(await text(resolve(root, 'styles.bundle.css')), /@import\s/, 'Bundled styles must not create import waterfalls');
async function checkHeads(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = resolve(path, entry.name);
    if (entry.isDirectory()) await checkHeads(file);
    else if (entry.name.endsWith('.html')) {
      const html = await text(file);
      const colors = [...html.matchAll(/<meta name="theme-color" content="([^"]+)">/g)];
      assert.deepEqual(colors.map(match => match[1]), [tokens.themes.dark.canvas], `Theme metadata drift: ${relative(root, file)}`);
    }
  }
}
await checkHeads(root);
console.log('Checked shared palette, 6 identity/font assets, transitive CSS/font URLs, website density separation, and theme metadata.');
