import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pages, pageUrl } from '../docs.config.mjs';
import { infoPages, infoPageUrl } from '../pages.config.mjs';
import { site } from '../site.config.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const origin = 'https://local.spec-layer.test';
const htmlCache = new Map();
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes:true });
  const results = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
  return results.flat();
}
async function htmlAt(path) {
  if (!htmlCache.has(path)) htmlCache.set(path, await readFile(path, 'utf8'));
  return htmlCache.get(path);
}
async function checkLink(value, from) {
  const url = new URL(value.replaceAll('&amp;', '&'), `${origin}/${relative(dist, from)}`);
  if (url.origin !== origin && url.origin !== site.origin) return;
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  if (infoPages.some(page => infoPageUrl(page) === path)) path += '.html';
  const target = resolve(dist, '.' + path);
  assert.ok(target.startsWith(dist + '/'), `Path escapes output: ${value}`);
  await access(target).catch(() => { throw new Error(`Missing local link ${value} in ${relative(dist, from)}`); });
  if (url.hash && path.endsWith('.html')) {
    const id = decodeURIComponent(url.hash.slice(1));
    const ids = [...(await htmlAt(target)).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.ok(ids.includes(id), `Missing anchor ${value} in ${relative(dist, from)}`);
  }
}
const files = await walk(dist);
for (const path of files.filter(path => path.endsWith('.html'))) {
  const html = await htmlAt(path);
  assert.equal((html.match(/<main\b/g) || []).length, 1, `One main landmark: ${path}`);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `One primary heading: ${path}`);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /name="description" content="[^"]+"/);
  assert.ok(!/\{\{\w/.test(html), `Unresolved content placeholder: ${path}`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `Duplicate ids: ${path}`);
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) await checkLink(match[1], path);
}
// Gallery destinations only appear after interaction; validate them with the HTML
// links. `closeup` is the href of #full-image and #gallery-link and the srcset of
// #gallery-closeup, so it is a real click destination and not only an <img> source.
const app = await readFile(join(dist, 'app.js'), 'utf8');
for (const match of app.matchAll(/\b(?:src|closeup):\s*'([^']+)'/g)) {
  await checkLink(match[1], join(dist, 'index.html'));
}
assert.equal(new Set(pages.map(page => page.slug)).size, pages.length, 'Documentation slugs must be unique');
for (const page of pages) {
  const html = await htmlAt(join(dist, 'docs', `${page.slug}.html`));
  assert.ok(html.includes(`href="${pageUrl(page)}" aria-current="page"`), `Active page missing: ${page.slug}`);
  for (const target of pages) assert.ok(html.includes(`href="${pageUrl(target)}"`), `Missing navigation from ${page.slug} to ${target.slug}`);
}
for (const kind of ['component', 'foundation']) {
  const schemaPath = join(dist, 'schemas', `${kind}-context`, 'v5.json');
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  assert.equal(schema.$id, `https://spec-layer.com/schemas/${kind}-context/v5.json`);
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  const source = resolve(root, '../../packages/extractor/src/v5/schema', `${kind}-5.1.0.json`);
  try { await access(source); } catch { continue; }
  assert.equal(await readFile(schemaPath, 'utf8'), await readFile(source, 'utf8'), `Schema copy drifted: ${kind}`);
}
const sampleDir = join(dist, 'examples/foundation');
for (const path of files.filter(path => path.startsWith(sampleDir) && path.endsWith('.json'))) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  function refs(value) {
    if (!value || typeof value !== 'object') return [];
    return [...(typeof value.$ref === 'string' ? [value.$ref] : []), ...Object.values(value).flatMap(refs)];
  }
  for (const ref of refs(data)) {
    if (/^[a-z]+:/.test(ref) || ref.startsWith('#')) continue;
    await access(join(sampleDir, ref.split('#')[0]));
  }
}
console.log(`Checked ${htmlCache.size} HTML routes, documentation navigation, local links and anchors, schema copies, and example references.`);
