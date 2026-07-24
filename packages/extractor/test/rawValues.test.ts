import { describe, it, expect } from 'vitest';
import { extractRawValues } from '../src/rawValues';
import type { SerializedNode } from '../src/tree';

const base = { visible: true } as const;

describe('extractRawValues', () => {
  it('emits raw layout values when the property has no binding', () => {
    const root: SerializedNode = {
      ...base, id: '1', name: 'Card', type: 'COMPONENT',
      layout: { mode: 'VERTICAL', paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, itemSpacing: 8, cornerRadius: 12 },
    };
    expect(extractRawValues(root)).toEqual([
      { part: 'Card', property: 'padding', value: '16' },
      { part: 'Card', property: 'gap', value: '8' },
      { part: 'Card', property: 'border-radius', value: '12' },
    ]);
  });

  it('collapses asymmetric padding to x/y pairs', () => {
    const root: SerializedNode = {
      ...base, id: '1', name: 'Chip', type: 'COMPONENT',
      layout: { mode: 'HORIZONTAL', paddingTop: 4, paddingBottom: 4, paddingLeft: 12, paddingRight: 12 },
    };
    expect(extractRawValues(root)).toEqual([
      { part: 'Chip', property: 'padding-x', value: '12' },
      { part: 'Chip', property: 'padding-y', value: '4' },
    ]);
  });

  it('suppresses values covered by a binding and emits unbound fills', () => {
    const root: SerializedNode = {
      ...base, id: '1', name: 'Button', type: 'COMPONENT',
      bindings: [{ property: 'itemSpacing', token: 'spacing/sm' }],
      layout: { mode: 'HORIZONTAL', itemSpacing: 8 },
      children: [
        { ...base, id: '2', name: 'label', type: 'TEXT', unboundFill: '#6750a4' },
      ],
    };
    expect(extractRawValues(root)).toEqual([
      { part: 'label', property: 'fill', value: '#6750a4' },
    ]);
  });

  it('reads only the default (first) variant of a set', () => {
    const root: SerializedNode = {
      ...base, id: '0', name: 'Set', type: 'COMPONENT_SET',
      children: [
        { ...base, id: '1', name: 'State=Default', type: 'COMPONENT', layout: { mode: 'HORIZONTAL', itemSpacing: 8 } },
        { ...base, id: '2', name: 'State=Hover', type: 'COMPONENT', layout: { mode: 'HORIZONTAL', itemSpacing: 99 } },
      ],
    };
    expect(extractRawValues(root)).toEqual([
      { part: 'Container', property: 'gap', value: '8' },
    ]);
  });
});
