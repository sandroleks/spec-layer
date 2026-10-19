import { describe, expect, it } from 'vitest';
import type { FoundationSpec, SpecHashProjection } from '@spec-layer/extractor';
import { briefFor } from '../src/ui/writingBriefs';

function spec(): FoundationSpec {
  return {
    fileKey: 'f', extractedAt: '2026-10-19T00:00:00.000Z',
    collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
      variables: [
        { name: 'color/surface/primary', group: 'color', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: {
            m1: { kind: 'alias', targetName: 'base/white', targetCollection: 'Base', resolved: { kind: 'color', hex: '#FFFFFF', alpha: 1 } },
            m2: { kind: 'alias', targetName: 'base/white', targetCollection: 'Base', resolved: { kind: 'color', hex: '#FFFFFF', alpha: 1 } },
          },
          provenance: { id: 'V1', valuesByMode: {}, scopes: ['ALL_FILLS'] } },
        { name: 'color/text', group: 'color', resolvedType: 'COLOR', description: '', codeSyntax: {},
          valuesByMode: {
            m1: { kind: 'color', hex: '#111111', alpha: 1 },
            m2: { kind: 'alias', targetName: 'base/white', targetCollection: 'Base', resolved: { kind: 'color', hex: '#FFFFFF', alpha: 1 } },
          },
          provenance: { id: 'V2', valuesByMode: {}, scopes: [] } },
      ],
    }],
    textStyles: [{ id: 'S1', name: 'Body/Medium', group: 'Body', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 }, paragraphSpacing: 0, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {} }],
    effectStyles: [{ id: 'E1', name: 'Shadow/Low', group: 'Shadow', description: '', effects: [{}, {}] as never }],
  } as unknown as FoundationSpec;
}

function projection(): SpecHashProjection {
  return {
    name: 'Card', figmaKey: 'k', figmaFile: 'f', figmaNode: '1:1', description: '', anatomyComponentId: '1:1',
    anatomy: [],
    props: [
      { name: 'Size', kind: 'variant', options: ['S', 'M'] },
      { name: 'Content', kind: 'slot', slot: { preferred: ['Icon', null, 'Badge'] } },
    ],
    variants: [{ prop: 'Size', values: ['S', 'M'] }],
    variantInstances: [{ nodeId: '1:2', name: 'Size=S', values: { Size: 'S' } }, { nodeId: '1:3', name: 'Size=M', values: { Size: 'M' } }],
    states: ['Default'], tokens: [], related: [], gaps: [], layout: [],
  } as SpecHashProjection;
}

describe('briefFor', () => {
  it('names the alias target when every mode aliases the same token', () => {
    expect(briefFor({ kind: 'variable', id: 'V1', name: 'color/surface/primary' }, { foundation: spec() })).toEqual({
      key: 'variable:V1', kind: 'variable', name: 'color/surface/primary', type: 'COLOR',
      values: ['Light = #FFFFFF (base/white)', 'Dark = #FFFFFF (base/white)'],
      scopes: ['ALL_FILLS'], aliasOf: 'base/white',
    });
    expect(briefFor({ kind: 'variable', id: 'V2', name: 'color/text' }, { foundation: spec() }).aliasOf).toBeUndefined();
  });

  it('lists only the doc\'s scoped modes, and an alias within them', () => {
    const brief = briefFor({ kind: 'variable', id: 'V2', name: 'color/text' }, {
      foundation: spec(),
      scope: { target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: ['m2'] },
    });
    expect(brief.values).toEqual(['Dark = #FFFFFF (base/white)']);
    expect(brief.aliasOf).toBe('base/white');
    expect(brief.scopes).toBeUndefined();
  });

  it('describes a typography style by its font', () => {
    expect(briefFor({ kind: 'style', id: 'S1', name: 'Body/Medium', facts: ['typography'] }, { foundation: spec() })).toEqual({
      key: 'style:S1', kind: 'style', name: 'Body/Medium', type: 'typography', facts: ['Font: Inter Regular, 16px'],
    });
  });

  it('describes an effect style by its layer count', () => {
    expect(briefFor({ kind: 'style', id: 'E1', name: 'Shadow/Low', facts: ['effect'] }, { foundation: spec() })).toEqual({
      key: 'style:E1', kind: 'style', name: 'Shadow/Low', type: 'effect', facts: ['Effects: 2'],
    });
  });

  it('gives a component its properties and variant count from the projection', () => {
    expect(briefFor({ kind: 'component', id: '1:1', name: 'Card' }, { projection: projection() })).toEqual({
      key: 'component:1:1', kind: 'component', name: 'Card', type: 'component',
      facts: ['Properties: Size, Content', 'Variants: 2'],
    });
    expect(briefFor({ kind: 'slot', id: '1:1', propertyName: 'Content#1:2', name: 'Card / Content' }, { projection: projection() }).facts)
      .toEqual(['Properties: Size, Content', 'Variants: 2', 'Preferred components: Icon, Badge']);
  });

  it('claims nothing beyond the name without a projection or a spec', () => {
    expect(briefFor({ kind: 'component', id: '1:1', name: 'Card' })).toEqual({
      key: 'component:1:1', kind: 'component', name: 'Card', type: 'component',
    });
    expect(briefFor({ kind: 'slot', id: '1:1', propertyName: 'Content#1:2', name: 'Card / Content' })).toEqual({
      key: 'slot:1:1:Content#1:2', kind: 'slot', name: 'Card / Content', type: 'slot',
    });
    expect(briefFor({ kind: 'style', id: 'S1', name: 'Body/Medium', facts: ['typography'] })).toEqual({
      key: 'style:S1', kind: 'style', name: 'Body/Medium', type: 'typography',
    });
    expect(briefFor({ kind: 'variable', id: 'V9', name: 'x', facts: ['Light = 1'] }, { foundation: spec() })).toEqual({
      key: 'variable:V9', kind: 'variable', name: 'x', type: 'variable', values: ['Light = 1'],
    });
  });
});
