import { describe, expect, it } from 'vitest';
import type { FoundationSpec } from '@spec-layer/extractor';
import {
  componentWritingGaps, sectionWritingGaps, foundationWritingGaps, valueLabel, gapSummary, WRITING_SECTIONS,
} from '../src/writingGaps';

describe('componentWritingGaps', () => {
  it('names an empty description and each slot without one', () => {
    const gaps = componentWritingGaps({
      id: '1:1', name: 'Card', description: '  ',
      componentPropertyDefinitions: {
        'Content#1:2': { type: 'SLOT', description: null },
        'Footer#1:3': { type: 'SLOT', description: 'What sits under the body.' },
        'Size': { type: 'VARIANT' },
        'Label#1:4': { type: 'TEXT' },
      },
    });
    expect(gaps).toEqual([
      { kind: 'component', id: '1:1', name: 'Card' },
      { kind: 'slot', id: '1:1', propertyName: 'Content#1:2', name: 'Card / Content' },
    ]);
  });
  it('counts text Annotate wrote as filled', () => {
    expect(componentWritingGaps({ id: '1:1', name: 'Card', description: 'Card groups content.\n\nWritten by Spec Layer.' })).toEqual([]);
  });
});

describe('sectionWritingGaps', () => {
  it('lists only unwritten sections that are still ticked on, in section order', () => {
    const gaps = sectionWritingGaps('doc-1', ['keyboard', 'definition', 'variants'], ['definition', 'keyboard', 'anatomy']);
    expect(gaps.map((g) => g.sectionId)).toEqual(['definition', 'keyboard']);
    expect(gaps[0]).toEqual({ kind: 'section', id: 'doc-1', sectionId: 'definition', name: 'Overview' });
  });
  it('is empty when the link predates the field', () => {
    expect(sectionWritingGaps('doc-1', undefined, ['definition'])).toEqual([]);
  });
  it('never lists a section that is not a writing section', () => {
    expect(WRITING_SECTIONS).toEqual(['definition', 'whenToUse', 'dosDonts', 'keyboard']);
    expect(sectionWritingGaps('doc-1', ['anatomy'], ['anatomy'])).toEqual([]);
  });
});

function spec(): FoundationSpec {
  return {
    fileKey: 'f', collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
      variables: [
        { name: 'color/surface/primary', group: 'color', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: { m1: { kind: 'color', hex: '#FFFFFF', alpha: 1 }, m2: { kind: 'color', hex: '#111111', alpha: 1 } },
          provenance: { id: 'V1', valuesByMode: {}, scopes: ['ALL_FILLS'] } as never },
        { name: 'space/md', group: 'space', resolvedType: 'FLOAT', description: 'Medium gap.', codeSyntax: {},
          valuesByMode: { m1: { kind: 'number', value: 16 }, m2: { kind: 'number', value: 16 } },
          provenance: { id: 'V2', valuesByMode: {}, scopes: [] } as never },
      ],
    }],
    textStyles: [{ id: 'S1', name: 'Body/Medium', group: 'Body', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 }, paragraphSpacing: 0, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {} } as never],
    effectStyles: [{ id: 'E1', name: 'Shadow/Low', group: 'Shadow', description: 'Resting elevation.', effects: [] } as never],
    extractedAt: '2026-10-19T00:00:00.000Z',
  } as FoundationSpec;
}

describe('foundationWritingGaps', () => {
  it('lists blank variables in a collection scope with one value per mode', () => {
    const gaps = foundationWritingGaps(spec(), { target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: [] });
    expect(gaps).toEqual([{ kind: 'variable', id: 'V1', name: 'color/surface/primary', facts: ['Light = #FFFFFF', 'Dark = #111111'] }]);
  });
  it('honours a group within a collection', () => {
    expect(foundationWritingGaps(spec(), { target: 'collection', collectionId: 'c1', collectionName: 'Semantic', group: 'space', modeIds: [] })).toEqual([]);
  });
  it('lists blank styles for a style scope and nothing for the other family', () => {
    expect(foundationWritingGaps(spec(), { target: 'textStyles' })).toEqual([{ kind: 'style', id: 'S1', name: 'Body/Medium', facts: ['typography'] }]);
    expect(foundationWritingGaps(spec(), { target: 'effectStyles' })).toEqual([]);
  });
  it('claims nothing without a scope', () => {
    expect(foundationWritingGaps(spec(), undefined)).toEqual([]);
  });
});

describe('valueLabel', () => {
  it('renders each value kind without inventing', () => {
    expect(valueLabel({ kind: 'color', hex: '#FFFFFF', alpha: 1 })).toBe('#FFFFFF');
    expect(valueLabel({ kind: 'color', hex: '#FFFFFF', alpha: 0.5 })).toBe('#FFFFFF 50%');
    expect(valueLabel({ kind: 'number', value: 16 })).toBe('16');
    expect(valueLabel({ kind: 'string', value: 'Inter' })).toBe('Inter');
    expect(valueLabel({ kind: 'boolean', value: true })).toBe('true');
    expect(valueLabel({ kind: 'alias', targetName: 'color/neutral/0', targetCollection: 'Primitives', external: false, resolved: { kind: 'color', hex: '#FFFFFF', alpha: 1 } })).toBe('#FFFFFF (color/neutral/0)');
    expect(valueLabel({ kind: 'alias', targetName: 'x', targetCollection: 'y', external: true, resolved: null })).toBe('x');
    expect(valueLabel({ kind: 'unresolved', reason: 'missing' })).toBe('Not resolved');
  });
});

describe('gapSummary', () => {
  it('counts descriptions and sections in words', () => {
    expect(gapSummary([{ kind: 'variable', id: 'a', name: 'a' }, { kind: 'slot', id: 'b', name: 'b' }, { kind: 'section', id: 'c', name: 'c' }])).toBe('2 descriptions and 1 section to write');
    expect(gapSummary([{ kind: 'component', id: 'a', name: 'a' }])).toBe('1 description to write');
    expect(gapSummary([{ kind: 'section', id: 'a', name: 'a' }, { kind: 'section', id: 'b', name: 'b' }])).toBe('2 sections to write');
    expect(gapSummary([])).toBe('');
  });
});
