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

describe('unbound paint detection', () => {
  const resolver = { variableName: async () => null, styleName: async () => null, mainComponent: async () => null };

  it('flags a hardcoded stroke and records its hex', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
    } as never, resolver);
    expect(n.hasUnboundStroke).toBe(true);
    expect(n.unboundStroke).toBe('#ff0000');
  });

  it('does not flag a stroke bound to a variable', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      boundVariables: { strokes: [{ id: 'V:1' }] },
    } as never, { ...resolver, variableName: async () => 'border/default' });
    expect(n.hasUnboundStroke).toBeUndefined();
  });

  it('does not flag a stroke bound to a style id', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      strokeStyleId: 'S:border,1:1',
    } as never, { ...resolver, styleName: async () => 'border/default' });
    expect(n.hasUnboundStroke).toBeUndefined();
  });

  it('flags a gradient fill with no style', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME', fills: [{ type: 'GRADIENT_LINEAR' }],
    } as never, resolver);
    expect(n.hasUnboundGradient).toBe(true);
  });

  it('does not flag a gradient fill bound to a style id', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      fills: [{ type: 'GRADIENT_LINEAR' }],
      fillStyleId: 'S:fill,1:1',
    } as never, { ...resolver, styleName: async () => 'gradient/brand' });
    expect(n.hasUnboundGradient).toBeUndefined();
  });

  it('flags a node with effects and no style or variable', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME', effects: [{ type: 'DROP_SHADOW' }],
    } as never, resolver);
    expect(n.hasUnboundEffect).toBe(true);
  });

  it('does not flag effects bound to a variable', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      effects: [{ type: 'DROP_SHADOW' }],
      boundVariables: { effects: [{ id: 'V:1' }] },
    } as never, { ...resolver, variableName: async () => 'elevation/level1' });
    expect(n.hasUnboundEffect).toBeUndefined();
  });

  it('does not flag effects bound to a string effect style id', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      effects: [{ type: 'DROP_SHADOW' }],
      effectStyleId: 'S:fx,1:1',
    } as never, { ...resolver, styleName: async () => 'md.sys.elevation.level1' });
    expect(n.hasUnboundEffect).toBeUndefined();
  });

  it('still flags effects when effectStyleId is the mixed symbol (not a real style)', async () => {
    // Figma sets effectStyleId to the figma.mixed symbol when a node's effects
    // come from children with different styles. A truthiness check on that
    // symbol would wrongly read as "has a style" — it must not suppress the gap.
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      effects: [{ type: 'DROP_SHADOW' }],
      effectStyleId: Symbol('figma.mixed'),
    } as never, resolver);
    expect(n.hasUnboundEffect).toBe(true);
  });

  it('records a non-default opacity', async () => {
    const n = await serializeNode({ id: '1', name: 'Box', type: 'FRAME', opacity: 0.5 } as never, resolver);
    expect(n.opacity).toBe(0.5);
  });

  it('omits opacity when fully opaque', async () => {
    const n = await serializeNode({ id: '1', name: 'Box', type: 'FRAME', opacity: 1 } as never, resolver);
    expect(n.opacity).toBeUndefined();
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

describe('text metrics and fill alpha', () => {
  const resolver = { variableName: async () => null, styleName: async () => null, mainComponent: async () => null };

  it('records font size and weight for a TEXT node', async () => {
    const n = await serializeNode({
      id: '1', name: 'label', type: 'TEXT',
      fontSize: 18.66, fontName: { family: 'Inter', style: 'Bold' },
    } as never, resolver);
    expect(n.text).toEqual({ fontSize: 18.66, fontWeight: 700 });
  });

  it('maps a regular style to weight 400', async () => {
    const n = await serializeNode({
      id: '1', name: 'label', type: 'TEXT',
      fontSize: 14, fontName: { family: 'Inter', style: 'Regular' },
    } as never, resolver);
    expect(n.text).toEqual({ fontSize: 14, fontWeight: 400 });
  });

  it('omits text metrics on a non-TEXT node', async () => {
    const n = await serializeNode({ id: '1', name: 'box', type: 'FRAME' } as never, resolver);
    expect(n.text).toBeUndefined();
  });

  it('records the alpha of a hardcoded fill', async () => {
    const n = await serializeNode({
      id: '1', name: 'box', type: 'FRAME',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.38 }],
    } as never, resolver);
    expect(n.unboundFillAlpha).toBe(0.38);
  });

  it('omits alpha when the fill is fully opaque', async () => {
    const n = await serializeNode({
      id: '1', name: 'box', type: 'FRAME',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    } as never, resolver);
    expect(n.unboundFillAlpha).toBeUndefined();
  });
});
