import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { infoPages, infoPageUrl } from '../pages.config.mjs';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('content/source-pages/manifest.json', root), 'utf8'));
for (const page of infoPages) {
  const record = manifest.find(record => record.slug === page.slug);
  assert.ok(record?.liveTextAndLinksMatch, `Missing published-source reconciliation for ${page.slug}`);
  const source = await readFile(new URL(`content/source-pages/${page.slug}.html`, root), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), record.authoredSource.sha256, `Source changed without reconciliation: ${page.slug}`);
  let expected = source.match(/<main>\s*<div class="wrap">([\s\S]*?)<\/div>\s*<\/main>/)[1].trim();
  for (const target of infoPages) expected = expected.replaceAll(`href="${target.slug}.html"`, `href="${infoPageUrl(target)}"`);
  const output = await readFile(new URL(`dist/${page.slug}.html`, root), 'utf8');
  const actual = output.match(/<!-- preserved-content:start -->\n([\s\S]*?)\n<!-- preserved-content:end -->/)[1];
  assert.equal(actual, expected, `Published content changed in ${page.slug}`);
  for (const target of infoPages) assert.ok(output.includes(`href="${infoPageUrl(target)}"`));
  assert.ok(output.includes(`href="${infoPageUrl(page)}" aria-current="page"`));
}
console.log(`Checked exact published content preservation and navigation for ${infoPages.length} support/policy pages.`);
