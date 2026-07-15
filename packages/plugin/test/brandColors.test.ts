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
  matchPreset,
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
      headerBg: '#0f172a', accent: '#2563eb',
      bodyText: '#334155', tableHeadBg: '#f8fafc',
      headingFont: 'Inter', bodyFont: 'Inter',
      cornerStyle: 'soft',
    });
  });

  it('migrates legacy two-color objects', () => {
    expect(migrateBrandColors({ headerBg: '#111111', accent: null })).toEqual({
      headerBg: '#111111', accent: null,
      bodyText: null, tableHeadBg: null, headingFont: null, bodyFont: null,
      cornerStyle: null,
    });
  });

  it('migrates a 2.x theme (no cornerStyle) to cornerStyle null', () => {
    const stored = {
      headerBg: '#111111', accent: '#222222', bodyText: '#333333',
      tableHeadBg: '#444444', headingFont: 'Lora', bodyFont: 'Inter',
    };
    expect(migrateBrandColors(stored as never)).toEqual({ ...stored, cornerStyle: null });
  });

  it('passes a full theme through migration unchanged', () => {
    const t = {
      headerBg: '#111111', accent: '#222222', bodyText: '#333333',
      tableHeadBg: '#444444', headingFont: 'Lora', bodyFont: 'Inter',
      cornerStyle: 'sharp' as const,
    };
    expect(migrateBrandColors(t)).toEqual(t);
  });

  it('ships four fully-specified presets, Default first', () => {
    expect(THEME_PRESETS.map((p) => p.name)).toEqual(['Default', 'Editorial', 'Tech', 'Warm']);
    for (const { name, theme } of THEME_PRESETS) {
      for (const [key, value] of Object.entries(theme)) {
        expect(value, `${name}.${key}`).not.toBeNull();
      }
    }
  });

  it('Default preset equals the built-in defaults', () => {
    expect(resolveTheme(THEME_PRESETS[0].theme)).toEqual(resolveTheme(emptyBrandTheme()));
  });
});

describe('matchPreset', () => {
  it('identifies each preset from its own theme', () => {
    for (const { name, theme } of THEME_PRESETS) {
      expect(matchPreset({ ...theme })).toBe(name);
    }
  });

  it('treats the empty theme as Default (null equals concrete default)', () => {
    expect(matchPreset(emptyBrandTheme())).toBe('Default');
    expect(matchPreset(null)).toBe('Default');
    expect(matchPreset(undefined)).toBe('Default');
  });

  it('returns null once any field is edited away from the preset', () => {
    const edited = { ...THEME_PRESETS[1].theme, accent: '#123456' };
    expect(matchPreset(edited)).toBeNull();
  });

  it('returns null for a fully custom theme', () => {
    expect(matchPreset({
      headerBg: '#101010', accent: '#202020', bodyText: '#303030',
      tableHeadBg: '#404040', headingFont: 'Karla', bodyFont: 'Karla',
      cornerStyle: 'round',
    })).toBeNull();
  });
});
