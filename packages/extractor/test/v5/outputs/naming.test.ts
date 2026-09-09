import { describe, expect, it } from 'vitest';
import {
  deriveName, joinWords, pathWords, resolveNames, splitWords, type NameCase,
} from '../../../src/index';

describe('splitWords', () => {
  it('splits on non-alphanumeric runs and lowercase-to-uppercase boundaries, not digits', () => {
    expect(splitWords('fontSize')).toEqual(['font', 'Size']);
    expect(splitWords('Blue 500')).toEqual(['Blue', '500']);
    expect(splitWords('h1')).toEqual(['h1']);
    expect(splitWords('surface--primary_default')).toEqual(['surface', 'primary', 'default']);
    expect(splitWords('!!!')).toEqual([]);
  });
});

describe('joinWords and deriveName', () => {
  const cases: Array<[NameCase, string, string]> = [
    ['kebab', 'mapped-colors-surface-primary-default', 'foundation-font-size-850'],
    ['camel', 'mappedColorsSurfacePrimaryDefault', 'foundationFontSize850'],
    ['pascal', 'MappedColorsSurfacePrimaryDefault', 'FoundationFontSize850'],
    ['snake', 'mapped_colors_surface_primary_default', 'foundation_font_size_850'],
    ['constant', 'MAPPED_COLORS_SURFACE_PRIMARY_DEFAULT', 'FOUNDATION_FONT_SIZE_850'],
  ];
  for (const [nameCase, a, b] of cases) {
    it(`derives ${nameCase} names`, () => {
      expect(deriveName('Mapped Colors.surface.primary.default', nameCase)).toBe(a);
      expect(deriveName('Foundation.fontSize.850', nameCase)).toBe(b);
    });
  }
  it('turns a segment with no words into _', () => {
    expect(pathWords('A.!!!.b')).toEqual(['A', '_', 'b']);
    expect(deriveName('A.!!!.b', 'kebab')).toBe('a-_-b');
    expect(joinWords(['x', '_', 'y'], 'camel')).toBe('x_Y');
  });
});

describe('resolveNames', () => {
  const rules = {
    codeSyntaxKey: 'WEB',
    acceptDeclared: (d: string) => (d.startsWith('--') ? d : null),
    affix: (b: string) => `--${b}`,
    nameCase: 'kebab' as NameCase,
  };
  const meta = {
    'P.color.red': { id: 'v1', collection_id: 'c', type: 'color', scopes: [], code_syntax: { WEB: '--red' } },
    'P.color.js': { id: 'v2', collection_id: 'c', type: 'color', scopes: [], code_syntax: { WEB: 'theme.colors.js' } },
  };

  it('uses a declared name verbatim and marks its source', () => {
    const out = resolveNames(['P.color.red'], meta, rules);
    expect(out.names.get('P.color.red')).toBe('--red');
    expect(out.map['P.color.red']).toEqual({ name: '--red', source: 'code_syntax' });
    expect(out.report).toEqual([]);
  });

  it('derives when the declared name is unusable, and reports it', () => {
    const out = resolveNames(['P.color.js'], meta, rules);
    expect(out.names.get('P.color.js')).toBe('--p-color-js');
    expect(out.map['P.color.js']).toEqual({ name: '--p-color-js', source: 'derived' });
    expect(out.report).toEqual([{
      code: 'code_syntax_not_usable', severity: 'info', path: 'P.color.js',
      message: 'The declared WEB identifier "theme.colors.js" is not a name this format can use; the name was derived instead.',
      details: { declared: 'theme.colors.js', platform: 'WEB' },
    }]);
  });

  it('omits every token that reaches the same name and reports each', () => {
    const out = resolveNames(['P.Blue', 'P.blue', 'P.green'], {}, rules);
    expect(out.names.has('P.Blue')).toBe(false);
    expect(out.names.has('P.blue')).toBe(false);
    expect(out.names.get('P.green')).toBe('--p-green');
    expect(Object.keys(out.map)).toEqual(['P.green']);
    expect(out.report.map((r) => [r.code, r.path])).toEqual([
      ['name_collision', 'P.Blue'], ['name_collision', 'P.blue'],
    ]);
    expect(out.report[0].details).toEqual({ name: '--p-blue', paths: ['P.Blue', 'P.blue'] });
  });

  it('never reads code_syntax when the platform key is null', () => {
    const out = resolveNames(['P.color.red'], meta, { ...rules, codeSyntaxKey: null });
    expect(out.names.get('P.color.red')).toBe('--p-color-red');
  });
});
