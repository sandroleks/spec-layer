import { readFile, writeFile } from 'node:fs/promises';
import { infoPages, infoPageUrl } from '../pages.config.mjs';
import { seoHead, escapeHtml } from './seo.mjs';
import { header, footer } from './layout.mjs';
const root = new URL('../', import.meta.url);

export function sourceBody(html) {
  const body = html.match(/<main>\s*<div class="wrap">([\s\S]*?)<\/div>\s*<\/main>/)?.[1];
  if (!body || /<script\b|\son\w+=/i.test(body)) throw new Error('Unexpected support/policy source structure');
  return body.trim();
}
export function localLinks(body) {
  for (const page of infoPages) body = body.replaceAll(`href="${page.slug}.html"`, `href="${infoPageUrl(page)}"`);
  return body;
}
export async function generatePages() {
  for (const page of infoPages) {
    const original = await readFile(new URL(`content/source-pages/${page.slug}.html`, root), 'utf8');
    const body = localLinks(sourceBody(original));
    const nav = infoPages.map(item => `<a href="${infoPageUrl(item)}"${item.slug === page.slug ? ' aria-current="page"' : ''}>${escapeHtml(item.title)}</a>`).join('');
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${seoHead({ title: `${page.title} | Spec Layer`, description: page.description, path: infoPageUrl(page), breadcrumbs: [{ name: page.title, path: infoPageUrl(page) }] })}<link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/docs.css"><script src="/app.js" defer></script></head>
<body class="docs-page info-page">${header()}<div class="container docs-layout info-layout"><aside class="docs-sidebar"><a class="docs-home" href="/">Back to Spec Layer</a><details class="docs-nav-disclosure" open><summary>Help and policies <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14M11 4l6 6-6 6"/></svg></summary><nav aria-label="Help and policies"><div class="docs-nav-group"><strong>Help and policies</strong>${nav}</div></nav></details></aside><main id="main" class="docs-content policy-content"><nav class="docs-breadcrumb" aria-label="Breadcrumb"><a href="/">Spec Layer</a><span aria-hidden="true">/</span><span>${escapeHtml(page.title)}</span></nav><div data-preserved-content>
<!-- preserved-content:start -->
${body}
<!-- preserved-content:end -->
</div></main></div>${footer()}<div id="copy-status" class="copy-status" role="status" aria-live="polite"></div></body></html>\n`;
    await writeFile(new URL(`public/${page.slug}.html`, root), html);
  }
  console.log(`Generated ${infoPages.length} support and policy pages from verified published source.`);
}
