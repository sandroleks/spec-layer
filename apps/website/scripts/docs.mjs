import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pages, pageUrl } from '../docs.config.mjs';
import { seoHead } from './seo.mjs';
import { header, footer } from './layout.mjs';
const root = new URL('../', import.meta.url);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const arrow = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14M11 4l6 6-6 6"/></svg>';
const external = '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h10v10M17 3 3 17"/></svg>';
const groups = [...new Set(pages.map(page => page.group))];
const fieldNotes = {
  spec_layer: 'Schema, extractor, export, and source metadata.', completeness: 'What was readable and which sources were unavailable.', collections: 'Collection identities, modes, and source information.', tokens: 'Token identities, types, values, and aliases by mode.', styles: 'Typography and effect style definitions.', diagnostics: 'Reported extraction or validation findings.', statistics: 'Counts and extraction statistics.', guidelines: 'Optional saved AI-written guidance, outside semantic hashes.', component: 'Component name and related components.', api: 'Component properties, variants, states, booleans, and slots.', anatomy: 'Named parts with exact path identities.', layout: 'Layout facts for the default variant.', references: 'Used resources, bindings, and the scoped foundation context.', foundation_content_hash: 'Identity of the complete source foundation.', foundation_dependency_hash: 'Identity of the component’s foundation dependency slice.', foundation_diagnostics: 'Foundation findings accompanying the component.', effects_inline: 'Effect facts attached directly to component nodes.', unbound: 'Hardcoded or unbound component facts.', validation: 'Derived component findings.'
};
function schemaFields(schema) {
  return '<div class="table-scroll" role="region" tabindex="0" aria-label="Canonical fields"><table><thead><tr><th scope="col">Field</th><th scope="col">Required</th><th scope="col">Purpose</th></tr></thead><tbody>' + Object.keys(schema.properties).map(key => `<tr><td><code>${escape(key)}</code></td><td>${schema.required.includes(key) ? 'Yes' : 'No'}</td><td>${escape(fieldNotes[key] || 'See the downloadable schema.')}</td></tr>`).join('') + '</tbody></table></div>';
}
function sidebar(page, versions) {
  return `<aside class="docs-sidebar"><a class="docs-home" href="/">Back to Spec Layer</a><details class="docs-nav-disclosure" open><summary>Documentation ${arrow}</summary><nav aria-label="Documentation pages">${groups.map(group => `<div class="docs-nav-group"><strong>${escape(group)}</strong>${pages.filter(p => p.group === group).map(p => `<a href="${pageUrl(p)}"${p.slug === page.slug ? ' aria-current="page"' : ''}>${escape(p.nav)}</a>`).join('')}</div>`).join('')}</nav></details><div class="docs-sidebar-meta"><span>CLI ${escape(versions.cliVersion)}</span><span>Context ${escape(versions.schemaVersion)}</span></div><a class="sidebar-source" href="https://github.com/sandroleks/spec-layer">Source on GitHub ${external}</a></aside>`;
}
function toc(headings) {
  return `<nav data-toc aria-label="On this page">${headings.map(({ id, title }) => `<a href="#${escape(id)}">${title}</a>`).join('')}</nav>`;
}
function template(page, content, versions) {
  const headings = [...content.matchAll(/<section id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>/g)].map(m => ({ id:m[1], title:m[2].replace(/<[^>]+>/g, '') }));
  if (new Set(headings.map(h => h.id)).size !== headings.length) throw new Error(`Duplicate section id in ${page.slug}`);
  const i = pages.indexOf(page);
  const previous = pages[i - 1]; const next = pages[i + 1];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${seoHead({ title: `${page.seoTitle || page.title} | Spec Layer`, description: page.description, path: pageUrl(page), breadcrumbs: page.slug === 'index' ? [{ name: 'Docs', path: '/docs/' }] : [{ name: 'Docs', path: '/docs/' }, { name: page.nav, path: pageUrl(page) }] })}<meta name="theme-color" content="#101114"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/docs.css"><script src="/app.js" defer></script></head>
<body class="docs-page">${header('docs')}
<div class="container docs-layout docs-hub-layout">${sidebar(page, versions)}<main id="main" class="docs-content"><nav class="docs-breadcrumb" aria-label="Breadcrumb"><a href="/docs/">Docs</a><span aria-hidden="true">/</span><span>${escape(page.nav)}</span></nav><h1>${escape(page.title)}</h1>${headings.length ? `<details class="docs-mobile-toc"><summary>On this page</summary>${toc(headings)}</details>` : ''}${content}<nav class="docs-pagination" aria-label="Documentation pagination">${previous ? `<a href="${pageUrl(previous)}"><span>Previous</span><strong>${escape(previous.nav)}</strong></a>` : '<span></span>'}${next ? `<a href="${pageUrl(next)}"><span>Next</span><strong>${escape(next.nav)} ${arrow}</strong></a>` : ''}</nav><div class="docs-feedback"><span>Found something unclear?</span><a href="https://github.com/sandroleks/spec-layer/issues">Suggest an improvement ${external}</a><a href="https://github.com/sandroleks/spec-layer/blob/main/${escape(page.source)}">Reference source ${external}</a></div></main><aside class="docs-toc"><strong>On this page</strong>${toc(headings)}</aside></div>
${footer()}<div id="copy-status" class="copy-status" role="status" aria-live="polite"></div></body></html>\n`;
}
export async function generateDocs() {
  const versions = JSON.parse(await readFile(new URL('content/reference.json', root), 'utf8'));
  const schemas = {};
  for (const kind of ['component', 'foundation']) schemas[kind] = JSON.parse(await readFile(new URL(`public/schemas/${kind}-context/v5.json`, root), 'utf8'));
  const rendered = [];
  for (const page of pages) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) throw new Error(`Invalid page slug: ${page.slug}`);
    let content = await readFile(new URL(`content/docs/${page.slug}.html`, root), 'utf8');
    content = content.replaceAll('{{cliVersion}}', escape(versions.cliVersion)).replaceAll('{{schemaVersion}}', escape(versions.schemaVersion));
    for (const kind of ['component', 'foundation']) content = content.replace(`<!-- ${kind}-fields -->`, schemaFields(schemas[kind]));
    if (/\{\{[a-zA-Z]/.test(content)) throw new Error(`Unresolved placeholder in ${page.slug}`);
    const html = template(page, content, versions);
    rendered.push({ page, html });
  }
  // Remove obsolete generated routes only after every current page renders.
  await rm(new URL('public/docs/', root), { recursive:true, force:true });
  await mkdir(new URL('public/docs/', root), { recursive:true });
  for (const { page, html } of rendered) {
    if (page.slug !== 'index') {
      await mkdir(new URL(`public/docs/${page.slug}/`, root), { recursive:true });
      await writeFile(new URL(`public/docs/${page.slug}/index.html`, root), html);
    }
    // Retain old .html URLs as a fallback on hosts without redirect-file support.
    await writeFile(new URL(`public/docs/${page.slug}.html`, root), html);
    // Preserve every existing docs.html bookmark with the same quickstart content.
    if (page.slug === 'quickstart') await writeFile(new URL('public/docs.html', root), html);
  }
  console.log(`Generated ${pages.length} documentation pages and the legacy quickstart route.`);
}
if (process.argv[1] && new URL(process.argv[1], 'file:').href === import.meta.url) await generateDocs();
