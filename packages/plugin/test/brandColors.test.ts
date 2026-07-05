import { describe, it, expect } from 'vitest';
import {
  parseBrandHex,
  resolveBrand,
  emptyBrandColors,
  DEFAULT_HEADER_BG,
  DEFAULT_ACCENT,
  emptyBrandTheme,
  resolveTheme,
  migrateBrandColors,
  THEME_PRESETS,
} from '../src/brandColors';

describe('parseBrandHex', () => {
  it('accepts a #rrggbb value and lowercases it', () => {
    expect(parseBrandHex('#0D2436')).toBe('#0d2436');
  });

  it('accepts a bare rrggbb value (no #) and adds the hash', () => {
    expect(parseBrandHex('12b3a6')).toBe('#12b3a6');
  });

  it('trims surrounding whitespace', () => {
    expect(parseBrandHex('  #abcdef  ')).toBe('#abcdef');
  });

  it('rejects 3-digit shorthand', () => {
    expect(parseBrandHex('#fff')).toBeNull();
  });

  it('rejects non-hex characters', () => {
    expect(parseBrandHex('#12345g')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseBrandHex('')).toBeNull();
  });
});

describe('resolveBrand', () => {
  it('uses defaults when both overrides are null', () => {
    expect(resolveBrand(emptyBrandColors())).toEqual({
      headerBg: DEFAULT_HEADER_BG,
      accent: DEFAULT_ACCENT,
    });
  });

  it('uses defaults when given null/undefined', () => {
    expect(resolveBrand(null)).toEqual({ headerBg: DEFAULT_HEADER_BG, accent: DEFAULT_ACCENT });
    expect(resolveBrand(undefined)).toEqual({ headerBg: DEFAULT_HEADER_BG, accent: DEFAULT_ACCENT });
  });

  it('honors overrides and falls back per-field', () => {
    expect(resolveBrand({ headerBg: '#000000', accent: null })).toEqual({
      headerBg: '#000000',
      accent: DEFAULT_ACCENT,
    });
    expect(resolveBrand({ headerBg: null, accent: '#ffffff' })).toEqual({
      headerBg: DEFAULT_HEADER_BG,
      accent: '#ffffff',
    });
  });
});

describe('brand theme', () => {
  it('resolves null fields to defaults', () => {
    expect(resolveTheme(emptyBrandTheme())).toEqual({
      headerBg: '#0d2436', accent: '#12b3a6',
      bodyText: '#334155', tableHeadBg: '#f8fafc',
      headingFont: 'Inter', bodyFont: 'Inter',
    });
  });

  it('migrates legacy two-color objects', () => {
    expect(migrateBrandColors({ headerBg: '#111111', accent: null })).toEqual({
      headerBg: '#111111', accent: null,
      bodyText: null, tableHeadBg: null, headingFont: null, bodyFont: null,
    });
  });

  it('passes a full theme through migration unchanged', () => {
    const t = { headerBg: '#111111', accent: '#222222', bodyText: '#333333', tableHeadBg: '#444444', headingFont: 'Lora', bodyFont: 'Inter' };
    expect(migrateBrandColors(t)).toEqual(t);
  });

  it('ships presets, with Default first matching the built-in palette', () => {
    expect(THEME_PRESETS[0].name).toBe('Default');
    expect(resolveTheme(THEME_PRESETS[0].theme).headerBg).toBe('#0d2436');
  });
});
