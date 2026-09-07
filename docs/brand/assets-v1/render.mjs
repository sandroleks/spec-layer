// Editable artwork masters. Real UI captures remain unretouched source inputs.
// Uses the repository's existing optional sharp asset-authoring dependency.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = new URL('./', import.meta.url);
const brand = new URL('../../../packages/brand/', root);
const website = new URL('../../../apps/website/public/', root);
const tokens = JSON.parse(await readFile(new URL('src/tokens.json', brand), 'utf8'));
const c = tokens.themes.dark;
const fontfile = fileURLToPath(new URL('assets/manrope-600.ttf', brand));
const logo = await readFile(new URL('assets/logo.svg', brand));
const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const exports = [];
await mkdir(new URL('exports/', root), { recursive: true });

async function textLayer(text, size, color, left, top, maxWidth) {
  const input = await sharp({ text: {
    text: `<span foreground="${color}">${xml(text)}</span>`,
    font: `Manrope SemiBold ${size}`, fontfile, rgba: true, dpi: 72,
  } }).png().toBuffer();
  const { width, height } = await sharp(input).metadata();
  if (width > maxWidth) throw new Error(`Text exceeds its column: ${text}`);
  return { input, left, top, width, height };
}
async function render(name, width, height, svgBody, texts, inserts = []) {
  const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${c.canvas}"/>${svgBody}</svg>`;
  const layers = [...inserts];
  for (const [text, size, color, x, y, maxWidth] of texts) {
    const layer = await textLayer(text, size, color, x, y, maxWidth);
    if (layer.left + layer.width > width - 40 || layer.top + layer.height > height - 32) throw new Error(`Unsafe artwork edge: ${text}`);
    layers.push({ input: layer.input, left: layer.left, top: layer.top });
  }
  const output = await sharp(Buffer.from(background)).composite(layers).png().toBuffer();
  await writeFile(new URL(`exports/${name}.png`, root), output);
  exports.push({ file: `exports/${name}.png`, width, height, bytes: output.length, sha256: createHash('sha256').update(output).digest('hex') });
}
const symbol = async size => sharp(logo).resize(size, size).png().toBuffer();
const cards = [
  { key: 'component', file: 'gallery-component-docs', number: '01', label: 'COMPONENT DOCUMENTATION',
    title: ['Choose the detail.', 'Create the docs.'],
    body: ['Anatomy, measurements, states, and tokens.', 'Choose what your component docs include.'],
    footer: 'Create docs  /  Copy for AI' },
  { key: 'foundations', file: 'gallery-foundations', number: '02', label: 'FOUNDATION DOCUMENTATION',
    title: ['Make your', 'foundations readable.'],
    body: ['Bring variables and text styles together.', 'Create references or copy design tokens.'],
    footer: 'Variables  /  Text styles  /  DTCG JSON' },
  { key: 'library', file: 'gallery-library-updates', number: '03', label: 'LIBRARY & UPDATES',
    title: ['See what changed.', 'Keep docs current.'],
    body: ['Review changes in the source design.', 'Update the documentation connected to it.'],
    footer: 'Review changes  /  Update docs' },
];
for (const card of cards) {
  const screenshot = await sharp(fileURLToPath(new URL(`captures/${card.key}-dark.png`, root))).resize(600, 850).png().toBuffer();
  await render(card.file, 1920, 1080,
    `<rect x="1064" y="48" width="808" height="984" rx="24" fill="${c.surface}"/><rect x="1159" y="91" width="602" height="892" rx="9" fill="${c.chrome}" stroke="${c.divider}"/><path d="M96 830h864" stroke="${c.divider}"/>`,
    [ ['spec layer',42,c.text,184,86,680], [card.label,24,c['accent-text'],96,294,870],
      [card.title[0],76,c.text,90,359,906], [card.title[1],76,c.text,90,452,906],
      [card.body[0],29,c.muted,96,611,880], [card.body[1],29,c.muted,96,658,880],
      [card.footer,25,c.text,96,872,880], [card.number+' / 03',24,c['accent-text'],96,978,320],
      ['Plugin interface · Sample data',19,c.muted,1180,103,560],
    ], [{input:await symbol(64),left:96,top:80},{input:screenshot,left:1160,top:132}]);
}

// Thumbnail-first covers: one clear statement, one source identity.
async function cover(name,width,height) {
  const scale=width/1200;
  const S=n=>Math.round(n*scale);
  await render(name,width,height,
    `<path d="M${S(64)} ${height-S(110)}h${width-S(128)}" stroke="${c.divider}"/><rect x="${width-S(86)}" y="${S(66)}" width="${S(22)}" height="${S(22)}" rx="${S(4)}" fill="${c.action}"/>`,
    [['spec layer',S(32),c.text,S(137),S(62),S(700)],
     ['Your design system.',S(72),c.text,S(59),S(205),width-S(110)],
     ['Ready to build.',S(72),c['accent-text'],S(59),S(298),width-S(110)],
     ['Documentation and context from Figma',S(24),c.muted,S(64),S(414),width-S(128)],
     ['Component docs  /  Design tokens  /  CLI',S(19),c.muted,S(64),height-S(70),S(720)],
     ['spec-layer.com',S(19),c.text,width-S(213),height-S(70),S(160)]],
    [{input:await symbol(S(48)),left:S(64),top:S(58)}]);
}
await cover('social-card',1200,630);
await cover('repository-social',1280,640);

const coverShot=await sharp(fileURLToPath(new URL('captures/component-dark.png',root))).resize(600,850).png().toBuffer();
await render('figma-cover',1920,1080,
  `<rect x="1064" y="48" width="808" height="984" rx="24" fill="${c.surface}"/><path d="M96 830h864" stroke="${c.divider}"/><rect x="1159" y="91" width="602" height="892" rx="9" fill="${c.chrome}" stroke="${c.divider}"/>`,
  [['spec layer',42,c.text,184,86,700],['DESIGN SYSTEM DOCUMENTATION & CONTEXT',22,c['accent-text'],96,292,900],
   ['Your design system.',80,c.text,90,355,925],['Ready to build.',80,c['accent-text'],90,453,925],
   ['Document in Figma.',32,c.muted,96,615,880],['Bring shared context into your codebase.',32,c.muted,96,666,880],
   ['Component docs  /  Design tokens  /  CLI',25,c.text,96,874,885],['spec-layer.com',25,c.muted,96,979,500],
   ['Plugin interface · Sample data',19,c.muted,1180,103,560]],
  [{input:await symbol(64),left:96,top:80},{input:coverShot,left:1160,top:132}]);
for (const size of [128,512]) {
 const output=await symbol(size); const name=`icon-${size}.png`;
 await writeFile(new URL(`exports/${name}`,root),output);
 exports.push({file:`exports/${name}`,width:size,height:size,bytes:output.length,sha256:createHash('sha256').update(output).digest('hex')});
}
await cp(new URL('assets/logo.svg',brand),new URL('exports/symbol.svg',root));

// Explicitly called authoring step; ordinary builds consume committed assets.
await mkdir(new URL('screenshots/',website),{recursive:true});
await mkdir(new URL('social/',website),{recursive:true});
for(const card of cards){
 await cp(new URL(`exports/${card.file}.png`,root),new URL(`${card.file}.png`,website));
 await cp(new URL(`captures/${card.key}-dark.png`,root),new URL(`screenshots/${card.key}-dark.png`,website));
}
await cp(new URL('exports/social-card.png',root),new URL('social/spec-layer.png',website));
const inputPaths = ['render.mjs', '../../../packages/brand/src/tokens.json', '../../../packages/brand/assets/logo.svg', '../../../packages/brand/assets/manrope-600.ttf', ...cards.map(card => `captures/${card.key}-dark.png`)];
const inputs = [];
for (const file of inputPaths) inputs.push({ file, sha256: createHash('sha256').update(await readFile(new URL(file,root))).digest('hex') });
await writeFile(new URL('exports/manifest.json',root),JSON.stringify({
 source:'Shared brand tokens and static symbol; browser captures of the current plugin renderer with synthetic fixtures.',
 renderer:'render.mjs', inputs, exports,
},null,2)+'\n');
console.log(`Rendered ${exports.length} artwork exports and updated website image assets.`);
