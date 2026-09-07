import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const artwork = new URL('../../../docs/brand/assets-v1/', import.meta.url);
const output = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('exports/manifest.json', artwork), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
for (const item of [...manifest.inputs, ...manifest.exports]) {
  const data = await readFile(new URL(item.file, artwork));
  assert.equal(hash(data), item.sha256, `Artwork changed or needs regeneration: ${item.file}. Run npm run social:render in apps/website.`);
  if (item.width) {
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(data.readUInt32BE(16), item.width, item.file);
    assert.equal(data.readUInt32BE(20), item.height, item.file);
  }
}
const copies = [
  ...['component-docs', 'foundations', 'library-updates'].map(name => [`exports/gallery-${name}.png`, `gallery-${name}.png`]),
  ...['component', 'foundations', 'library'].map(name => [`captures/${name}-dark.png`, `screenshots/${name}-dark.png`]),
  ['exports/social-card.png', 'social/spec-layer.png'],
];
for (const [source, destination] of copies) {
  assert.deepEqual(await readFile(new URL(destination, output)), await readFile(new URL(source, artwork)), `Artwork copy differs: ${destination}`);
}
console.log(`Checked ${manifest.exports.length} artwork exports, source freshness, dimensions, and ${copies.length} website copies.`);
