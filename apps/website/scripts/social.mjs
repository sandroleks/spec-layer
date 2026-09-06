// Optional asset authoring step. Needs sharp in the monorepo or local environment.
// The committed PNG is used by ordinary website builds, which have no dependencies.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const fontfile = fileURLToPath(new URL('public/fonts/manrope-600.ttf', root));
const background = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#101114"/>
  <path d="M0 0h1200v8H0z" fill="#b3a0ff"/>
  <path d="M64 491h1072" stroke="#36343d"/>
  <g transform="translate(64 52)">
    <rect width="18" height="18" fill="#f0f0f2"/>
    <circle cx="37" cy="9" r="8" stroke="#f0f0f2" stroke-width="2" fill="none"/>
    <rect y="28" width="18" height="18" stroke="#f0f0f2" stroke-width="2" fill="none"/>
    <circle cx="37" cy="37" r="9" fill="#f0f0f2"/>
  </g>
  <path d="M1105 73h30m-11-11 12 11-12 11" stroke="#b3a0ff" stroke-width="2" fill="none"/>
</svg>`;

const lines = [
  { text: 'spec layer', size: 30, color: '#f0f0f2', left: 129, top: 54 },
  { text: 'DESIGN SYSTEMS, DOCUMENTED', size: 16, color: '#b3a0ff', left: 64, top: 182 },
  { text: 'Figma documentation.', size: 72, color: '#f0f0f2', left: 59, top: 231 },
  { text: 'Developer-ready context.', size: 72, color: '#b3a0ff', left: 59, top: 321 },
  { text: 'Component specs · Design tokens · CLI', size: 21, color: '#b4b0be', left: 64, top: 532 },
  { text: 'spec-layer.com', size: 20, color: '#f0f0f2', left: 967, top: 534 },
];
const overlays = [];
for (const line of lines) {
  const input = await sharp({ text: { text: `<span foreground="${line.color}">${line.text}</span>`,
    font: `Manrope SemiBold ${line.size}`, fontfile, rgba: true, dpi: 72 } }).png().toBuffer();
  const { width, height } = await sharp(input).metadata();
  if (line.left + width > 1142 || line.top + height > 590) throw new Error(`Social image text exceeds safe area: ${line.text}`);
  overlays.push({ input, left: line.left, top: line.top });
}
await mkdir(new URL('public/social/', root), { recursive: true });
await sharp(Buffer.from(background)).composite(overlays).png().toFile(fileURLToPath(new URL('public/social/spec-layer.png', root)));
console.log('Rendered 1200 × 630 social preview.');
