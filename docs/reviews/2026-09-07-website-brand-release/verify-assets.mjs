import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('./', import.meta.url);
const candidate = JSON.parse(await readFile(new URL('candidate.json',root),'utf8'));
const results = [];
// HTML, redirects, crawler responses and host-transformed content are covered
// by check-http. Verify byte parity for every delivered static source asset.
for (const file of candidate.files.filter(item => !item.path.endsWith('.html') && !item.path.startsWith('_') && !['robots.txt','sitemap.xml'].includes(item.path))) {
 const response = await fetch('https://spec-layer.com/'+file.path);
 assert.equal(response.status,200,file.path);
 const data = Buffer.from(await response.arrayBuffer());
 assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,`Live asset differs from checked release: ${file.path}`);
 results.push({path:file.path,status:response.status,bytes:data.length,sha256:file.sha256});
}
await writeFile(new URL('live-assets.json',root),JSON.stringify({verifiedAt:new Date().toISOString(),results},null,2)+'\n');
console.log(`Verified ${results.length} public assets match the checked release byte for byte.`);
