import { describe, it, expect } from 'vitest';
import { serializeNode, mainComponentRef } from '../src/serialize';

const resolver = {
  variableName: async (id: string) => (({ 'VariableID:1': 'md.sys.color.primary' } as Record<string,string>)[id] ?? null),
  styleName: async (_id: string) => null,
  mainComponent: async (_node: unknown) => null,
};

const mockRect = {
  id: '2:1', name: 'container', type: 'RECTANGLE', visible: true,
  fills: [{ type: 'SOLID' }],
  fillStyleId: '',
  boundVariables: { fills: [{ id: 'VariableID:1' }] },
  children: undefined,
};

describe('serializeNode', () => {
  it('resolves variable bindings to token names', async () => {
    const out = await serializeNode(mockRect as never, resolver);
    expect(out.bindings).toContainEqual({ property: 'fills', token: 'md.sys.color.primary' });
    expect(out.hasUnboundPaint).toBeFalsy();
  });

  it('flags unbound paints', async () => {
    const unbound = { ...mockRect, boundVariables: {} };
    const out = await serializeNode(unbound as never, resolver);
    expect(out.hasUnboundPaint).toBe(true);
  });

  it('captures the hex of an unbound solid fill', async () => {
    const unbound = {
      ...mockRect,
      boundVariables: {},
      fills: [{ type: 'SOLID', color: { r: 0.4, g: 0.31, b: 0.64 } }],
    };
    const out = await serializeNode(unbound as never, resolver);
    expect(out.unboundFill).toBe('#664fa3');
  });

  it('recurses into children', async () => {
    const parent = { id: '1:1', name: 'frame', type: 'FRAME', visible: true, children: [mockRect] };
    const out = await serializeNode(parent as never, resolver);
    expect(out.children?.[0].name).toBe('container');
  });

  it('resolves fillStyleId to a binding', async () => {
    const styledResolver = {
      ...resolver,
      styleName: async (_id: string) => 'color/primary',
    };
    const styled = { ...mockRect, boundVariables: {}, fillStyleId: 'S:abc,1:1' };
    const out = await serializeNode(styled as never, styledResolver);
    expect(out.bindings).toContainEqual({ property: 'fills', token: 'color/primary' });
    expect(out.hasUnboundPaint).toBeFalsy();
  });

  it('resolves textStyleId to a typography binding', async () => {
    const r = { ...resolver, styleName: async () => 'md.sys.typescale.label-large' };
    const text = { id: '3:1', name: 'label', type: 'TEXT', visible: true, textStyleId: 'S:txt,1:1' };
    const out = await serializeNode(text as never, r);
    expect(out.bindings).toContainEqual({ property: 'typography', token: 'md.sys.typescale.label-large' });
  });

  it('resolves effectStyleId to an effects binding', async () => {
    const r = { ...resolver, styleName: async () => 'md.sys.elevation.level1' };
    const card = { id: '3:2', name: 'card', type: 'FRAME', visible: true, effectStyleId: 'S:fx,1:1' };
    const out = await serializeNode(card as never, r);
    expect(out.bindings).toContainEqual({ property: 'effects', token: 'md.sys.elevation.level1' });
  });

  it('resolves ALL entries of array-valued bound variables', async () => {
    const r = {
      ...resolver,
      variableName: async (id: string) =>
        (({ 'V:1': 'color/overlay', 'V:2': 'color/base' } as Record<string, string>)[id] ?? null),
    };
    const multi = { ...mockRect, boundVariables: { fills: [{ id: 'V:1' }, { id: 'V:2' }] } };
    const out = await serializeNode(multi as never, r);
    expect(out.bindings).toContainEqual({ property: 'fills', token: 'color/overlay' });
    expect(out.bindings).toContainEqual({ property: 'fills', token: 'color/base' });
  });

  it('captures auto-layout and corner radius values', async () => {
    const frame = {
      id: '3:3', name: 'container', type: 'FRAME', visible: true,
      layoutMode: 'HORIZONTAL', paddingTop: 10, paddingRight: 24, paddingBottom: 10, paddingLeft: 24,
      itemSpacing: 8, cornerRadius: 20,
    };
    const out = await serializeNode(frame as never, resolver);
    expect(out.layout).toEqual({
      mode: 'HORIZONTAL', paddingTop: 10, paddingRight: 24, paddingBottom: 10, paddingLeft: 24,
      itemSpacing: 8, cornerRadius: 20,
    });
  });

  it('omits layout entirely for non-auto-layout nodes with no radius', async () => {
    const out = await serializeNode(mockRect as never, resolver);
    expect(out.layout).toBeUndefined();
  });

  it('skips zero-valued layout fields and mixed (symbol) cornerRadius', async () => {
    const frame = {
      id: '3:4', name: 'row', type: 'FRAME', visible: true,
      layoutMode: 'VERTICAL', paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      itemSpacing: 12, cornerRadius: Symbol('figma.mixed'),
    };
    const out = await serializeNode(frame as never, resolver);
    expect(out.layout).toEqual({ mode: 'VERTICAL', itemSpacing: 12 });
  });

  it('skips mixed (symbol) effectStyleId without calling the resolver', async () => {
    const r = { ...resolver, styleName: async () => 'should-not-appear' };
    const mixed = { id: '3:5', name: 'card', type: 'FRAME', visible: true, effectStyleId: Symbol('figma.mixed') };
    const out = await serializeNode(mixed as never, r);
    expect(out.bindings ?? []).not.toContainEqual(expect.objectContaining({ property: 'effects' }));
  });
});

describe('mainComponentRef', () => {
  it('prefers the parent component set name/key for a variant main component', () => {
    const ref = mainComponentRef({
      name: 'Size=Large, State=Default', key: 'variantkey',
      parent: { type: 'COMPONENT_SET', name: 'Button', key: 'setkey' },
    });
    expect(ref).toEqual({ name: 'Button', key: 'setkey' });
  });

  it('uses the component name/key when it is standalone (no set parent)', () => {
    const ref = mainComponentRef({
      name: 'Icon', key: 'iconkey', parent: { type: 'FRAME', name: 'Page', key: '' },
    });
    expect(ref).toEqual({ name: 'Icon', key: 'iconkey' });
  });

  it('uses the component name/key when parent is null', () => {
    const ref = mainComponentRef({ name: 'Icon', key: 'iconkey', parent: null });
    expect(ref).toEqual({ name: 'Icon', key: 'iconkey' });
  });
});
