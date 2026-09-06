import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pages, pageUrl } from '../docs.config.mjs';
import { infoPages, infoPageUrl } from '../pages.config.mjs';
import { site, absoluteUrl } from '../site.config.mjs';
import { canonicalPaths, redirects } from './seo.mjs';

const dist = new URL('../dist/', import.meta.url);
const read = path => readFile(new URL(path, dist), 'utf8');
const fileFor = path => path === '/' ? 'index.html' : path.replace(/^\//, '') + (path.endsWith('/') ? 'index.html' : infoPages.some(page => infoPageUrl(page) === path) ? '.html' : '');
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
function tagValue(html, key, value) {
  const matches = [...html.matchAll(new RegExp(`<meta ${key}="${value}" content="([^"]*)">`, 'g'))];
  assert.equal(matches.length, 1, `Expected one ${value} tag`);
  return decode(matches[0][1]);
}

const routes = new Map(canonicalPaths.map(path => [fileFor(path), path]));
routes.set('docs.html', '/docs/quickstart/');
for (const page of pages.filter(page => page.slug !== 'index')) routes.set(`docs/${page.slug}.html`, pageUrl(page));
const titles = new Set();
const descriptions = new Set();
for (const [file, canonicalPath] of routes) {
  const html = await read(file);
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head, `Missing head in ${file}`);
  const canonicals = [...head.matchAll(/<link rel="canonical" href="([^"]+)">/g)];
  assert.equal(canonicals.length, 1, `Canonical count in ${file}`);
  assert.equal(canonicals[0][1], absoluteUrl(canonicalPath), `Canonical destination in ${file}`);
  const robots = tagValue(head, 'name', 'robots');
  assert.equal(robots, site.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow');
  const title = decode(head.match(/<title>([^<]+)<\/title>/)[1]);
  const description = tagValue(head, 'name', 'description');
  assert.equal(tagValue(head, 'property', 'og:title'), title);
  assert.equal(tagValue(head, 'property', 'og:description'), description);
  assert.equal(tagValue(head, 'property', 'og:url'), absoluteUrl(canonicalPath));
  assert.equal(tagValue(head, 'property', 'og:type'), 'website');
  assert.equal(tagValue(head, 'property', 'og:site_name'), site.name);
  assert.equal(tagValue(head, 'property', 'og:image'), absoluteUrl(site.image));
  assert.equal(tagValue(head, 'property', 'og:image:alt'), site.imageAlt);
  assert.equal(tagValue(head, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(tagValue(head, 'name', 'twitter:title'), title);
  assert.equal(tagValue(head, 'name', 'twitter:description'), description);
  assert.equal(tagValue(head, 'name', 'twitter:image'), absoluteUrl(site.image));
  const structured = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(structured['@context'], 'https://schema.org');
  const page = structured['@graph'].find(node => node['@type'] === 'WebPage');
  assert.equal(page.url, absoluteUrl(canonicalPath));
  assert.equal(page.name, title);
  const breadcrumb = structured['@graph'].find(node => node['@type'] === 'BreadcrumbList');
  if (canonicalPath !== '/') {
    assert.ok(breadcrumb, `Breadcrumb missing in ${file}`);
    assert.equal(breadcrumb.itemListElement.at(-1).item, absoluteUrl(canonicalPath));
    breadcrumb.itemListElement.forEach((item, index) => {
      assert.equal(item.position, index + 1);
      assert.ok(canonicalPaths.includes(new URL(item.item).pathname));
    });
  }
  if (file === fileFor(canonicalPath)) {
    assert.ok(!titles.has(title), `Duplicate title ${title}`);
    assert.ok(!descriptions.has(description), `Duplicate description ${description}`);
    titles.add(title); descriptions.add(description);
  }
}
const sitemap = await read('sitemap.xml');
assert.match(sitemap, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => decode(match[1]));
assert.deepEqual(locations, canonicalPaths.map(absoluteUrl));
assert.equal(new Set(locations).size, locations.length);
assert.doesNotMatch(sitemap, /<lastmod>|<priority>|<changefreq>/);
const robots = await read('robots.txt');
assert.match(robots, /User-agent: \*\nContent-Signal: search=yes,ai-train=no,use=reference\nAllow: \//);
assert.match(robots, /User-agent: GPTBot\nDisallow: \//);
assert.equal(robots.includes(`Sitemap: ${absoluteUrl('/sitemap.xml')}`), site.indexable);
const headers = await read('_headers');
assert.equal(headers.includes('/*\n  X-Robots-Tag: noindex'), !site.indexable);
const redirectLines = (await read('_redirects')).split('\n').filter(line => line && !line.startsWith('#'));
assert.deepEqual(redirectLines, [...redirects].map(([from, to]) => `${from} ${to} 301`));
for (const [from, to] of redirects) {
  assert.notEqual(from, to);
  assert.ok(!redirects.has(to), `Redirect chain from ${from}`);
  assert.ok(canonicalPaths.includes(to), `Unknown redirect target ${to}`);
  await read(fileFor(to));
}
const quickstart = await read('docs/quickstart/index.html');
for (const id of ['figma', 'copy-for-ai', 'publish-pull', 'commands', 'keys', 'contribute']) {
  assert.ok(quickstart.includes(`id="${id}"`), `Lost legacy quickstart anchor ${id}`);
}
assert.ok((await read('index.html')).includes('id="features"'), 'Lost production homepage features anchor');
const notFound = await read('404.html');
assert.equal(tagValue(notFound, 'name', 'robots'), 'noindex, follow');
assert.doesNotMatch(notFound, /rel="canonical"/);
const png = await readFile(new URL(site.image.slice(1), dist));
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 1200);
assert.equal(png.readUInt32BE(20), 630);
console.log(`Checked SEO metadata, structured data, ${locations.length} canonical URLs, ${redirects.size} redirects, sharing image, and ${site.mode} indexing rules.`);
