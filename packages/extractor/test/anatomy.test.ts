import { describe, it, expect } from 'vitest';
import { extractAnatomy, defaultVariant } from '../src/anatomy';
import button from './fixtures/button.json';
import chip from './fixtures/chip.json';
import type { SerializedNode } from '../src/tree';

describe('extractAnatomy', () => {
  const result = extractAnatomy(button as SerializedNode);

  it('lists visible named parts of the default variant', () => {
    expect(result.parts.map((p) => p.name)).toEqual(['container', 'label', 'icon']);
  });

  it('marks instances as nested and surfaces them as related atoms', () => {
    expect(result.parts.find((p) => p.name === 'icon')?.nested).toBe(true);
    expect(result.related).toEqual(['Icon']);
  });

  it('excludes invisible layers', () => {
    expect(result.parts.find((p) => p.name === 'debug-overlay')).toBeUndefined();
  });

  it('carries each part node id and the default-variant component id', () => {
    // The doc frame resolves geometry live from these ids to place its callout
    // pins, so every part must carry a non-empty id and the result must point at
    // the screenshotted default variant.
    expect(result.parts.every((p) => typeof p.id === 'string' && p.id.length > 0)).toBe(true);
    expect(result.componentId).toBe(defaultVariant(button as SerializedNode).id);
  });
});

describe('extractAnatomy — single-wrapper descent (bug 2)', () => {
  const chipResult = extractAnatomy(chip as SerializedNode);

  it('does not list the sole wrapper frame as a part', () => {
    expect(chipResult.parts.map((p) => p.name)).not.toContain('Contents');
  });

  // A leading and a trailing icon both named "icon" are two real parts with
  // two real node ids (and, in this fixture, distinct bindings once resolved
  // through tokens.ts) — they are numbered rather than collapsed.
  it('lists both same-named icon instances, numbered rather than deduped', () => {
    expect(chipResult.parts.map((p) => p.name)).toEqual(['icon', 'Label', 'icon (2)']);
  });

  it('collects related atoms from inside the wrapper', () => {
    expect(chipResult.related).toEqual(['Icon']);
  });

  it('lists both same-named siblings instead of dropping the second', () => {
    const set: SerializedNode = {
      id: 'root', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      children: [{
        id: 'v0', name: 'Style=Filled', type: 'COMPONENT', visible: true,
        children: [
          { id: 'a', name: 'icon', type: 'FRAME', visible: true },
          { id: 'b', name: 'label', type: 'TEXT', visible: true },
          { id: 'c', name: 'icon', type: 'FRAME', visible: true },
        ],
      }],
    };
    expect(extractAnatomy(set).parts.map((p) => p.name)).toEqual(['icon', 'label', 'icon (2)']);
  });
});

describe('extractAnatomy — collision at nested depth', () => {
  it('numbers a same-named part independently at each nesting depth', () => {
    // Top-level "label" and the "label" nested inside "meta" must not collide
    // with each other: siblingPartNames numbers within ONE parent's children
    // at a time (addParts calls it fresh per recursive call), so a name
    // repeating at a different depth stays unnumbered at each level.
    const root: SerializedNode = {
      id: '1', name: 'Card', type: 'COMPONENT', visible: true,
      children: [
        { id: 'a', name: 'label', type: 'TEXT', visible: true },
        {
          id: 'b', name: 'meta', type: 'FRAME', visible: true,
          children: [{ id: 'c', name: 'label', type: 'TEXT', visible: true }],
        },
      ],
    };
    const { parts } = extractAnatomy(root);
    expect(parts.map((p) => [p.name, p.depth])).toEqual([
      ['label', 0], ['meta', 0], ['label', 1],
    ]);
  });
});

describe('extractAnatomy — bounded depth-first walk (Task 7)', () => {
  it('walks up to 3 levels, depth-first, recording depth', () => {
    const root: SerializedNode = {
      id: '1', name: 'Card', type: 'COMPONENT', visible: true,
      children: [
        {
          id: '2', name: 'header', type: 'FRAME', visible: true,
          children: [
            { id: '3', name: 'title', type: 'TEXT', visible: true },
            {
              id: '4', name: 'meta', type: 'FRAME', visible: true,
              children: [
                { id: '5', name: 'timestamp', type: 'TEXT', visible: true,
                  children: [{ id: '6', name: 'too-deep', type: 'TEXT', visible: true }] },
              ],
            },
          ],
        },
        { id: '7', name: 'body', type: 'TEXT', visible: true },
      ],
    };
    const { parts } = extractAnatomy(root);
    expect(parts.map((p) => [p.name, p.depth])).toEqual([
      ['header', 0], ['title', 1], ['meta', 1], ['timestamp', 2], ['body', 0],
    ]);
  });

  it('stops at nested component boundaries and records the component name', () => {
    const root: SerializedNode = {
      id: '1', name: 'Field', type: 'COMPONENT', visible: true,
      children: [
        {
          id: '2', name: 'icon', type: 'INSTANCE', visible: true,
          mainComponent: { name: 'Icon/Search', key: 'k' },
          children: [{ id: '3', name: 'vector', type: 'VECTOR', visible: true }],
        },
      ],
    };
    const { parts } = extractAnatomy(root);
    expect(parts).toEqual([
      { id: '2', name: 'icon', path: 'Field/icon', type: 'INSTANCE', nested: true, depth: 0, component: 'Icon/Search' },
    ]);
  });
});

describe('extractAnatomy — empty-wrapper guard (I-1)', () => {
  // A COMPONENT_SET whose default variant's sole child is an empty FRAME.
  // Expected: anatomy lists the wrapper itself rather than returning an empty array.
  const emptyWrapperNode: SerializedNode = {
    id: '20:1',
    name: 'EmptyComp',
    type: 'COMPONENT_SET',
    visible: true,
    children: [
      {
        id: '20:2',
        name: 'State=Default',
        type: 'COMPONENT',
        visible: true,
        children: [
          {
            id: '20:3',
            name: 'EmptyWrapper',
            type: 'FRAME',
            visible: true,
            children: [],
          },
        ],
      },
    ],
  };

  it('falls back to the wrapper itself when it has no visible children', () => {
    expect(extractAnatomy(emptyWrapperNode).parts.map((p) => p.name)).toEqual(['EmptyWrapper']);
  });
});

describe('defaultVariant', () => {
  const variant = (id: string, name: string, partName: string): SerializedNode => ({
    id, name, type: 'COMPONENT', visible: true,
    children: [{ id: `${id}-c`, name: partName, type: 'FRAME', visible: true }],
  });

  it('picks the variant Figma declares as default, not the first child', () => {
    const set: SerializedNode = {
      id: 'r', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: {
        Style: { type: 'VARIANT', variantOptions: ['Filled', 'Ghost'], defaultValue: 'Ghost' },
      },
      children: [variant('v0', 'Style=Filled', 'FilledPart'), variant('v1', 'Style=Ghost', 'GhostPart')],
    };
    expect(defaultVariant(set).name).toBe('Style=Ghost');
    expect(extractAnatomy(set).parts.map((p) => p.name)).toEqual(['GhostPart']);
  });

  it('falls back to the first COMPONENT child when no default is declared', () => {
    const set: SerializedNode = {
      id: 'r', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Style: { type: 'VARIANT', variantOptions: ['Filled', 'Ghost'] } },
      children: [variant('v0', 'Style=Filled', 'FilledPart'), variant('v1', 'Style=Ghost', 'GhostPart')],
    };
    expect(defaultVariant(set).name).toBe('Style=Filled');
  });

  it('falls back to the first child when the declared default matches nothing', () => {
    const set: SerializedNode = {
      id: 'r', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: {
        Style: { type: 'VARIANT', variantOptions: ['Filled'], defaultValue: 'Vanished' },
      },
      children: [variant('v0', 'Style=Filled', 'FilledPart')],
    };
    expect(defaultVariant(set).name).toBe('Style=Filled');
  });
});
