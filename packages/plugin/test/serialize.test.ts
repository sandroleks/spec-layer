import { describe, it, expect } from 'vitest';
import { serializeNode, mainComponentRef } from '../src/serialize';

const resolver = {
  variable: async (id: string) =>
    (({ 'VariableID:1': 'md.sys.color.primary' } as Record<string,string>)[id]
      ? { id, name: 'md.sys.color.primary', remote: false, collectionId: 'VariableCollectionId:1' }
      : null),
  style: async (_id: string) => null,
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
    expect(out.bindings).toContainEqual({ property: 'fills', id: 'VariableID:1',
      name: 'md.sys.color.primary', kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1' });
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
      style: async (id: string) => ({ id, name: 'color/primary', remote: false, kind: 'paint-style' as const }),
    };
    const styled = { ...mockRect, boundVariables: {}, fillStyleId: 'S:abc,1:1' };
    const out = await serializeNode(styled as never, styledResolver);
    expect(out.bindings).toContainEqual({ property: 'fills', id: 'S:abc,1:1',
      name: 'color/primary', kind: 'paint-style', remote: false });
    expect(out.hasUnboundPaint).toBeFalsy();
  });

  it('resolves textStyleId to a typography binding', async () => {
    const r = {
      ...resolver,
      style: async (id: string) => ({ id, name: 'md.sys.typescale.label-large', remote: false, kind: 'text-style' as const }),
    };
    const text = { id: '3:1', name: 'label', type: 'TEXT', visible: true, textStyleId: 'S:txt,1:1' };
    const out = await serializeNode(text as never, r);
    expect(out.bindings).toContainEqual({ property: 'typography', id: 'S:txt,1:1',
      name: 'md.sys.typescale.label-large', kind: 'text-style', remote: false });
  });

  it('resolves effectStyleId to an effects binding', async () => {
    const r = {
      ...resolver,
      style: async (id: string) => ({ id, name: 'md.sys.elevation.level1', remote: false, kind: 'effect-style' as const }),
    };
    const card = { id: '3:2', name: 'card', type: 'FRAME', visible: true, effectStyleId: 'S:fx,1:1' };
    const out = await serializeNode(card as never, r);
    expect(out.bindings).toContainEqual({ property: 'effects', id: 'S:fx,1:1',
      name: 'md.sys.elevation.level1', kind: 'effect-style', remote: false });
  });

  it('resolves ALL entries of array-valued bound variables', async () => {
    const r = {
      ...resolver,
      variable: async (id: string) => {
        const name = ({ 'V:1': 'color/overlay', 'V:2': 'color/base' } as Record<string, string>)[id];
        return name ? { id, name, remote: false, collectionId: 'VariableCollectionId:1' } : null;
      },
    };
    const multi = { ...mockRect, boundVariables: { fills: [{ id: 'V:1' }, { id: 'V:2' }] } };
    const out = await serializeNode(multi as never, r);
    expect(out.bindings).toContainEqual({ property: 'fills', id: 'V:1', name: 'color/overlay', kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1' });
    expect(out.bindings).toContainEqual({ property: 'fills', id: 'V:2', name: 'color/base', kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1' });
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
    const r = {
      ...resolver,
      style: async (id: string) => ({ id, name: 'should-not-appear', remote: false, kind: 'effect-style' as const }),
    };
    const mixed = { id: '3:5', name: 'card', type: 'FRAME', visible: true, effectStyleId: Symbol('figma.mixed') };
    const out = await serializeNode(mixed as never, r);
    expect(out.bindings ?? []).not.toContainEqual(expect.objectContaining({ property: 'effects' }));
  });
});

describe('unbound paint detection', () => {
  const resolver = { variable: async () => null, style: async () => null, mainComponent: async () => null };

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
    } as never, {
      ...resolver,
      variable: async (id: string) => ({ id, name: 'border/default', remote: false, collectionId: 'VariableCollectionId:1' }),
    });
    expect(n.hasUnboundStroke).toBeUndefined();
  });

  it('does not flag a stroke bound to a style id', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      strokeStyleId: 'S:border,1:1',
    } as never, {
      ...resolver,
      style: async (id: string) => ({ id, name: 'border/default', remote: false, kind: 'paint-style' as const }),
    });
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
    } as never, {
      ...resolver,
      style: async (id: string) => ({ id, name: 'gradient/brand', remote: false, kind: 'paint-style' as const }),
    });
    expect(n.hasUnboundGradient).toBeUndefined();
  });

  it('flags a node with effects and no style or variable', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME', effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 },
        offset: { x: 0, y: 1 }, radius: 1, visible: true, blendMode: 'NORMAL' }],
    } as never, resolver);
    expect(n.hasUnboundEffect).toBe(true);
  });

  it('does not flag effects bound to a variable', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 },
        offset: { x: 0, y: 1 }, radius: 1, visible: true, blendMode: 'NORMAL' }],
      boundVariables: { effects: [{ id: 'V:1' }] },
    } as never, {
      ...resolver,
      variable: async (id: string) => ({ id, name: 'elevation/level1', remote: false, collectionId: 'VariableCollectionId:1' }),
    });
    expect(n.hasUnboundEffect).toBeUndefined();
  });

  it('does not flag effects bound to a string effect style id', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 },
        offset: { x: 0, y: 1 }, radius: 1, visible: true, blendMode: 'NORMAL' }],
      effectStyleId: 'S:fx,1:1',
    } as never, {
      ...resolver,
      style: async (id: string) => ({ id, name: 'md.sys.elevation.level1', remote: false, kind: 'effect-style' as const }),
    });
    expect(n.hasUnboundEffect).toBeUndefined();
  });

  it('still flags effects when effectStyleId is the mixed symbol (not a real style)', async () => {
    // Figma sets effectStyleId to the figma.mixed symbol when a node's effects
    // come from children with different styles. A truthiness check on that
    // symbol would wrongly read as "has a style" — it must not suppress the gap.
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 },
        offset: { x: 0, y: 1 }, radius: 1, visible: true, blendMode: 'NORMAL' }],
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
  const resolver = { variable: async () => null, style: async () => null, mainComponent: async () => null };

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

  // Figma stores opacity as a float32, so 0.3 round-trips as
  // 0.30000001192092896. extractGaps writes this number straight into a gap
  // string that specContentHash covers, so an unrounded value is both float
  // noise on the page and noise in the drift baseline. 0.5 (the only value the
  // suite used to carry) is one of the few exactly-representable fractions, so
  // it could never catch this.
  it('rounds a float32 opacity to something a person would recognize', async () => {
    const n = await serializeNode({
      id: '1', name: 'box', type: 'FRAME', opacity: 0.30000001192092896,
    } as never, resolver);
    expect(n.opacity).toBe(0.3);
  });

  it('leaves an already-clean opacity alone and omits a fully opaque one', async () => {
    const dimmed = await serializeNode({
      id: '1', name: 'box', type: 'FRAME', opacity: 0.5,
    } as never, resolver);
    expect(dimmed.opacity).toBe(0.5);
    const opaque = await serializeNode({
      id: '2', name: 'box', type: 'FRAME', opacity: 1,
    } as never, resolver);
    expect(opaque.opacity).toBeUndefined();
  });
});

describe('NodeResolver identity', () => {
  it('carries remote from Figma rather than inferring it from a lookup', async () => {
    const r = {
      variable: async (id: string) => ({
        id, name: 'color/brand', remote: true, collectionId: 'VariableCollectionId:9',
      }),
      style: async () => null,
      mainComponent: async () => null,
    };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', boundVariables: { fills: { id: 'VariableID:7' } } } as never,
      r,
    );
    // The whole identity now reaches the binding, `remote: true` included --
    // Figma's own answer, not something inferred from a lookup that failed.
    expect(out.bindings).toEqual([{
      property: 'fills', id: 'VariableID:7', name: 'color/brand', kind: 'variable',
      remote: true, collectionId: 'VariableCollectionId:9',
    }]);
  });

  it('asks the style for its own kind instead of guessing from the property', async () => {
    const seen: string[] = [];
    const r = {
      variable: async () => null,
      style: async (id: string) => {
        seen.push(id);
        return { id, name: 'Focused/Primary', remote: false, kind: 'effect-style' as const };
      },
      mainComponent: async () => null,
    };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', effectStyleId: 'S:effect,1:1' } as never, r,
    );
    expect(seen).toEqual(['S:effect,1:1']);
    expect(out.bindings).toEqual([{
      property: 'effects', id: 'S:effect,1:1', name: 'Focused/Primary',
      kind: 'effect-style', remote: false,
    }]);
  });

  it('drops a binding whose resolver returns null, exactly as before', async () => {
    const r = { variable: async () => null, style: async () => null, mainComponent: async () => null };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', fillStyleId: 'S:paint,1:1' } as never, r,
    );
    expect('bindings' in out).toBe(false);
  });

  it('drops a GRID style rather than inventing a kind for it', async () => {
    // No node property serializeNode reads can hold a grid style, so a grid
    // style here means the id was not what the property claimed. Dropping it is
    // the honest result: RefKind has no grid member to widen to.
    const r = {
      variable: async () => null,
      style: async (id: string) => ({ id, name: '8pt Grid', remote: false, kind: 'grid-style' as const }),
      mainComponent: async () => null,
    };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', fillStyleId: 'S:grid,1:1' } as never, r,
    );
    expect('bindings' in out).toBe(false);
  });

  it('omits collectionId entirely when Figma reported none', async () => {
    const r = {
      variable: async (id: string) => ({ id, name: 'color/brand', remote: false, collectionId: '' }),
      style: async () => null,
      mainComponent: async () => null,
    };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', boundVariables: { fills: { id: 'VariableID:7' } } } as never, r,
    );
    expect('collectionId' in out.bindings![0]).toBe(false);
  });
});

describe('inline node effects', () => {
  const shadow = (over: Record<string, unknown> = {}) => ({
    type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 2 },
    radius: 4, spread: 0, visible: true, blendMode: 'NORMAL', ...over,
  });

  it('emits the layers when the node has effects and no effect style', async () => {
    const r = { variable: async () => null, style: async () => null, mainComponent: async () => null };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', effects: [shadow()] } as never, r,
    );
    expect(out.effects).toHaveLength(1);
    expect(out.effects![0]).toMatchObject({ type: 'drop-shadow', radius: 4, spread: 0 });
    // Unchanged semantics: a fully hardcoded effect is still an unbound effect.
    expect(out.hasUnboundEffect).toBe(true);
  });

  it('emits the layers for a PARTIALLY bound shadow, and still reports no gap', async () => {
    const r = {
      variable: async (id: string) => ({
        id, name: 'color/shadow/default', remote: false, collectionId: 'VariableCollectionId:1',
      }),
      style: async () => null,
      mainComponent: async () => null,
    };
    const out = await serializeNode({
      id: '1', name: 'N', type: 'FRAME',
      effects: [shadow({ boundVariables: { color: { id: 'VariableID:5' } } })],
      boundVariables: { effects: [{ id: 'VariableID:5' }] },
    } as never, r);
    // hasUnboundEffect keeps its exact current semantics: `effects` is in bv, so
    // no gap. That flag is inside specContentHash and must not move.
    expect('hasUnboundEffect' in out).toBe(false);
    // The geometry survives anyway, which is the whole point: a bound colour used
    // to make Figma report the layer as fully bound and drop radius, offset and
    // spread with nothing saying so.
    expect(out.effects![0]).toMatchObject({ radius: 4, spread: 0, offset: { x: 0, y: 2 } });
    expect((out.effects![0] as { bindings?: { color?: { name: string } } }).bindings?.color?.name)
      .toBe('color/shadow/default');
  });

  it('emits nothing when an effect STYLE governs the node', async () => {
    const r = {
      variable: async () => null,
      style: async (id: string) => ({ id, name: 'Focused/Primary', remote: false, kind: 'effect-style' as const }),
      mainComponent: async () => null,
    };
    const out = await serializeNode({
      id: '1', name: 'N', type: 'FRAME', effects: [shadow()], effectStyleId: 'S:effect,1:1',
    } as never, r);
    // The style name is the pointer, and the style's own layers are extracted
    // once in the foundation. Inlining them here would give the brief two owners
    // for the same values.
    expect('effects' in out).toBe(false);
  });
});
