// Verify delivered responses from a local Pages candidate or the approved public release.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { canonicalPaths, redirects } from './seo.mjs';
import { site } from '../site.config.mjs';
const origin = process.env.WEBSITE_URL || 'http://127.0.0.1:4622';
const results = [];
for (const path of canonicalPaths) {
  const response = await fetch(origin + path, { redirect: 'manual' });
  assert.equal(response.status, 200, path);
  const html = await response.text();
  if (path.startsWith('/docs/')) {
    assert.ok(!html.includes('__cf_email__'), `Code rewritten as an email address: ${path}`);
  }
  assert.ok(html.includes(`rel="canonical" href="https://spec-layer.com${path}"`), path);
  assert.equal(/<meta name="robots" content="[^"]*noindex/.test(html), !site.indexable, path);
  assert.equal(/noindex/.test(response.headers.get('x-robots-tag') || ''), !site.indexable, path);
  results.push({ path, status: response.status, type: response.headers.get('content-type') });
}
for (const [path, target] of redirects) {
  const response = await fetch(origin + path + '?from=legacy', { redirect: 'manual' });
  assert.equal(response.status, 301, path);
  const location = new URL(response.headers.get('location'), origin);
  assert.equal(location.pathname, target, path);
  assert.equal(location.search, '?from=legacy', path);
  results.push({ path, status: response.status, location: location.pathname + location.search });
}
for (const kind of ['component', 'foundation']) {
  const path = `/schemas/${kind}-context/v5.json`;
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL(`../public${path}`, import.meta.url)));
  results.push({ path, status: 200, bytesMatch: true });
}
for (const [path, type] of [['/sitemap.xml', /application\/xml/], ['/robots.txt', /text\/plain/], ['/social/spec-layer.png', /image\/png/], ['/example-button.yaml', /yaml|octet-stream/], ['/examples/validate-context.mjs', /javascript/]]) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), type, path);
  if (path === '/robots.txt') assert.equal((await response.text()).includes('Sitemap: https://spec-layer.com/sitemap.xml'), site.indexable);
  results.push({ path, status: 200, type: response.headers.get('content-type') });
}
for (const path of ['/not-a-page', '/docs/not-a-page/']) {
  const response = await fetch(origin + path, { redirect: 'manual' });
  assert.equal(response.status, 404, path);
  assert.match(await response.text(), /<meta name="robots" content="noindex/);
  results.push({ path, status: response.status, noindex: true });
}
const report = { date: new Date().toISOString(), origin, mode: site.mode, results };
if (origin === site.origin) {
  for (const host of ['http://spec-layer.com', 'http://www.spec-layer.com', 'https://www.spec-layer.com', 'https://speclayer-landing.pages.dev']) {
    for (const path of ['/', '/docs/cli/?audit=1']) {
      const response = await fetch(host + path, { redirect: 'manual' });
      assert.equal(response.status, 301, host + path);
      assert.equal(response.headers.get('location'), site.origin + path, host + path);
      results.push({ url: host + path, status: response.status, location: response.headers.get('location') });
    }
  }
  const robots = await (await fetch(origin + '/robots.txt')).text();
  const expected = await readFile(new URL('../content/robots.production.txt', import.meta.url), 'utf8');
  const groups = text => [...text.matchAll(/^User-agent: .+$/gm)].map(match => match[0]).sort();
  assert.deepEqual(groups(robots), groups(expected), 'Delivered crawler groups must match the preserved policy without duplicates');
  for (const directive of ['Content-Signal: search=yes,ai-train=no,use=reference', 'Allow: /']) assert.ok(robots.includes(directive));
  results.push({ path: '/robots.txt', crawlerPolicyPreserved: true, duplicateGroups: false });
}
if (process.env.HTTP_REPORT) await writeFile(process.env.HTTP_REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(`Verified ${results.length} delivered responses (${site.mode}): canonical pages, redirects, schemas, assets and errors.`);
