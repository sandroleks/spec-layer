import { readFile, writeFile, rm } from 'node:fs/promises';

const root = new URL('../public/', import.meta.url);

// Optimize stylesheet delivery only. Gallery screenshots stay as original PNGs.
export async function optimizeAssets() {
  const tokens = await readFile(new URL('brand/tokens.css', root), 'utf8');
  const brand = await readFile(new URL('brand.css', root), 'utf8');
  const styles = await readFile(new URL('styles.css', root), 'utf8');
  const removeImports = css => css.replace(/^@import\s+["'][^"']+["'];\s*/gm, '');
  await writeFile(new URL('styles.bundle.css', root), [tokens, removeImports(brand), removeImports(styles)].join('\n'));
  await rm(new URL('screenshots/responsive/', root), { recursive: true, force: true });
  console.log('Bundled shared website CSS; gallery uses original PNG files.');
}
