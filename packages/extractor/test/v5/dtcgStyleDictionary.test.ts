import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import StyleDictionary from 'style-dictionary';
import { dtcgExportFiles, foundationDtcg, type DtcgValueStyle } from '../../src/index';
import { syntheticArtifact } from './dtcgFixture';

/** Mirrors the Neuron Token Sync build: primitives plus one themed mode file
 *  in a single Style Dictionary run, references kept as var() in the CSS. */
async function buildCss(style: DtcgValueStyle): Promise<string> {
  const texts = dtcgExportFiles(foundationDtcg(syntheticArtifact(), { values: style }));
  const dir = mkdtempSync(join(tmpdir(), 'sl-dtcg-sd-'));
  try {
    for (const [name, text] of Object.entries(texts)) writeFileSync(join(dir, name), text);
    const tokens = {
      ...JSON.parse(texts['primitives.dark.json']),
      ...JSON.parse(texts['semantic.dark.json']),
    };
    const sd = new StyleDictionary({
      usesDtcg: true,
      tokens,
      log: { warnings: 'error', errors: { brokenReferences: 'throw' } },
      platforms: {
        css: {
          transforms: ['attribute/cti', 'name/kebab', 'color/css'],
          buildPath: `${dir}/`,
          files: [{ destination: 'tokens.css', format: 'css/variables', options: { outputReferences: true } }],
        },
      },
    });
    await sd.buildAllPlatforms();
    return readFileSync(join(dir, 'tokens.css'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Style Dictionary reads the DTCG output', () => {
  it('builds the legacy flavour into CSS with resolved references', async () => {
    const css = await buildCss('legacy');
    expect(css).toContain('--primitives-color-exact-red: #ff0000;');
    expect(css).toContain('--primitives-spacing-gap: 12px;');
    expect(css).toMatch(/--semantic-color-surface-primary: var\(--primitives-color-chain-bridge\);/);
  });

  it('resolves every reference in the standard flavour', async () => {
    const out = foundationDtcg(syntheticArtifact());
    const texts = dtcgExportFiles(out);
    const tokens = { ...JSON.parse(texts['primitives.dark.json']), ...JSON.parse(texts['semantic.dark.json']) };
    const sd = new StyleDictionary({
      usesDtcg: true, tokens, log: { warnings: 'error', errors: { brokenReferences: 'throw' } },
      platforms: { json: { transforms: [], buildPath: `${tmpdir()}/`, files: [] } },
    });
    const resolved = await sd.exportPlatform('json') as Record<string, unknown>;
    expect(JSON.stringify(resolved.Semantic)).toContain('"hex":"#000000"');
  });
});
