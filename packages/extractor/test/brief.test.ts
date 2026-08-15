import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { foundationBrief } from '../src/brief';
import { toYaml } from '../src/yaml';
import type { FoundationSpec } from '../src/foundation';
import type { YamlValue } from '../src/yaml';

const AT = '2026-08-14T10:22:00.000Z';

/** Shape of the parsed brief, just deep enough for these assertions. Typed
 *  rather than `any` so a shape drift fails at compile time, matching the
 *  convention in yaml.test.ts. */
interface ParsedBrief {
  collections: { tokens: Record<string, unknown>[] }[];
  text_styles: Record<string, unknown>[];
}

function parseBrief(v: YamlValue): ParsedBrief {
  return load(toYaml(v)) as ParsedBrief;
}

const FOUNDATION: FoundationSpec = {
  fileKey: 'abc123',
  extractedAt: AT,
  collections: [{
    id: 'C1',
    name: 'Color',
    modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
    defaultModeId: 'm1',
    variables: [
      {
        name: 'color/bg/brand', group: 'color', resolvedType: 'COLOR',
        description: 'Primary brand surface',
        codeSyntax: { WEB: '--color-bg-brand' },
        valuesByMode: {
          m1: { kind: 'color', hex: '#2563EB', alpha: 1 },
          m2: { kind: 'color', hex: '#3B82F6', alpha: 1 },
        },
      },
      {
        name: 'color/bg/muted', group: 'color', resolvedType: 'COLOR',
        description: '', codeSyntax: {},
        valuesByMode: {
          m1: { kind: 'alias', targetName: 'color/neutral/100', targetCollection: 'Color',
                external: false, resolved: { kind: 'color', hex: '#F5F5F5', alpha: 1 } },
          m2: { kind: 'unresolved', reason: 'external' },
        },
      },
    ],
  }],
  textStyles: [{
    name: 'Body/Regular', group: 'Body', description: '',
    fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
    lineHeight: { unit: 'PIXELS', value: 24 },
    letterSpacing: { unit: 'PERCENT', value: 0 },
    paragraphSpacing: 0, paragraphIndent: 0,
    textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {},
  }],
};

describe('foundationBrief', () => {
  it('stamps the envelope with the extractor version and brief version', () => {
    const b = foundationBrief(FOUNDATION, AT) as Record<string, Record<string, unknown>>;
    expect(b.spec_layer.kind).toBe('foundation');
    expect(b.spec_layer.version).toBe(1);
    expect(b.spec_layer.extractor).toBe('1');
  });

  it('keys mode values by mode name, not modeId', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect(y.collections[0].tokens[0].values).toEqual({ Light: '#2563EB', Dark: '#3B82F6' });
  });

  it('emits code only when codeSyntax is populated', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect(y.collections[0].tokens[0].code).toEqual({ WEB: '--color-bg-brand' });
    expect('code' in y.collections[0].tokens[1]).toBe(false);
  });

  it('gives an alias both its target and its resolved value', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect((y.collections[0].tokens[1].values as Record<string, unknown>).Light)
      .toEqual({ alias: 'color/neutral/100', resolved: '#F5F5F5' });
  });

  it('states why an unresolved value is unresolved instead of dropping it', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect((y.collections[0].tokens[1].values as Record<string, unknown>).Dark).toEqual({ unresolved: 'external' });
  });

  it('emits text styles', () => {
    const y = parseBrief(foundationBrief(FOUNDATION, AT));
    expect(y.text_styles[0]).toEqual({
      name: 'Body/Regular',
      font: { family: 'Inter', style: 'Regular', size: 16 },
      line_height: { unit: 'PIXELS', value: 24 },
      letter_spacing: { unit: 'PERCENT', value: 0 },
    });
  });

  it('is deterministic', () => {
    expect(toYaml(foundationBrief(FOUNDATION, AT))).toBe(toYaml(foundationBrief(FOUNDATION, AT)));
  });
});
