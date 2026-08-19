import { describe, it, expect } from 'vitest';
import { serializeNode, type NodeResolver } from '../src/serialize';
import { extract } from '@spec-layer/extractor';
import { serializeProse, parseProse } from '../src/docLink';
import type { ProseDrafts } from '@spec-layer/extractor';

// A mock Figma COMPONENT_SET node (button) with one variant child containing
// a container (bound fill), a label, and an instance (nested component).
const mockButtonSet = {
  id: '1:100', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'm3-button',
  componentPropertyDefinitions: {
    Style: { type: 'VARIANT', defaultValue: 'Filled', variantOptions: ['Filled', 'Outlined'] },
    State: { type: 'VARIANT', defaultValue: 'Enabled', variantOptions: ['Enabled', 'Hovered', 'Disabled'] },
  },
  children: [
    {
      id: '1:101', name: 'Style=Filled, State=Enabled', type: 'COMPONENT', visible: true,
      children: [
        { id: '1:102', name: 'container', type: 'FRAME', visible: true,
          fills: [{ type: 'SOLID' }], fillStyleId: '',
          boundVariables: { fills: [{ id: 'VAR:1' }] },
          layoutMode: 'HORIZONTAL', itemSpacing: 8 },
        { id: '1:103', name: 'label', type: 'TEXT', visible: true,
          fills: [{ type: 'SOLID' }], fillStyleId: '',
          boundVariables: { fills: [{ id: 'VAR:2' }] },
          textStyleId: 'S:type,1:1' },
        { id: '1:104', name: 'icon', type: 'INSTANCE', visible: true },
      ],
    },
  ],
};

const resolver: NodeResolver = {
  variableName: async (id) => (({ 'VAR:1': 'md.sys.color.primary', 'VAR:2': 'md.sys.color.on-primary' } as Record<string,string>)[id] ?? null),
  styleName: async (id) => (id === 'S:type,1:1' ? 'md.sys.typescale.label-large' : null),
  mainComponent: async () => ({ name: 'Icon', key: 'm3-icon' }),
};

describe('full pipeline: serialize → extract → render → parse', () => {
  it('produces a draft spec that round-trips through frontmatter', async () => {
    const node = await serializeNode(mockButtonSet as never, resolver);

    expect(node.type).toBe('COMPONENT_SET');
    expect(node.propertyDefinitions?.Style?.variantOptions).toEqual(['Filled', 'Outlined']);

    const spec = extract(node, { figmaFile: 'FILEKEY' });
    expect(spec.props.length).toBe(2);
    // Order comes from detectStateMatrix's lifecycle ranking. "Hovered" is
    // recognized as the participle of "hover" (STATE_ORDER in
    // statesMatrix.ts lists both), ranking right after it, so lifecycle
    // order agrees with the mock's declaration order here.
    expect(spec.states).toEqual(['Enabled', 'Hovered', 'Disabled']);
    expect(spec.related).toEqual(['Icon']);
    expect(spec.variantInstances).toEqual([
      {
        nodeId: '1:101',
        name: 'Style=Filled, State=Enabled',
        values: { Style: 'Filled', State: 'Enabled' },
      },
    ]);

    // Single-variant mock: the container fill is unconditioned, so the rule
    // carries the resolved variable name straight through.
    expect(spec.tokens).toContainEqual(
      expect.objectContaining({ part: 'container', property: 'fill', token: 'md.sys.color.primary' }),
    );
  });

  it('degraded mode (no prose) still yields a complete spec', async () => {
    const node = await serializeNode(mockButtonSet as never, resolver);
    const spec = extract(node, { figmaFile: 'F' });
    expect(spec.name).toBe('Button');
    expect(spec.anatomy.length).toBeGreaterThan(0);
  });

  it('typography styles and layout flow through serialize → extract', async () => {
    const node = await serializeNode(mockButtonSet as never, resolver);
    const spec = extract(node, { figmaFile: 'FILEKEY' });

    expect(spec.tokens).toContainEqual(
      expect.objectContaining({ part: 'label', property: 'typography', token: 'md.sys.typescale.label-large' }),
    );
    expect(spec.gaps).toContainEqual({
      part: 'container', path: 'Container/container', property: 'itemSpacing',
      issue: 'hardcoded-value', value: 8,
    });
    expect(spec.layout).toContainEqual({ part: 'container', summary: 'horizontal, gap 8' });
  });
});

describe('prose survives the storage round trip the frame build performs', () => {
  it('recovers the drafts a build would have written', () => {
    const drafts: ProseDrafts = {
      definition: 'A button triggers an action.',
      accessibility: 'Give every button an accessible name.',
      dos: ['Use sentence case.'],
      donts: ['Do not nest buttons.'],
    };
    // Mirrors main.ts: serialize on build, parse when Copy asks for it.
    expect(parseProse(serializeProse(drafts))).toEqual(drafts);
  });

  it('treats a document written before prose storage as having none', () => {
    expect(parseProse('')).toBeNull();
  });
});
