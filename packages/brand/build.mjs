import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkContrast } from './src/contrast.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const declarations = values => Object.entries(values).map(([key, value]) => `  --brand-${key}: ${value};`).join('\n');

/** Generate before each consumer build, so a stale artifact can never ship. */
export async function buildBrand() {
  const tokens = JSON.parse(await readFile(resolve(here, 'src/tokens.json'), 'utf8'));
  const report = checkContrast(tokens.themes);
  if (report.status !== 'passed') {
    throw new Error(`Brand contrast checks failed:\n${report.checks.filter(check => !check.pass)
      .map(check => `${check.theme}: ${check.foreground} on ${check.background} = ${check.ratio}:1 (requires ${check.minimum}:1)`)
      .join('\n')}`);
  }
  const header = `/* Generated from @spec-layer/brand ${tokens.version}. Edit src/tokens.json. */\n`;
  // Both html and body theme consumers are supported. The default is dark;
  // the plugin sets its host-derived body theme before rendering.
  const css = header + `:root {\n${declarations(tokens.shared)}\n}\n` +
    Object.entries(tokens.themes).map(([theme, values]) =>
      `${theme === 'dark' ? ':root,\n' : ''}:root[data-theme="${theme}"], body[data-theme="${theme}"] {\n  color-scheme: ${theme};\n${declarations(values)}\n}\n`).join('') +
    '@media (prefers-reduced-motion: reduce) {\n  :root {\n    --brand-motion-fast: 0ms;\n    --brand-motion-standard: 0ms;\n    --brand-motion-slow: 0ms;\n  }\n}\n';
  const pluginCss = header + `:root {\n${declarations(tokens.surfaces.plugin)}\n}\n`;
  await mkdir(resolve(here, 'dist'), { recursive: true });
  await Promise.all([
    writeFile(resolve(here, 'dist/tokens.css'), css),
    writeFile(resolve(here, 'dist/plugin.css'), pluginCss),
    writeFile(resolve(here, 'dist/contrast-report.json'), JSON.stringify({
      version: tokens.version,
      methodology: 'WCAG sRGB relative luminance; permitted semantic pairs only, not a full accessibility audit.',
      ...report,
    }, null, 2) + '\n'),
  ]);
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = await buildBrand();
  console.log(`Built shared brand assets. ${report.checks.length} contrast pairs passed.`);
}
