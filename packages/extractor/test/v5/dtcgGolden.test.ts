import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { dtcgExportFiles, foundationDtcg } from '../../src/index';
import { syntheticArtifact } from './dtcgFixture';

const GOLDEN_DIR = fileURLToPath(new URL('../fixtures/v5/synthetic-foundation-dtcg/', import.meta.url));

describe('DTCG golden', () => {
  it('matches the reviewed golden directory file for file', () => {
    const files = dtcgExportFiles(foundationDtcg(syntheticArtifact()));
    if (process.env.UPDATE_V5_DTCG_GOLDEN === '1') {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      for (const [name, text] of Object.entries(files)) writeFileSync(join(GOLDEN_DIR, name), text);
    }
    expect(existsSync(GOLDEN_DIR)).toBe(true);
    expect(readdirSync(GOLDEN_DIR).sort()).toEqual(Object.keys(files).sort());
    for (const [name, text] of Object.entries(files)) {
      expect(readFileSync(join(GOLDEN_DIR, name), 'utf8'), name).toBe(text);
    }
  });
});
