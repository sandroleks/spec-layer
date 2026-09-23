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
    // Order comes from detectStateMatrix's conventional lifecycle ranking
    // (STATE_ORDER in statesMatrix.ts). "Hovered" is recognized as the
    // participle of "hover", ranking right after it, so declaration order
    // and lifecycle order agree here.
    expect(extractStates(root)).toEqual(['Enabled', 'Hovered', 'Disabled']);
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

  it('falls back to Default when a detected state axis has no values (unreachable from real Figma data, but extractStates must not silently return [])', () => {
    expect(extractStates(setWith('State', []))).toEqual(['Default']);
  });

  // Pins the vocabulary itself, not just the delegation. STATE_ORDER stores
  // "focus" and "focused" side by side but previously stored only "hover"
  // and not "hovered" — so a declared [Enabled, Hovered, Disabled] axis
  // reordered to [Enabled, Disabled, Hovered] because "Hovered" fell into
  // the unrecognized bucket and trailed "Disabled". None of the tests above
  // exercise this: they all use "Hover", which was already recognized. This
  // test fails if "hovered" is ever removed from STATE_ORDER again.
  it('recognizes "Hovered" as the participle of the hover vocabulary word, keeping lifecycle order', () => {
    expect(extractStates(setWith('State', ['Enabled', 'Hovered', 'Disabled'])))
      .toEqual(['Enabled', 'Hovered', 'Disabled']);
  });

  // The flags encoding (boolean variant axes named as state words) is the
  // other half of detectStateMatrix's contract, documented on extractStates
  // but — until this test — never exercised through it: every other test in
  // this file hits the enum branch only.
  it('handles the flags encoding: boolean state-word axes synthesize a Default column plus one per flag, in lifecycle order', () => {
    const root: SerializedNode = {
      id: 'r', name: 'Chip', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: {
        Hover: { type: 'VARIANT', variantOptions: ['True', 'False'] },
        Disabled: { type: 'VARIANT', variantOptions: ['True', 'False'] },
        Size: { type: 'VARIANT', variantOptions: ['S', 'L'] },
      },
      children: [{ id: 'v0', name: 'v0', type: 'COMPONENT', visible: true }],
    };
    expect(extractStates(root)).toEqual(['Default', 'Hover', 'Disabled']);
  });
});
