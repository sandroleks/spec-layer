import { describe, expect, it } from 'vitest';
import {
  CSS_HEADER_PREFIX, acceptCssDeclared, cssOutput, foundationDtcg, type DtcgExport,
} from '../../../src/index';
import { syntheticArtifact } from '../dtcgFixture';

const HEADER = { libraryId: 'lib_test', contentHash: 'sha256:abc' };

const color = (hex: string, alpha = 1) => ({
  $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha, hex },
});

/** One set (Base) and one modifier (Theme: Light default, Dark). */
function small(overrides: Partial<DtcgExport> = {}): DtcgExport {
  return {
    files: {
      'base.default.json': {
        Base: {
          color: { red: color('#ff0000'), glass: color('#801a00', 0.125) },
          space: { gap: { $type: 'dimension', $value: { value: 8, unit: 'px' } } },
          weight: { $type: 'fontWeight', $value: 700 },
          ratio: { $type: 'number', $value: 1.5 },
          ease: { $type: 'cubicBezier', $value: [0.4, 0, 0.2, 1] },
          time: { $type: 'duration', $value: { value: 200, unit: 'ms' } },
          family: { $type: 'fontFamily', $value: 'Open Sans' },
        },
      },
      'theme.light.json': { Theme: { surface: { $type: 'color', $value: '{Base.color.red}' } } },
      'theme.dark.json': { Theme: { surface: { $type: 'color', $value: '{Base.color.glass}' } } },
    },
    resolver: {
      version: '2025.10',
      sets: { Base: { sources: [{ $ref: 'base.default.json' }] } },
      modifiers: { Theme: { contexts: { Light: [{ $ref: 'theme.light.json' }], Dark: [{ $ref: 'theme.dark.json' }] }, default: 'Light' } },
      resolutionOrder: [{ $ref: '#/sets/Base' }, { $ref: '#/modifiers/Theme' }],
    },
    meta: {
      'Base.color.red': { id: 'v1', collection_id: 'c1', type: 'color', scopes: [], code_syntax: { WEB: '--red' } },
      'Base.space.gap': { id: 'v2', collection_id: 'c1', type: 'dimension', scopes: [], code_syntax: { WEB: 'gap' } },
    },
    report: [],
    ...overrides,
  };
}

describe('acceptCssDeclared', () => {
  it('accepts a custom property, prefixes a bare identifier, rejects anything else', () => {
    expect(acceptCssDeclared('--colors-blue-500')).toBe('--colors-blue-500');
    expect(acceptCssDeclared('colorsBlue500')).toBe('--colorsBlue500');
    expect(acceptCssDeclared('theme.colors.blue500')).toBeNull();
    expect(acceptCssDeclared('--has space')).toBeNull();
  });
});

describe('cssOutput values', () => {
  const text = cssOutput(small(), HEADER).text;

  it('starts with the header carrying library, hash, and output triple, and no timestamp', () => {
    expect(text.startsWith(`${CSS_HEADER_PREFIX} from library lib_test, foundation sha256:abc, web/css/kebab.`)).toBe(true);
    expect(text).toContain('Do not edit. Change the design in Figma, republish, and run spec-layer pull.');
    expect(text).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('writes every type in its CSS form', () => {
    expect(text).toContain('  --red: #ff0000;');
    expect(text).toContain('  --base-color-glass: rgb(128 26 0 / 0.125);');
    expect(text).toContain('  --gap: 8px;');
    expect(text).toContain('  --base-weight: 700;');
    expect(text).toContain('  --base-ratio: 1.5;');
    expect(text).toContain('  --base-ease: cubic-bezier(0.4, 0, 0.2, 1);');
    expect(text).toContain('  --base-time: 200ms;');
    expect(text).toContain('  --base-family: "Open Sans";');
  });

  it('keeps aliases as var() and scopes non-default modes under data-theme', () => {
    const root = text.slice(text.indexOf(':root {'), text.indexOf('}', text.indexOf(':root {')));
    expect(root).toContain('  /* Base */');
    expect(root).toContain('  /* Theme, Light */');
    expect(root).toContain('  --theme-surface: var(--red);');
    const dark = text.slice(text.indexOf('[data-theme="dark"] {'));
    expect(dark).toContain('  /* Theme, Dark */');
    expect(dark).toContain('  --theme-surface: var(--base-color-glass);');
    expect(text.indexOf(':root {')).toBeLessThan(text.indexOf('[data-theme="dark"] {'));
  });

  it('passes legacy string values through verbatim', () => {
    const legacy = small({
      files: { ...small().files, 'base.default.json': { Base: { c: { $type: 'color', $value: '#11223380' }, d: { $type: 'dimension', $value: '1rem' } } } },
    });
    const out = cssOutput(legacy, HEADER).text;
    expect(out).toContain('  --base-c: #11223380;');
    expect(out).toContain('  --base-d: 1rem;');
  });
});

describe('cssOutput names, modes, and reports', () => {
  it('records provenance for every emitted name', () => {
    const { map } = cssOutput(small(), HEADER);
    expect(map['Base.color.red']).toEqual({ name: '--red', source: 'code_syntax' });
    expect(map['Base.space.gap']).toEqual({ name: '--gap', source: 'code_syntax' });
    expect(map['Theme.surface']).toEqual({ name: '--theme-surface', source: 'derived' });
  });

  it('applies the chosen case to derived names only', () => {
    const { text, map } = cssOutput(small(), HEADER, { case: 'camel' });
    expect(text).toContain('  --themeSurface: var(--red);');
    expect(text).toContain('web/css/camel.');
    expect(map['Base.color.red'].name).toBe('--red');
  });

  it('omits a reference whose target was omitted and reports it', () => {
    const exp = small();
    exp.files['theme.light.json'] = { Theme: { surface: { $type: 'color', $value: '{Base.color.missing}' } } };
    const { text, report } = cssOutput(exp, HEADER);
    expect(text).not.toContain('--theme-surface: var(--base-color-missing)');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'reference_target_omitted', path: 'Theme.surface', mode: 'Light', details: { target: 'Base.color.missing' },
    }));
  });

  it('honours root, modeSelector, {collection}, and a per-collection selector', () => {
    const { text } = cssOutput(small(), HEADER, {
      root: 'html', modeSelector: '.{collection}-{mode}',
    });
    expect(text).toContain('html {');
    expect(text).toContain('.theme-dark {');
    const per = cssOutput(small(), HEADER, { modes: { Theme: '[data-mode="{mode}"]' } }).text;
    expect(per).toContain('[data-mode="dark"] {');
  });

  it('reports a shared selector when two modifiers use the default template', () => {
    const exp = small();
    exp.files['density.compact.json'] = { Density: { pad: { $type: 'dimension', $value: { value: 4, unit: 'px' } } } };
    exp.files['density.cozy.json'] = { Density: { pad: { $type: 'dimension', $value: { value: 8, unit: 'px' } } } };
    exp.resolver.modifiers.Density = { contexts: { Compact: [{ $ref: 'density.compact.json' }], Cozy: [{ $ref: 'density.cozy.json' }] }, default: 'Compact' };
    exp.resolver.resolutionOrder.push({ $ref: '#/modifiers/Density' });
    const { report } = cssOutput(exp, HEADER);
    const shared = report.filter((r) => r.code === 'mode_selector_shared');
    expect(shared.map((r) => r.path)).toEqual(['Density', 'Theme']);
    expect(shared[0].details).toEqual({ modifiers: ['Density', 'Theme'], selector: '[data-theme="{mode}"]' });
    const fixed = cssOutput(exp, HEADER, { modes: { Density: '[data-density="{mode}"]' } }).report;
    expect(fixed.some((r) => r.code === 'mode_selector_shared')).toBe(false);
  });
});

describe('cssOutput styles', () => {
  const styled: DtcgExport = {
    files: {
      'base.default.json': { Base: { fam: { $type: 'fontFamily', $value: 'Inter' }, blur: { $type: 'dimension', $value: { value: 8, unit: 'px' } } } },
      'styles.typography.json': {
        'Typography styles': {
          Body: {
            $type: 'typography',
            $value: { fontFamily: '{Base.fam}', fontSize: { value: 16, unit: 'px' }, fontWeight: 400 },
            $extensions: { 'com.spec-layer': {
              lineHeight: { value: 24, unit: 'px' }, letterSpacing: { value: 2, unit: '%' },
              textCase: 'upper', textDecoration: 'strikethrough',
            } },
          },
          Caps: {
            $type: 'typography', $value: { fontSize: { value: 12, unit: 'px' }, lineHeight: 1.2 },
            $extensions: { 'com.spec-layer': { lineHeight: { value: 140, unit: '%' }, textCase: 'small_caps', textDecoration: 'none' } },
          },
        },
      },
      'styles.effects.json': {
        'Effect styles': {
          Card: {
            $type: 'shadow',
            $value: [
              { color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.2, hex: '#000000' }, offsetX: { value: 0, unit: 'px' }, offsetY: { value: 4, unit: 'px' }, blur: '{Base.blur}', spread: { value: 0, unit: 'px' }, inset: false },
              { color: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1, hex: '#ffffff' }, offsetX: { value: 0, unit: 'px' }, offsetY: { value: 1, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 0, unit: 'px' }, inset: true },
            ],
          },
          Blur: { $type: 'shadow', $value: [] },
        },
      },
    },
    resolver: {
      version: '2025.10',
      sets: {
        Base: { sources: [{ $ref: 'base.default.json' }] },
        'Typography styles': { sources: [{ $ref: 'styles.typography.json' }] },
        'Effect styles': { sources: [{ $ref: 'styles.effects.json' }] },
      },
      modifiers: {},
      resolutionOrder: [{ $ref: '#/sets/Base' }, { $ref: '#/sets/Typography styles' }, { $ref: '#/sets/Effect styles' }],
    },
    meta: {},
    report: [],
  };
  const { text, report } = cssOutput(styled, HEADER);

  it('writes typography as one custom property per member, never a font shorthand', () => {
    expect(text).toContain('  --typography-styles-body-font-family: var(--base-fam);');
    expect(text).toContain('  --typography-styles-body-font-size: 16px;');
    expect(text).toContain('  --typography-styles-body-font-weight: 400;');
    expect(text).toContain('  --typography-styles-body-line-height: 24px;');
    expect(text).toContain('  --typography-styles-body-letter-spacing: 0.02em;');
    expect(text).toContain('  --typography-styles-body-text-transform: uppercase;');
    expect(text).toContain('  --typography-styles-body-text-decoration: line-through;');
    expect(text).not.toMatch(/font: /);
  });

  it('keeps a lineHeight already in $value, and reports what it restated or could not say', () => {
    expect(text).toContain('  --typography-styles-caps-line-height: 1.2;');
    expect(text).not.toContain('--typography-styles-caps-line-height: 1.4');
    expect(text).not.toContain('--typography-styles-caps-text-transform');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'value_converted', path: 'Typography styles.Body', details: { property: 'letterSpacing', from: { value: 2, unit: '%' }, to: '0.02em' },
    }));
    expect(report).toContainEqual(expect.objectContaining({
      code: 'not_expressible', path: 'Typography styles.Caps', details: { property: 'textCase', value: 'small_caps' },
    }));
  });

  it('writes shadows as one box-shadow list and omits a style with no visible shadow', () => {
    expect(text).toContain('  --effect-styles-card: 0px 4px var(--base-blur) 0px rgb(0 0 0 / 0.2), inset 0px 1px 0px 0px #ffffff;');
    expect(text).not.toContain('--effect-styles-blur');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'not_expressible', path: 'Effect styles.Blur', details: { reason: 'no_visible_shadow' },
    }));
  });
});

describe('cssOutput on the synthetic foundation', () => {
  it('emits the declared names, the duplicate mode slug, and the shared-selector report', () => {
    const { text, report } = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    expect(text).toContain('  --color-exact-red: #ff0000;');
    expect(text).toContain('  --spacing-gap: 8px;');
    expect(text).toContain('  --color-surface-primary: #ffffff;');
    expect(text).toContain('[data-theme="dark"] {');
    expect(text).toContain('[data-theme="light-2"] {');
    expect(text).toContain('  --effect-styles-shadow-card: 0px 4px var(--effect-shadow-blur) 0px rgb(0 0 0 / 0.2);');
    expect(report.filter((r) => r.code === 'mode_selector_shared').map((r) => r.path)).toEqual(['Primitives', 'Semantic']);
  });

  it('is byte-stable across runs', () => {
    const a = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    const b = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    expect(a).toEqual(b);
  });
});
