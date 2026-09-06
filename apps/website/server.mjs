import { generateDocs } from './scripts/docs.mjs';
import { generateSeo, redirects } from './scripts/seo.mjs';
import { site } from './site.config.mjs';
import { infoPages, infoPageUrl } from './pages.config.mjs';
import { generatePages } from './scripts/pages.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, 'public');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.yaml':'text/yaml', '.ttf':'font/ttf', '.txt':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.xml':'application/xml; charset=utf-8' };
await generateDocs();
await generateSeo();
await generatePages();
http.createServer(async (req, res) => {
  const noindex = !site.indexable;
  if (noindex) res.setHeader('X-Robots-Tag', 'noindex, follow');
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (redirects.has(path)) {
      res.writeHead(301, { Location: redirects.get(path) + url.search }); res.end(); return;
    }
    if (path.startsWith('/_')) { res.writeHead(404); res.end('Page not found'); return; }
    if (path.endsWith('/')) path += 'index.html';
    if (infoPages.some(page => infoPageUrl(page) === path)) path += '.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' });
    res.end(await readFile(resolve(root, '404.html')));
  }
}).listen(4621, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4621'));
