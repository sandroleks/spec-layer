import { describe, expect, it } from 'vitest';
import {
  CSS_HEADER_PREFIX, CSS_INDEX_FILE, acceptCssDeclared, cssFileNames, cssOutput, dtcgSlug, foundationDtcg,
  type CssOutput, type CssSource, type DtcgDocumentExtension, type DtcgExport,
} from '../../../src/index';
import { radiusMismatchArtifact, syntheticArtifact } from '../dtcgFixture';

const HEADER = { libraryId: 'lib_test', contentHash: 'sha256:abc', platform: 'web', format: 'css' };

/** Minimal `com.spec-layer` extension for `DtcgExport` fixtures that do not exercise it. */
const EXTENSION: DtcgDocumentExtension = {
  schema_version: '5.1.0',
  content_hash: 'sha256:abc',
  config_hash: 'sha256:def',
  source: { provider: 'figma' },
  completeness: { collections: 'complete', styles: 'complete', unavailable_sources: [] },
  code_syntax: {},
  census: {},
  report: [],
};

/** Every part file joined, for assertions that do not care which file a line is in. */
const joined = (out: CssOutput): string => Object.values(out.files).join('\n');

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
    extension: EXTENSION,
    ...overrides,
  };
}

describe('cssOutput files', () => {
  it('writes one file per source, named by collection for a set and collection.mode for a modifier, plus index.css last', () => {
    const out = cssOutput(small(), HEADER);
    expect(Object.keys(out.files)).toEqual(['base.css', 'theme.light.css', 'theme.dark.css', 'index.css']);
    expect(out.files['base.css']).toContain(':root {\n  /* Base */\n');
    expect(out.files['theme.light.css']).toContain(':root {\n  /* Theme, Light */\n');
    expect(out.files['theme.dark.css']).toContain('[data-theme="dark"] {\n  /* Theme, Dark */\n');
    for (const text of Object.values(out.files)) expect(text.startsWith(CSS_HEADER_PREFIX)).toBe(true);
  });

  it('holds exactly one selector block per part file and only imports in index.css', () => {
    const out = cssOutput(small(), HEADER);
    for (const [name, text] of Object.entries(out.files)) {
      if (name === CSS_INDEX_FILE) continue;
      expect(text.match(/^\S.*\{$/gm), name).toHaveLength(1);
    }
    expect(out.files[CSS_INDEX_FILE]).toBe(
      `${CSS_HEADER_PREFIX} from library lib_test, foundation sha256:abc, web/css/kebab.\n`
      + '   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */\n\n'
      + '/* Base */\n@import "./base.css";\n'
      + '/* Theme, Light */\n@import "./theme.light.css";\n'
      + '/* Theme, Dark */\n@import "./theme.dark.css";\n',
    );
  });

  it('writes no file and no import for a source whose every token was omitted, and no index when nothing is declared', () => {
    const exp = small();
    exp.files['theme.dark.json'] = { Theme: { surface: { $type: 'color', $value: '{Base.color.missing}' } } };
    const out = cssOutput(exp, HEADER);
    expect(out.files['theme.dark.css']).toBeUndefined();
    expect(out.files[CSS_INDEX_FILE]).not.toContain('theme.dark.css');
    expect(out.report.some((r) => r.code === 'reference_target_omitted' && r.mode === 'Dark')).toBe(true);

    const empty: DtcgExport = { ...small(), files: { 'base.default.json': { Base: {} }, 'theme.light.json': {}, 'theme.dark.json': {} } };
    expect(cssOutput(empty, HEADER).files).toEqual({});
  });

  it('records in the map the file that first declares each name, the default context for a modifier', () => {
    const out = cssOutput(small(), HEADER);
    expect(out.map['Base.color.red']).toEqual({ name: '--red', source: 'code_syntax', file: 'base.css' });
    expect(out.map['Theme.surface']).toEqual({ name: '--theme-surface', source: 'derived', file: 'theme.light.css' });
    for (const entry of Object.values(out.map)) expect(out.files[entry.file], entry.file).toBeDefined();
  });

  it('keeps var() across files valid: every reference names a property declared in some file', () => {
    const out = cssOutput(small(), HEADER);
    const declared = new Set([...joined(out).matchAll(/^\s+(--[^:]+):/gm)].map((m) => m[1]));
    for (const m of joined(out).matchAll(/var\((--[^),\s]+)/g)) expect(declared.has(m[1]), m[1]).toBe(true);
  });
});

describe('cssFileNames', () => {
  const set = (collection: string, file: string): CssSource => ({ collection, mode: null, file, isDefault: true });
  const ctx = (collection: string, mode: string, file: string, isDefault: boolean): CssSource => ({ collection, mode, file, isDefault });

  it('slugs the resolver label for a set and appends the DTCG mode slug for a modifier context', () => {
    const names = cssFileNames([
      set('Effect styles', 'styles.effects.json'),
      set('Foundation', 'foundation.mode-1.json'),
      ctx('Semantic Colors', 'Light', 'semantic-colors.light.json', true),
      ctx('Semantic Colors', 'Dark', 'semantic-colors.dark.json', false),
    ]);
    expect([...names.entries()]).toEqual([
      ['styles.effects.json', 'effect-styles.css'],
      ['foundation.mode-1.json', 'foundation.css'],
      ['semantic-colors.light.json', 'semantic-colors.light.css'],
      ['semantic-colors.dark.json', 'semantic-colors.dark.css'],
    ]);
  });

  it('reserves index.css and suffixes collisions in source order', () => {
    const names = cssFileNames([
      set('Index', 'index.mode-1.json'),
      set('Base', 'base.default.json'),
      set('base', 'base-2.default.json'),
      set('***', 'unnamed.default.json'),
    ]);
    expect([...names.values()]).toEqual(['index-2.css', 'base.css', 'base-2.css', 'unnamed.css']);
  });
});

describe('acceptCssDeclared', () => {
  it('accepts a custom property, prefixes a bare identifier, rejects anything else', () => {
    expect(acceptCssDeclared('--colors-blue-500')).toBe('--colors-blue-500');
    expect(acceptCssDeclared('colorsBlue500')).toBe('--colorsBlue500');
    expect(acceptCssDeclared('theme.colors.blue500')).toBeNull();
    expect(acceptCssDeclared('--has space')).toBeNull();
  });
});

describe('cssOutput values', () => {
  const text = joined(cssOutput(small(), HEADER));

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
    // Base and Theme's default context each land at :root, but in their own
    // file now, so each gets its own :root block rather than sharing one.
    expect(text).toContain(':root {\n  /* Base */');
    expect(text).toContain(':root {\n  /* Theme, Light */');
    expect(text).toContain('  --theme-surface: var(--red);');
    const dark = text.slice(text.indexOf('[data-theme="dark"] {'));
    expect(dark).toContain('  /* Theme, Dark */');
    expect(dark).toContain('  --theme-surface: var(--base-color-glass);');
    expect(text.indexOf(':root {')).toBeLessThan(text.indexOf('[data-theme="dark"] {'));
  });

  it('passes legacy string values through verbatim', () => {
    const legacy = small({
      files: { ...small().files, 'base.default.json': { Base: { c: { $type: 'color', $value: '#11223380' }, d: { $type: 'dimension', $value: '1rem' } } } },
    });
    const out = joined(cssOutput(legacy, HEADER));
    expect(out).toContain('  --base-c: #11223380;');
    expect(out).toContain('  --base-d: 1rem;');
  });
});

describe('cssOutput comments', () => {
  it('keeps a collection or mode name from closing the comment it is written in', () => {
    const evil = 'Brand */ * { display: none } /*';
    const exp = small();
    exp.files['evil.default.json'] = { [evil]: { ink: color('#000000') } };
    exp.resolver.sets[evil] = { sources: [{ $ref: 'evil.default.json' }] };
    exp.resolver.resolutionOrder.push({ $ref: `#/sets/${evil}` });
    const text = joined(cssOutput(exp, { ...HEADER, libraryId: 'lib_x */ body { display: none } /*' }));
    // The name's `*/` no longer closes the comment, so the rule stays inside it.
    expect(text).not.toContain('Brand */');
    expect(text).toContain('  /* Brand * / * { display: none } /* */');
    expect(text).toContain('from library lib_x * / body { display: none } /*, foundation');
  });
});

describe('cssOutput names, modes, and reports', () => {
  it('records provenance for every emitted name', () => {
    const { map } = cssOutput(small(), HEADER);
    expect(map['Base.color.red']).toEqual({ name: '--red', source: 'code_syntax', file: 'base.css' });
    expect(map['Base.space.gap']).toEqual({ name: '--gap', source: 'code_syntax', file: 'base.css' });
    expect(map['Theme.surface']).toEqual({ name: '--theme-surface', source: 'derived', file: 'theme.light.css' });
  });

  it('applies the chosen case to derived names only', () => {
    const out = cssOutput(small(), HEADER, { case: 'camel' });
    const text = joined(out);
    const { map } = out;
    expect(text).toContain('  --themeSurface: var(--red);');
    expect(text).toContain('web/css/camel.');
    expect(map['Base.color.red'].name).toBe('--red');
  });

  it('omits a reference whose target was omitted and reports it', () => {
    const exp = small();
    exp.files['theme.light.json'] = { Theme: { surface: { $type: 'color', $value: '{Base.color.missing}' } } };
    const out = cssOutput(exp, HEADER);
    const text = joined(out);
    const { report } = out;
    expect(text).not.toContain('--theme-surface: var(--base-color-missing)');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'reference_target_omitted', path: 'Theme.surface', mode: 'Light', details: { target: 'Base.color.missing' },
    }));
  });

  it('honours root, modeSelector, {collection}, and a per-collection selector', () => {
    const text = joined(cssOutput(small(), HEADER, {
      root: 'html', modeSelector: '.{collection}-{mode}',
    }));
    expect(text).toContain('html {');
    expect(text).toContain('.theme-dark {');
    const per = joined(cssOutput(small(), HEADER, { modes: { Theme: '[data-mode="{mode}"]' } }));
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
    extension: EXTENSION,
  };
  const styledOut = cssOutput(styled, HEADER);
  const text = joined(styledOut);
  const { report } = styledOut;

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

  it('maps a typography member by its member path, and never the style path itself', () => {
    const { map } = cssOutput(styled, HEADER);
    expect(map['Typography styles.Body.fontSize']).toEqual({ name: '--typography-styles-body-font-size', source: 'derived', file: 'typography-styles.css' });
    expect(map).not.toHaveProperty('Typography styles.Body');
    expect(map).not.toHaveProperty('Effect styles.Blur');
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

describe('cssOutput names match declared properties', () => {
  it('omits a token whose value cannot be expressed, and a token that references it, with no var() to an undeclared property', () => {
    const exp: DtcgExport = {
      files: {
        'base.default.json': {
          Base: {
            bad: { $type: 'color', $value: { colorSpace: 'srgb' } },
            ref: { $type: 'color', $value: '{Base.bad}' },
          },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { Base: { sources: [{ $ref: 'base.default.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Base' }],
      },
      meta: {},
      report: [],
      extension: EXTENSION,
    };
    const out = cssOutput(exp, HEADER);
    const text = joined(out);
    const { map, report } = out;
    expect(map).not.toHaveProperty('Base.bad');
    expect(map).not.toHaveProperty('Base.ref');
    expect(text).not.toMatch(/var\(--base-bad\)/);
    expect(text).not.toContain('--base-ref:');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'not_expressible', path: 'Base.bad',
    }));
    expect(report).toContainEqual(expect.objectContaining({
      code: 'reference_target_omitted', path: 'Base.ref', details: { target: 'Base.bad' },
    }));
  });

  it('omits both sides of a member/token name collision and reports name_collision for both paths', () => {
    // Two sources of one set: a token at Body.font.size, and a typography style at
    // Body whose fontSize member derives the same kebab name ("font"+"Size" split
    // the same way as "font"+"size"). Different files, so no structural conflict
    // in either tree; the collision is purely in the derived name.
    const exp: DtcgExport = {
      files: {
        'base.default.json': {
          'Typography styles': { Body: { font: { size: { $type: 'dimension', $value: { value: 20, unit: 'px' } } } } },
        },
        'styles.typography.json': {
          'Typography styles': { Body: { $type: 'typography', $value: { fontSize: { value: 16, unit: 'px' } } } },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { 'Typography styles': { sources: [{ $ref: 'base.default.json' }, { $ref: 'styles.typography.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Typography styles' }],
      },
      meta: {},
      report: [],
      extension: EXTENSION,
    };
    const { map, report } = cssOutput(exp, HEADER);
    expect(map).not.toHaveProperty('Typography styles.Body.font.size');
    expect(map).not.toHaveProperty('Typography styles.Body.fontSize');
    const collisions = report.filter((r) => r.code === 'name_collision');
    expect(collisions.map((r) => r.path).sort()).toEqual(['Typography styles.Body.font.size', 'Typography styles.Body.fontSize']);
  });

  it('registers a typography member path only when the leaf would emit it', () => {
    // Cap carries only fontSize, so it never emits fontFamily; a real token at
    // Cap.font.family derives the identical kebab name ("font"+"family" split
    // the same way as "fontFamily") but must not collide with a member Cap
    // was never going to declare.
    const exp: DtcgExport = {
      files: {
        'base.default.json': {
          'Typography styles': { Cap: { font: { family: { $type: 'fontFamily', $value: 'Georgia' } } } },
        },
        'styles.typography.json': {
          'Typography styles': { Cap: { $type: 'typography', $value: { fontSize: { value: 12, unit: 'px' } } } },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { 'Typography styles': { sources: [{ $ref: 'base.default.json' }, { $ref: 'styles.typography.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Typography styles' }],
      },
      meta: {},
      report: [],
      extension: EXTENSION,
    };
    const out = cssOutput(exp, HEADER);
    const text = joined(out);
    const { map, report } = out;
    expect(map).toHaveProperty('Typography styles.Cap.font.family');
    expect(map).not.toHaveProperty('Typography styles.Cap.fontFamily');
    expect(text).toContain('  --typography-styles-cap-font-family: "Georgia";');
    expect(report.some((r) => r.code === 'name_collision')).toBe(false);
  });
});

describe('cssOutput on the synthetic foundation', () => {
  it('emits the declared names, the duplicate mode slug, and the shared-selector report', () => {
    const out = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    const text = joined(out);
    const { report } = out;
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

describe('cssOutput reports unitless numbers', () => {
  it('reports a number-typed token as unusable for a CSS length', () => {
    const exp: DtcgExport = {
      files: {
        'foundation.default.json': {
          Foundation: { spacing: { 400: { $type: 'number', $value: 16 } } },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { Foundation: { sources: [{ $ref: 'foundation.default.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Foundation' }],
      },
      meta: {
        'Foundation.spacing.400': { id: 'v1', collection_id: 'c1', type: 'number', scopes: [], code_syntax: { WEB: 'spacing-400' } },
      },
      report: [],
      extension: EXTENSION,
    };
    const out = cssOutput(exp, HEADER);
    const text = joined(out);

    expect(text).toContain('--spacing-400: 16;'); // still emitted, never suppressed

    const entry = out.report.find((r) => r.code === 'unitless_number');
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe('warning');
    expect(entry?.path).toBe('Foundation.spacing.400');
    expect(entry?.message).toContain('dtcg');
  });

  it('does not report a font weight as unitless', () => {
    const exp: DtcgExport = {
      files: {
        'foundation.default.json': {
          Foundation: { typography: { 'font-weight': { 'fw-600': { $type: 'fontWeight', $value: 600 } } } },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { Foundation: { sources: [{ $ref: 'foundation.default.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Foundation' }],
      },
      meta: {},
      report: [],
      extension: EXTENSION,
    };
    const { report } = cssOutput(exp, HEADER);
    expect(report.find((r) => r.code === 'unitless_number')).toBeUndefined();
  });

  it('emits a typography lineHeight ratio and does not report it as unitless', () => {
    // Figma carries a style's line-height unit per style, not per variable:
    // a PIXELS line-height would arrive as a `dimension` and never reach the
    // `number` branch at all. A bare ratio here (no unit stated, because
    // none applies) is valid CSS on its own, unlike a length with no unit.
    const exp: DtcgExport = {
      files: {
        'styles.typography.json': {
          'Typography styles': {
            Caps: { $type: 'typography', $value: { fontSize: { value: 12, unit: 'px' }, lineHeight: 1.2 } },
          },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { 'Typography styles': { sources: [{ $ref: 'styles.typography.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Typography styles' }],
      },
      meta: {},
      report: [],
      extension: EXTENSION,
    };
    const out = cssOutput(exp, HEADER);
    const text = joined(out);

    expect(text).toContain('  --typography-styles-caps-line-height: 1.2;');
    expect(out.report.find((r) => r.code === 'unitless_number')).toBeUndefined();
  });

  it('emits a real length for a scoped alias whose target is unitless, and does not report it', () => {
    // End to end, on the fixture dtcg.test.ts already reviews Task 1's repair
    // against: Radius.rd-sm is CORNER_RADIUS-scoped and aliases
    // Foundation.radius.300, which carries no scope of its own and so is
    // itself a bare number. Task 1 repairs rd-sm's DTCG leaf to a resolved
    // literal instead of leaving `$value: '{Foundation.radius.300}'`. Without
    // that repair, cssValue's reference branch would resolve the surviving
    // alias to `var(--foundation-radius-300)` -- a valid-looking custom
    // property that itself holds a bare, CSS-invalid number -- instead of
    // writing `8px` directly, so a regression here fails the first assertion.
    const out = cssOutput(foundationDtcg(radiusMismatchArtifact()), HEADER);
    const text = joined(out);

    // Radius.rd-sm keeps the code_syntax ("--spacing-gap") the underlying
    // fixture token already declared; what matters is the value, not the name.
    expect(text).toContain('--spacing-gap: 8px;');
    expect(text).not.toMatch(/--spacing-gap:\s*var\(/);

    // Foundation.radius.300 itself is genuinely unitless (Figma states no
    // scope for it) in every mode it appears in, and is reported as such;
    // Radius.rd-sm, now a real dimension, never is.
    const unitless = out.report.filter((r) => r.code === 'unitless_number');
    expect(unitless.length).toBeGreaterThan(0);
    expect(unitless.every((r) => r.path === 'Foundation.radius.300')).toBe(true);
  });

  it('notes the unitless properties in the header of the file that declares them', () => {
    const exp: DtcgExport = {
      files: {
        'foundation.default.json': {
          Foundation: { spacing: { 400: { $type: 'number', $value: 16 } } },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { Foundation: { sources: [{ $ref: 'foundation.default.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Foundation' }],
      },
      meta: {
        'Foundation.spacing.400': { id: 'v1', collection_id: 'c1', type: 'number', scopes: [], code_syntax: { WEB: 'spacing-400' } },
      },
      report: [],
      extension: EXTENSION,
    };
    const out = cssOutput(exp, HEADER);
    // This fixture declares exactly one unitless property (Foundation.spacing.400);
    // the count in the header must match, not just be present.
    expect(out.files['foundation.css']).toBe(
      `${CSS_HEADER_PREFIX} from library lib_test, foundation sha256:abc, web/css/kebab.\n`
      + '   Do not edit. Change the design in Figma, republish, and run spec-layer pull.\n'
      + '   1 properties in this file have no unit, because the Figma variable states none.\n'
      + '   CSS cannot use them as a length. See the output report, or declare units in speclayer.json. */\n\n'
      + ':root {\n  /* Foundation */\n  --spacing-400: 16;\n}\n',
    );
    // index.css never declares a property itself, so it never carries the note.
    expect(out.files[CSS_INDEX_FILE]).not.toContain('have no unit');
  });

  it('counts every distinct unitless token path in the file, not just whether one exists', () => {
    const exp: DtcgExport = {
      files: {
        'foundation.default.json': {
          Foundation: {
            spacing: { 400: { $type: 'number', $value: 16 }, 800: { $type: 'number', $value: 32 } },
          },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { Foundation: { sources: [{ $ref: 'foundation.default.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Foundation' }],
      },
      meta: {},
      report: [],
      extension: EXTENSION,
    };
    const out = cssOutput(exp, HEADER);
    expect(out.files['foundation.css']).toContain(
      '   2 properties in this file have no unit, because the Figma variable states none.\n'
      + '   CSS cannot use them as a length. See the output report, or declare units in speclayer.json.',
    );
  });

  it('leaves the header alone when every value in the file carries a unit', () => {
    const exp: DtcgExport = {
      files: {
        'foundation.default.json': {
          Foundation: { typography: { 'font-size': { 'fs-300': { $type: 'dimension', $value: { value: 14, unit: 'px' } } } } },
        },
      },
      resolver: {
        version: '2025.10',
        sets: { Foundation: { sources: [{ $ref: 'foundation.default.json' }] } },
        modifiers: {},
        resolutionOrder: [{ $ref: '#/sets/Foundation' }],
      },
      meta: {},
      report: [],
      extension: EXTENSION,
    };
    const out = cssOutput(exp, HEADER);
    expect(out.files['foundation.css']).toBe(
      `${CSS_HEADER_PREFIX} from library lib_test, foundation sha256:abc, web/css/kebab.\n`
      + '   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */\n\n'
      + ':root {\n  /* Foundation */\n  --foundation-typography-font-size-fs-300: 14px;\n}\n',
    );
    expect(out.files['foundation.css']).not.toContain('have no unit');
  });
});

describe('dtcgSlug', () => {
  it('lowercases, collapses non-alphanumeric runs to a dash, and trims the ends', () => {
    expect(dtcgSlug('  Semantic Colors ')).toBe('semantic-colors');
  });

  it('falls back to "unnamed" when nothing but dashes survives', () => {
    expect(dtcgSlug('---')).toBe('unnamed');
  });

  it('trims a single leading and trailing dash', () => {
    expect(dtcgSlug('-a-')).toBe('a');
  });

  it('handles a plain multi-word name', () => {
    expect(dtcgSlug('Effect styles')).toBe('effect-styles');
  });

  it('completes in linear time on a long run of dashes before a character', () => {
    const input = '-'.repeat(20000) + 'x';
    expect(dtcgSlug(input)).toBe('x');
  });
});
