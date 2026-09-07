import { cp, mkdir, readFile } from 'node:fs/promises';
import { buildBrand } from '../../../packages/brand/build.mjs';

const source = new URL('../../../packages/brand/', import.meta.url);
const output = new URL('../public/', import.meta.url);
const tokens = JSON.parse(await readFile(new URL('src/tokens.json', source), 'utf8'));
export const websiteThemeColor = tokens.themes.dark.canvas;

/** Preserve public asset URLs, but generate their contents from one source. */
export async function generateBrand() {
  await buildBrand();
  await mkdir(new URL('brand/', output), { recursive: true });
  await mkdir(new URL('fonts/', output), { recursive: true });
  await Promise.all([
    cp(new URL('dist/tokens.css', source), new URL('brand/tokens.css', output)),
    cp(new URL('assets/logo.svg', source), new URL('logo.svg', output)),
    cp(new URL('assets/Manrope-OFL.txt', source), new URL('fonts/OFL.txt', output)),
    ...[400, 500, 600, 700].map(weight => cp(
      new URL(`assets/manrope-${weight}.ttf`, source),
      new URL(`fonts/manrope-${weight}.ttf`, output),
    )),
  ]);
  console.log('Generated website brand assets from @spec-layer/brand.');
}
