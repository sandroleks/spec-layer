import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import postcss from 'postcss';
import { CSS_INDEX_FILE, cssOutput, foundationDtcg, type NameCase } from '../../../src/index';
import { syntheticArtifact } from '../dtcgFixture';

const GOLDEN_ROOT = fileURLToPath(new URL('../../fixtures/v5/synthetic-foundation-css/', import.meta.url));
const HEADER = { libraryId: 'lib_synthetic', contentHash: 'sha256:synthetic', platform: 'web', format: 'css' };

function files(nameCase: NameCase): Record<string, string> {
  const out = cssOutput(foundationDtcg(syntheticArtifact()), HEADER, { case: nameCase });
  return {
    ...out.files,
    'map.json': `${JSON.stringify(out.map, null, 2)}\n`,
    'report.json': `${JSON.stringify(out.report, null, 2)}\n`,
  };
}

describe('CSS golden', () => {
  for (const nameCase of ['kebab', 'camel'] as NameCase[]) {
    it(`matches the reviewed ${nameCase} golden directory, file for file, with nothing extra on disk`, () => {
      const dir = join(GOLDEN_ROOT, nameCase);
      const produced = files(nameCase);
      if (process.env.UPDATE_V5_CSS_GOLDEN === '1') {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        for (const [name, text] of Object.entries(produced)) writeFileSync(join(dir, name), text);
      }
      expect(existsSync(dir)).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(Object.keys(produced).sort());
      for (const [name, text] of Object.entries(produced)) {
        expect(readFileSync(join(dir, name), 'utf8'), `${nameCase}/${name}`).toBe(text);
      }
    });
  }
});

describe('CSS validity', () => {
  const out = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
  const parts = Object.keys(out.files).filter((n) => n !== CSS_INDEX_FILE);

  it('every part file parses, holds one rule of custom properties, and every var() resolves somewhere in the set', () => {
    const declared = new Set<string>();
    const referenced: string[] = [];
    for (const name of parts) {
      const root = postcss.parse(out.files[name]);
      let rules = 0;
      root.walkRules((rule) => {
        rules += 1;
        expect(rule.selector === ':root' || rule.selector.startsWith('[data-theme="'), `${name}: ${rule.selector}`).toBe(true);
      });
      expect(rules, name).toBe(1);
      root.walkDecls((decl) => {
        expect(decl.prop.startsWith('--'), decl.prop).toBe(true);
        expect(decl.value.trim().length, decl.prop).toBeGreaterThan(0);
        declared.add(decl.prop);
        for (const m of decl.value.matchAll(/var\((--[^),\s]+)/g)) referenced.push(m[1]);
      });
    }
    expect(declared.size).toBeGreaterThan(10);
    for (const name of referenced) expect(declared.has(name), `var(${name}) has no declaration`).toBe(true);
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it('index.css imports every part file exactly once, in order, and declares nothing', () => {
    const root = postcss.parse(out.files[CSS_INDEX_FILE]);
    const imported: string[] = [];
    root.walkAtRules('import', (rule) => { imported.push(rule.params.replace(/^"\.\/|"$/g, '')); });
    expect(imported).toEqual(parts);
    let rules = 0;
    root.walkRules(() => { rules += 1; });
    expect(rules).toBe(0);
  });
});
