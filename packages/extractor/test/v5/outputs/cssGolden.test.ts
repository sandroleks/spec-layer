import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import postcss from 'postcss';
import { cssOutput, foundationDtcg, type NameCase } from '../../../src/index';
import { syntheticArtifact } from '../dtcgFixture';

const GOLDEN_ROOT = fileURLToPath(new URL('../../fixtures/v5/synthetic-foundation-css/', import.meta.url));
const HEADER = { libraryId: 'lib_synthetic', contentHash: 'sha256:synthetic' };

function files(nameCase: NameCase): Record<string, string> {
  const out = cssOutput(foundationDtcg(syntheticArtifact()), HEADER, { case: nameCase });
  return {
    'tokens.css': out.text,
    'map.json': `${JSON.stringify(out.map, null, 2)}\n`,
    'report.json': `${JSON.stringify(out.report, null, 2)}\n`,
  };
}

describe('CSS golden', () => {
  for (const nameCase of ['kebab', 'camel'] as NameCase[]) {
    it(`matches the reviewed ${nameCase} golden file for file`, () => {
      const dir = join(GOLDEN_ROOT, nameCase);
      const produced = files(nameCase);
      if (process.env.UPDATE_V5_CSS_GOLDEN === '1') {
        mkdirSync(dir, { recursive: true });
        for (const [name, text] of Object.entries(produced)) writeFileSync(join(dir, name), text);
      }
      expect(existsSync(dir)).toBe(true);
      for (const [name, text] of Object.entries(produced)) {
        expect(readFileSync(join(dir, name), 'utf8'), `${nameCase}/${name}`).toBe(text);
      }
    });
  }
});

describe('CSS validity', () => {
  it('parses, declares only custom properties with values, and resolves every var() in-file', () => {
    const { text } = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    const root = postcss.parse(text);
    const declared = new Set<string>();
    const referenced: string[] = [];
    root.walkDecls((decl) => {
      expect(decl.prop.startsWith('--'), decl.prop).toBe(true);
      expect(decl.value.trim().length, decl.prop).toBeGreaterThan(0);
      declared.add(decl.prop);
      for (const m of decl.value.matchAll(/var\((--[^),\s]+)/g)) referenced.push(m[1]);
    });
    expect(declared.size).toBeGreaterThan(10);
    for (const name of referenced) expect(declared.has(name), `var(${name}) has no declaration`).toBe(true);
    let rules = 0;
    root.walkRules((rule) => {
      rules += 1;
      expect(rule.selector === ':root' || rule.selector.startsWith('[data-theme="'), rule.selector).toBe(true);
    });
    expect(rules).toBeGreaterThanOrEqual(3);
  });
});
