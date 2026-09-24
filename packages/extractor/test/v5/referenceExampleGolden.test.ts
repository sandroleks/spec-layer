/**
 * Pins the reference example's rendered output byte for byte. The
 * documentation site (a separate private repository) mirrors
 * `fixtures/reference-example/out/` exactly, so a change here that is not
 * also regenerated on disk is a real drift, not a stale test.
 *
 * Set `UPDATE_REFERENCE_EXAMPLE=1` to regenerate the golden files in place
 * before this test runs, the same as running
 * `npx tsx packages/extractor/test/fixtures/referenceExample.ts` directly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFERENCE_OUT_DIR, renderReferenceExample, writeReferenceExample } from '../fixtures/referenceExample';

if (process.env.UPDATE_REFERENCE_EXAMPLE === '1') writeReferenceExample();

const onDisk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? onDisk(p) : [relative(REFERENCE_OUT_DIR, p)];
});

describe('reference example goldens', () => {
  it('matches every generated file byte for byte, with no extra files', () => {
    const rendered = renderReferenceExample();
    expect(onDisk(REFERENCE_OUT_DIR).sort()).toEqual(Object.keys(rendered).sort());
    for (const [path, text] of Object.entries(rendered)) {
      expect(text, path).toBe(readFileSync(join(REFERENCE_OUT_DIR, path), 'utf8'));
    }
  });

  // The brief this test was planned from guessed the header would contain
  // the word "derived". The real header text in `css.ts` (`headerText`)
  // never uses that word: it reads "...has a unit its own Figma variable
  // does not state, taken from how the library uses the token." (singular)
  // or the plural form for more than one. This asserts the real line.
  it('writes the derived-unit header line in the CSS output', () => {
    const css = Object.entries(renderReferenceExample())
      .filter(([p]) => p.startsWith('tokens/') && p.endsWith('.css'));
    const derivedUnitLine = /has a unit its own Figma variable does not state|have a unit their own Figma variables do not state/;
    expect(css.some(([, text]) => derivedUnitLine.test(text))).toBe(true);
  });
});
