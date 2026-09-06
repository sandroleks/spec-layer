import { readFile, writeFile } from 'node:fs/promises';
import { site, absoluteUrl } from '../site.config.mjs';
import { pages, pageUrl } from '../docs.config.mjs';
import { infoPages, infoPageUrl } from '../pages.config.mjs';

const root = new URL('../', import.meta.url);
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
export const canonicalPaths = ['/', ...pages.map(pageUrl), ...infoPages.map(infoPageUrl)];
export const redirects = new Map([
  ['/index.html', '/'], ['/docs', '/docs/'], ['/docs/index.html', '/docs/'],
  ['/docs.html', '/docs/quickstart/'],
  ...pages.filter(page => page.slug !== 'index').flatMap(page => [
    [`/docs/${page.slug}.html`, pageUrl(page)],
    [`/docs/${page.slug}`, pageUrl(page)],
    [`/docs/${page.slug}/index.html`, pageUrl(page)]
  ]),
  ...infoPages.flatMap(page => [[`/${page.slug}.html`, infoPageUrl(page)], [`/${page.slug}/`, infoPageUrl(page)]])
]);

export function seoHead({ title, description, path, breadcrumbs = [], notFound = false }) {
  const canonical = absoluteUrl(path);
  const image = absoluteUrl(site.image);
  const robots = !site.indexable || notFound ? 'noindex, follow' : 'index, follow, max-image-preview:large';
  const graph = [];
  if (!notFound) {
    if (path === '/') graph.push({ '@type': 'WebSite', '@id': absoluteUrl('/#website'), name: site.name, url: absoluteUrl('/') });
    graph.push({ '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: title,
      description, inLanguage: 'en', isPartOf: { '@id': absoluteUrl('/#website') },
      ...(breadcrumbs.length ? { breadcrumb: { '@id': `${canonical}#breadcrumb` } } : {}) });
    if (breadcrumbs.length) graph.push({ '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`,
      itemListElement: [{ name: 'Spec Layer', path: '/' }, ...breadcrumbs].map((item, index) => ({
        '@type': 'ListItem', position: index + 1, name: item.name, item: absoluteUrl(item.path)
      })) });
  }
  return `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${robots}">
${notFound ? '' : `<link rel="canonical" href="${canonical}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${site.name}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${notFound ? '' : `<meta property="og:url" content="${canonical}">`}
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(site.imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${escapeHtml(site.imageAlt)}">
${graph.length ? `<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>` : ''}`;
}

export async function generateSeo() {
  for (const [file, meta] of [
    ['index.html', { title: site.homeTitle, description: site.homeDescription, path: '/' }],
    ['404.html', { title: 'Page not found | Spec Layer', description: 'Find Spec Layer documentation, CLI commands, output formats, and schemas.', path: '/404.html', notFound: true }]
  ]) {
    const content = await readFile(new URL(`content/${file}`, root), 'utf8');
    if (!content.includes('<!-- seo -->')) throw new Error(`Missing SEO placeholder in ${file}`);
    await writeFile(new URL(`public/${file}`, root), content.replace('<!-- seo -->', seoHead(meta)));
  }
  // Only canonical HTML pages belong here. Do not invent last-modified dates.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${canonicalPaths.map(path => `  <url><loc>${escapeHtml(absoluteUrl(path))}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(new URL('public/sitemap.xml', root), sitemap);
  const crawlerPreferences = await readFile(new URL('content/robots.production.txt', root), 'utf8');
  const robots = `${crawlerPreferences}\n${site.indexable ? `Sitemap: ${absoluteUrl('/sitemap.xml')}\n` : '# Private preview: HTML and response headers carry noindex.\n'}`;
  await writeFile(new URL('public/robots.txt', root), robots);
  // Cloudflare static asset rules; HTML also carries its own robots directive.
  const headers = `${site.indexable ? '/404.html\n  X-Robots-Tag: noindex\n' : '/*\n  X-Robots-Tag: noindex, follow\n'}\n/sitemap.xml\n  Content-Type: application/xml; charset=utf-8\n`;
  await writeFile(new URL('public/_headers', root), headers);
  await writeFile(new URL('public/_redirects', root), '# Preserve legacy documentation links and consolidate duplicate URLs.\n' + [...redirects].map(([from, to]) => `${from} ${to} 301`).join('\n') + '\n');
  console.log(`Generated SEO metadata and ${canonicalPaths.length} sitemap entries (${site.mode}).`);
}
