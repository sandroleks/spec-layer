import { describe, it, expect } from 'vitest';
import { extractProps, extractVariants, extractStates } from '../src/props';
import button from './fixtures/button.json';
import chip from './fixtures/chip.json';
import type { SerializedNode } from '../src/tree';

const root = button as SerializedNode;

describe('props/variants/states', () => {
  it('extracts all property kinds', () => {
    const props = extractProps(root);
    expect(props).toContainEqual({ name: 'Style', kind: 'variant', options: ['Filled', 'Outlined'], default: 'Filled' });
    expect(props).toContainEqual({ name: 'Show icon', kind: 'boolean', options: undefined, default: false });
    expect(props.find((p) => p.name === 'Label')?.kind).toBe('text');
  });

  it('builds the variant matrix from variant props only', () => {
    expect(extractVariants(root)).toEqual([
      { prop: 'Style', values: ['Filled', 'Outlined'] },
      { prop: 'State', values: ['Enabled', 'Hovered', 'Disabled'] },
    ]);
  });

  it('derives states from a variant axis named State (case-insensitive)', () => {
    // Order now comes from detectStateMatrix's conventional lifecycle ranking
    // (STATE_ORDER in statesMatrix.ts), not axis declaration order. "Hovered"
    // isn't in that vocabulary (only "hover" is), so it trails "Disabled",
    // which is.
    expect(extractStates(root)).toEqual(['Enabled', 'Disabled', 'Hovered']);
  });

  it('falls back to ["Default"] when no state axis exists', () => {
    const noState: SerializedNode = { ...root, propertyDefinitions: { Style: root.propertyDefinitions!['Style'] } };
    expect(extractStates(noState)).toEqual(['Default']);
  });

  it('recognises plural axis name "States" (bug 1)', () => {
    expect(extractStates(chip as SerializedNode)).toEqual(['Default', 'Hover', 'Focus', 'Press']);
  });
});

describe('extractStates agrees with the states matrix', () => {
  const setWith = (prop: string, values: string[]): SerializedNode => ({
    id: 'r', name: 'Chip', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: { [prop]: { type: 'VARIANT', variantOptions: values } },
    children: [{ id: 'v0', name: `${prop}=${values[0]}`, type: 'COMPONENT', visible: true }],
  });

  it('recognizes a Status axis', () => {
    expect(extractStates(setWith('Status', ['Enabled', 'Hover', 'Disabled'])))
      .toEqual(['Enabled', 'Hover', 'Disabled']);
  });

  it('recognizes a differently-named axis whose values are state words', () => {
    expect(extractStates(setWith('Interaction', ['Rest', 'Hover', 'Pressed'])))
      .toEqual(['Rest', 'Hover', 'Pressed']);
  });

  it('still handles a plain State axis', () => {
    expect(extractStates(setWith('State', ['Default', 'Hover']))).toEqual(['Default', 'Hover']);
  });

  it('falls back to Default when no axis is state-like', () => {
    expect(extractStates(setWith('Size', ['S', 'M']))).toEqual(['Default']);
  });
});
