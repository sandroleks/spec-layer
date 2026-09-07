// Local-only asset review, kept outside the production website.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const shared = new Map([
 ['/shared/tokens.css', new URL('../../../packages/brand/dist/tokens.css', import.meta.url)],
 ['/shared/manrope-600.ttf', new URL('../../../packages/brand/assets/manrope-600.ttf', import.meta.url)],
]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.json':'application/json','.md':'text/plain; charset=utf-8','.zip':'application/zip'};
createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const file=shared.get(path)||resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!shared.has(path)&&!String(file).startsWith(resolve(root)+sep)){res.writeHead(403);res.end();return;}
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(String(file))]||'application/octet-stream','Cache-Control':'no-store','X-Robots-Tag':'noindex'});res.end(body);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(4652,'127.0.0.1',()=>console.log('Asset review: http://127.0.0.1:4652/'));
