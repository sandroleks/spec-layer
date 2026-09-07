// Local, read-only review of the actual renderer. Build with UI_HARNESS=1 first.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const harnessUrl = new URL('./dist/ui-harness.html', import.meta.url);
await readFile(harnessUrl); // Fail early with the missing build, not a blank frame.
const brandCss = await readFile(new URL('../brand/dist/tokens.css', import.meta.url), 'utf8');
const logo = await readFile(new URL('../brand/assets/logo.svg', import.meta.url), 'utf8');
const page = `<!doctype html><html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spec Layer · Plugin design system implementation</title>
<style>${brandCss}
*{box-sizing:border-box}body{margin:0;background:var(--brand-canvas);color:var(--brand-text);font:14px/1.5 var(--brand-font-ui)}
main{max-width:1080px;margin:auto;padding:28px 24px}header{display:flex;align-items:center;gap:14px}header svg{width:36px;height:36px}h1{font-size:20px;margin:0}p{color:var(--brand-muted);margin:5px 0 24px}.controls{display:flex;gap:24px;flex-wrap:wrap;margin:24px 0}label{display:flex;align-items:center;gap:10px}select{font:inherit;color:var(--brand-text);background:var(--brand-surface);border:1px solid var(--brand-control-border);border-radius:8px;padding:8px}select:focus-visible,a:focus-visible{outline:2px solid var(--brand-focus);outline-offset:3px}.previews{display:flex;gap:24px;flex-wrap:wrap}figure{margin:0;max-width:100%;overflow-x:auto}figcaption{font-size:12px;color:var(--brand-muted);margin-bottom:10px}iframe{display:block;width:480px;height:680px;border:1px solid var(--brand-divider);border-radius:8px}footer{margin-top:22px;color:var(--brand-muted);font-size:12px}footer a{color:var(--brand-accent-text)}
</style></head><body><main><header>${logo}<h1>Spec Layer · Plugin implementation</h1></header>
<p>Shared foundation and plugin adoption · Sample data · Local review</p>
<div class="controls"><label>Screen <select id="screen">
<option value="view=component&state=ready">Component docs</option>
<option value="view=library&state=expanded">Library changes</option>
<option value="view=foundations">Foundations</option>
<option value="view=settings">Settings</option>
<option value="view=license">License</option>
<option value="view=library&search=open&query=button">Quick search</option>
<option value="view=component&state=empty">Component · Empty</option>
<option value="view=component&state=building">Component · Creating</option>
<option value="view=component&state=error">Component · Error</option>
<option value="view=component&state=warning">Component · Warning</option>
<option value="view=library&state=updating">Library · Updating</option>
</select></label><label>Width <select id="width"><option value="480">480px</option><option value="420">420px</option></select></label></div>
<div class="previews"><figure><figcaption>Dark</figcaption><iframe id="dark" title="Dark plugin" src="/ui-harness.html?view=component&state=ready&theme=dark"></iframe></figure><figure><figcaption>Light</figcaption><iframe id="light" title="Light plugin" src="/ui-harness.html?view=component&state=ready&theme=light"></iframe></figure></div>
<footer>The frames use the built plugin CSS and current renderer. Host actions are not connected. On narrow screens, scroll each frame horizontally. <a href="/contrast-report.json">152 color-pair checks</a>.</footer>
</main><script>
const screen=document.getElementById('screen');const width=document.getElementById('width');
screen.addEventListener('change',()=>{for(const theme of ['dark','light'])document.getElementById(theme).src='/ui-harness.html?'+screen.value+'&theme='+theme;});
width.addEventListener('change',()=>{for(const theme of ['dark','light'])document.getElementById(theme).style.width=width.value+'px';});
</script></body></html>`;

const routes = new Map([
  ['/ui-harness.html', [harnessUrl, 'text/html; charset=utf-8']],
  ['/contrast-report.json', [new URL('../brand/dist/contrast-report.json', import.meta.url), 'application/json']],
]);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  const route = routes.get(pathname);
  if (!route) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const body = await readFile(route[0]);
    response.writeHead(200, { 'Content-Type': route[1] });
    response.end(body);
  } catch {
    response.writeHead(503); response.end('Rebuild the plugin harness to continue.');
  }
});
server.listen(4651, '127.0.0.1', () => console.log('Plugin review: http://127.0.0.1:4651/'));
