import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkContrast, contrastRatio } from '../src/contrast.mjs';

const tokens = JSON.parse(readFileSync(new URL('../src/tokens.json', import.meta.url), 'utf8'));

describe('shared brand contrast gate', () => {
  it('agrees with known sRGB extremes and rejects invalid color input', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#6845C7', '#6845C7')).toBe(1);
    expect(contrastRatio('#0B99FF', '#FFFFFF')).toBeCloseTo(2.994, 2);
    expect(() => contrastRatio('transparent', '#FFFFFF')).toThrow();
  });

  it('keeps every permitted text and control pair above its threshold in both themes', () => {
    const report = checkContrast(tokens.themes);
    expect(report.checks.filter(check => !check.pass)).toEqual([]);
    expect(new Set(report.checks.map(check => check.theme))).toEqual(new Set(['light', 'dark']));
  });

  it('rejects the previous dark primary pairing and a disappearing unchecked boundary', () => {
    const themes = structuredClone(tokens.themes);
    themes.dark.action = '#0B99FF';
    themes.dark['on-action'] = '#FFFFFF';
    themes.light['control-border'] = themes.light.surface;
    const report = checkContrast(themes);
    expect(report.status).toBe('failed');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ theme: 'dark', foreground: 'on-action', background: 'action', pass: false }),
      expect.objectContaining({ theme: 'light', foreground: 'control-border', background: 'surface', pass: false }),
    ]));
  });
});
