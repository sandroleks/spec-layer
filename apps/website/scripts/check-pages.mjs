import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { infoPages, infoPageUrl } from '../pages.config.mjs';
const root = new URL('../', import.meta.url);

// These five pages keep their published URLs and their published wording. The
// generator may rewrite the sibling links and wrap the body in the docs shell;
// it may not touch a word of the legal text. That is what this file proves.
//
// It used to also pin each source file's sha256 against a manifest recording a
// fetch of the live page. That guarded a real 2026-09-06 incident: production
// had drifted AHEAD of the checkout, and deploying apps/landing/ would have
// reverted published disclosures. apps/website is now the only way anything
// reaches production, so the repository is the source by construction and the
// pin had degraded into "these files may not be edited" — an ordinary wording
// change had to add a manifest exception to silence it. Removed with the
// manifest. To check the live site instead, use `npm run check:site-live`.
for (const page of infoPages) {
  const source = await readFile(new URL(`content/source-pages/${page.slug}.html`, root), 'utf8');
  let expected = source.match(/<main>\s*<div class="wrap">([\s\S]*?)<\/div>\s*<\/main>/)[1].trim();
  for (const target of infoPages) expected = expected.replaceAll(`href="${target.slug}.html"`, `href="${infoPageUrl(target)}"`);
  const output = await readFile(new URL(`dist/${page.slug}.html`, root), 'utf8');
  const actual = output.match(/<!-- preserved-content:start -->\n([\s\S]*?)\n<!-- preserved-content:end -->/)[1];
  assert.equal(actual, expected, `Published content changed in ${page.slug}`);
  for (const target of infoPages) assert.ok(output.includes(`href="${infoPageUrl(target)}"`));
  assert.ok(output.includes(`href="${infoPageUrl(page)}" aria-current="page"`));
}
console.log(`Checked verbatim published content and navigation for ${infoPages.length} support/policy pages.`);
