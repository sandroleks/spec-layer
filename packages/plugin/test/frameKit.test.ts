import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setCornerStyle,
  radius,
  hex,
  palette,
  solidFill,
  setFontFamilies,
  font,
  headingFont,
  makeText,
  vstack,
  hstack,
  buildSlot,
  matchVariableModes,
} from '../src/frameKit';

describe('radius', () => {
  it('soft keeps the base values (the current look)', () => {
    setCornerStyle('soft');
    for (const base of [2, 3, 6, 8, 12, 16]) expect(radius(base)).toBe(base);
  });

  it('sharp squares everything off', () => {
    setCornerStyle('sharp');
    for (const base of [2, 3, 6, 8, 12, 16]) expect(radius(base)).toBe(0);
  });

  it('round scales by 1.75 and rounds to whole pixels', () => {
    setCornerStyle('round');
    expect(radius(16)).toBe(28);
    expect(radius(12)).toBe(21);
    expect(radius(8)).toBe(14);
    expect(radius(6)).toBe(11);
    expect(radius(3)).toBe(5);
    expect(radius(2)).toBe(4);
  });

  it('setCornerStyle replaces the previous style completely', () => {
    setCornerStyle('round');
    setCornerStyle('soft');
    expect(radius(16)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

describe('hex', () => {
  it('normalizes a #rrggbb string to 0..1 channels', () => {
    expect(hex('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hex('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('accepts a value with no leading hash', () => {
    expect(hex('ff0000')).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('maps mid channels proportionally', () => {
    const { r, g, b } = hex('#8040c0');
    expect(r).toBeCloseTo(128 / 255, 10);
    expect(g).toBeCloseTo(64 / 255, 10);
    expect(b).toBeCloseTo(192 / 255, 10);
  });
});

describe('solidFill', () => {
  it('wraps a colour in a single SOLID paint', () => {
    expect(solidFill(palette.bg)).toEqual([{ type: 'SOLID', color: palette.bg }]);
  });
});

// ---------------------------------------------------------------------------
// Font families
// ---------------------------------------------------------------------------

describe('font families', () => {
  afterEach(() => setFontFamilies('Inter', 'Inter'));

  it('defaults both faces to Inter', () => {
    setFontFamilies('Inter', 'Inter');
    expect(font('Regular')).toEqual({ family: 'Inter', style: 'Regular' });
    expect(headingFont('Bold')).toEqual({ family: 'Inter', style: 'Bold' });
  });

  it('keeps the heading and body families independent', () => {
    setFontFamilies('Playfair Display', 'Source Sans 3');
    expect(headingFont('Bold')).toEqual({ family: 'Playfair Display', style: 'Bold' });
    expect(font('Medium')).toEqual({ family: 'Source Sans 3', style: 'Medium' });
  });
});

// ---------------------------------------------------------------------------
// Node builders — these need the Figma node factories.
// ---------------------------------------------------------------------------

interface FakeFrame {
  name: string; children: unknown[]; appendChild: (n: unknown) => void;
  resize: (w: number, h: number) => void; width: number; height: number;
  [k: string]: unknown;
}

function fakeFrame(): FakeFrame {
  const f: FakeFrame = {
    name: '', children: [], width: 0, height: 0,
    appendChild(n: unknown) { f.children.push(n); },
    resize(w: number, h: number) { f.width = w; f.height = h; },
  };
  return f;
}

function installFigma(over: Record<string, unknown> = {}) {
  (globalThis as Record<string, unknown>).figma = {
    createText: () => ({ type: 'TEXT' }) as Record<string, unknown>,
    createFrame: () => fakeFrame(),
    getNodeByIdAsync: async () => null,
    variables: { getVariableCollectionByIdAsync: async () => null },
    ...over,
  };
}

beforeEach(() => {
  installFigma();
  setCornerStyle('soft');
  setFontFamilies('Inter', 'Inter');
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).figma;
});

describe('makeText', () => {
  it('applies the body font, size, characters and fill', () => {
    const t = makeText('Hello', 'Bold', 14) as unknown as Record<string, unknown>;
    expect(t.fontName).toEqual({ family: 'Inter', style: 'Bold' });
    expect(t.fontSize).toBe(14);
    expect(t.characters).toBe('Hello');
    expect(t.fills).toEqual(solidFill(palette.body));
  });

  it('leaves line height and tracking unset unless asked', () => {
    const t = makeText('Hello', 'Regular', 12) as unknown as Record<string, unknown>;
    expect(t.lineHeight).toBeUndefined();
    expect(t.letterSpacing).toBeUndefined();
  });

  it('applies percent line height and tracking when given', () => {
    const t = makeText('Hello', 'Regular', 12, palette.muted, 140, -2) as unknown as Record<string, unknown>;
    expect(t.lineHeight).toEqual({ value: 140, unit: 'PERCENT' });
    expect(t.letterSpacing).toEqual({ value: -2, unit: 'PERCENT' });
    expect(t.fills).toEqual(solidFill(palette.muted));
  });
});

describe('vstack / hstack', () => {
  it('vstack hugs on both axes and carries the spacing', () => {
    const f = vstack(8) as unknown as FakeFrame;
    expect(f.layoutMode).toBe('VERTICAL');
    expect(f.primaryAxisSizingMode).toBe('AUTO');
    expect(f.counterAxisSizingMode).toBe('AUTO');
    expect(f.itemSpacing).toBe(8);
    expect(f.fills).toEqual([]);
  });

  it('hstack differs only in direction', () => {
    const f = hstack(4) as unknown as FakeFrame;
    expect(f.layoutMode).toBe('HORIZONTAL');
    expect(f.itemSpacing).toBe(4);
    expect(f.fills).toEqual([]);
  });
});

describe('matchVariableModes', () => {
  it('does nothing when the component exposes no resolved modes', async () => {
    const setMode = vi.fn();
    await matchVariableModes(
      { setExplicitVariableModeForCollection: setMode } as unknown as InstanceNode,
      {} as unknown as ComponentNode,
    );
    expect(setMode).not.toHaveBeenCalled();
  });

  it('applies every resolved collection mode to the instance', async () => {
    const coll = { id: 'c1' };
    installFigma({ variables: { getVariableCollectionByIdAsync: async () => coll } });
    const setMode = vi.fn();
    await matchVariableModes(
      { setExplicitVariableModeForCollection: setMode } as unknown as InstanceNode,
      { resolvedVariableModes: { c1: 'm1', c2: 'm2' } } as unknown as ComponentNode,
    );
    expect(setMode).toHaveBeenCalledTimes(2);
    expect(setMode).toHaveBeenCalledWith(coll, 'm1');
  });

  it('skips a collection that is unavailable instead of throwing', async () => {
    installFigma({
      variables: { getVariableCollectionByIdAsync: async () => { throw new Error('detached'); } },
    });
    const setMode = vi.fn();
    await expect(matchVariableModes(
      { setExplicitVariableModeForCollection: setMode } as unknown as InstanceNode,
      { resolvedVariableModes: { c1: 'm1' } } as unknown as ComponentNode,
    )).resolves.toBeUndefined();
    expect(setMode).not.toHaveBeenCalled();
  });
});

describe('buildSlot', () => {
  it('falls back to a placeholder when the node id resolves to nothing', async () => {
    const slot = await buildSlot('1:1', 200) as unknown as FakeFrame;
    expect(slot.name).toBe('Instance slot');
    expect(slot.width).toBe(200);
    expect(slot.clipsContent).toBe(true);
    expect(slot.children).toHaveLength(1);
    expect((slot.children[0] as Record<string, unknown>).characters).toBe('Drop instance');
  });

  it('places a live instance when the node is a component', async () => {
    const inst = { width: 100, height: 40, rescale: vi.fn(), setExplicitVariableModeForCollection: vi.fn() };
    installFigma({
      getNodeByIdAsync: async () => ({ type: 'COMPONENT', createInstance: () => inst }),
    });
    const slot = await buildSlot('1:1', 200) as unknown as FakeFrame;
    expect(slot.children).toEqual([inst]);
    // 100x40 fits inside 200-24 wide and 160 tall, so no rescale.
    expect(inst.rescale).not.toHaveBeenCalled();
  });

  it('rescales an instance that overflows the slot', async () => {
    const inst = { width: 800, height: 40, rescale: vi.fn(), setExplicitVariableModeForCollection: vi.fn() };
    installFigma({
      getNodeByIdAsync: async () => ({ type: 'COMPONENT', createInstance: () => inst }),
    });
    await buildSlot('1:1', 200);
    // maxW is width - 24 = 176, so the scale is 176/800.
    expect(inst.rescale).toHaveBeenCalledWith(176 / 800);
  });

  it('falls back to the placeholder when instancing throws', async () => {
    installFigma({ getNodeByIdAsync: async () => { throw new Error('gone'); } });
    const slot = await buildSlot('1:1', 200) as unknown as FakeFrame;
    expect((slot.children[0] as Record<string, unknown>).characters).toBe('Drop instance');
  });

  it('ignores a node that is not a component', async () => {
    installFigma({ getNodeByIdAsync: async () => ({ type: 'FRAME' }) });
    const slot = await buildSlot('1:1', 200) as unknown as FakeFrame;
    expect((slot.children[0] as Record<string, unknown>).characters).toBe('Drop instance');
  });
});
