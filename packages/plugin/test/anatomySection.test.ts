import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';
import { PIN_SIZE, fanOutPins, buildAnatomyLegend, buildAnatomyDiagram, scaleNote } from '../src/anatomySection';
import { applyThemeToKit } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import { SLOT_KEY, SLOT_PART_KEY } from '../src/canvasProse';
import type { AnatomyPartBlock } from '../src/ui/docModel';

describe('fanOutPins', () => {
  it('leaves pins that already clear each other where they are', () => {
    expect(fanOutPins([10, 60, 120], 18, 6)).toEqual([10, 60, 120]);
  });
  it('spreads crowded pins evenly around their centre, in order', () => {
    // Three pins within 10px: step is pinSize + gap = 24, centred on 15.
    expect(fanOutPins([12, 15, 18], 18, 6)).toEqual([-9, 15, 39]);
  });
  it('spreads only the crowded run and keeps a far pin in place', () => {
    expect(fanOutPins([10, 14, 200], 18, 6)).toEqual([0, 24, 200]);
  });
  it('returns an empty list for no pins', () => {
    expect(fanOutPins([], 18, 6)).toEqual([]);
  });
});

describe('scaleNote', () => {
  it('is null at true size and names the rounded percentage otherwise', () => {
    expect(scaleNote(1)).toBeNull();
  });
});

describe('buildAnatomyLegend', () => {
  beforeEach(async () => { installFakeFigma(); await applyThemeToKit(resolveTheme(emptyBrandTheme())); });
  afterEach(() => uninstallFakeFigma());

  it('shows the display name with the role, and tags the raw name for read-back', () => {
    const legend = buildAnatomyLegend([
      { label: '1', name: 'checkboxItem', nested: false, id: '1:2', depth: 0, tokens: ['color/bg'], type: 'FRAME', role: 'The toggle target.' },
      { label: '2', name: 'Label', nested: false, id: '1:3', depth: 0, tokens: [], type: 'TEXT' },
      { label: '3', name: 'Required', nested: false, id: '1:4', depth: 0, tokens: [], type: 'TEXT', shownBy: 'isRequired' },
    ]) as unknown as FakeFrame;
    const rows = legend.children.filter((c) => c instanceof FakeFrame && c.getPluginData(SLOT_KEY) === 'anatomyPart') as FakeFrame[];
    expect(rows).toHaveLength(3);
    expect(rows[0].getPluginData(SLOT_PART_KEY)).toBe('checkboxItem');
    const texts = rows.map((r) => (r.children[1] as FakeText).characters);
    expect(texts).toEqual([
      'Checkbox item: The toggle target.',
      'Label',
      'Required  ·  Shown when isRequired is true',
    ]);
    // No token list and no type in the legend any more.
    expect(legend.textChars().join(' ')).not.toContain('color/bg');
  });

  it('renders the scale note text', async () => {
    const note = scaleNote(0.6) as unknown as FakeText;
    expect(note.characters).toBe('Shown at 60%');
  });
});

// --- buildAnatomyDiagram -----------------------------------------------------

const COMPONENT_ID = 'comp:1';
const ANATOMY_PAD = 24; // mirrors the module's own private constant

interface FakeBox { x: number; y: number; width: number; height: number }

/** A minimal fake InstanceNode: enough for buildAnatomyDiagram to place it,
 *  measure it, and rescale it. `rescale` mutates width/height/absoluteBoundingBox
 *  the way a real instance would, since the module reads the POST-rescale size
 *  to lay out the box and the pins. */
function fakeInstance(box: FakeBox, id = 'inst1') {
  const bbox: FakeBox = { ...box };
  const inst = {
    id,
    x: 0,
    y: 0,
    width: box.width,
    height: box.height,
    absoluteBoundingBox: bbox,
    rescale: vi.fn((s: number) => {
      inst.width = box.width * s;
      inst.height = box.height * s;
      bbox.width = box.width * s;
      bbox.height = box.height * s;
    }),
    setExplicitVariableModeForCollection: vi.fn(),
    remove: vi.fn(),
  };
  return inst;
}

/** Installs a fake `figma` whose `getNodeByIdAsync` resolves `COMPONENT_ID` to
 *  a component that instances as `inst`, and resolves each `I<inst.id>;<partId>`
 *  address (exactly how the module builds a part's node id) to a node with the
 *  given absolute box. A part id with no entry resolves to null, as it would
 *  for a part the instance genuinely has no matching layer for. */
function installAnatomyFigma(inst: ReturnType<typeof fakeInstance>, partBoxes: Record<string, FakeBox>): void {
  const component = { type: 'COMPONENT', createInstance: () => inst };
  const partNodes: Record<string, { absoluteBoundingBox: FakeBox }> = {};
  for (const [partId, box] of Object.entries(partBoxes)) {
    partNodes[`I${inst.id};${partId}`] = { absoluteBoundingBox: box };
  }
  installFakeFigma({
    getNodeByIdAsync: async (id: string) => (id === COMPONENT_ID ? component : (partNodes[id] ?? null)),
  });
}

const part = (label: string, id: string, extra: Partial<AnatomyPartBlock> = {}): AnatomyPartBlock =>
  ({ label, name: `part${id}`, nested: false, id, depth: 0, tokens: [], type: 'FRAME', ...extra });

describe('buildAnatomyDiagram', () => {
  afterEach(() => uninstallFakeFigma());

  it('renders a narrow instance at true size, without rescaling', async () => {
    const inst = fakeInstance({ x: 0, y: 0, width: 200, height: 100 });
    installAnatomyFigma(inst, {});
    await applyThemeToKit(resolveTheme(emptyBrandTheme()));

    const result = await buildAnatomyDiagram(COMPONENT_ID, [], false, 768);

    expect(result).not.toBeNull();
    expect(result!.scale).toBe(1);
    expect(inst.rescale).not.toHaveBeenCalled();
    const card = result!.card as unknown as FakeFrame;
    expect(card.width).toBe(768); // Finding 2: fixed to the column, not hugging
  });

  it('scales a wide instance down to the exact factor the column allows, and keeps the box inside the column budget', async () => {
    const inst = fakeInstance({ x: 0, y: 0, width: 2000, height: 200 });
    installAnatomyFigma(inst, {});
    await applyThemeToKit(resolveTheme(emptyBrandTheme()));

    const result = await buildAnatomyDiagram(COMPONENT_ID, [], false, 768);

    expect(result).not.toBeNull();
    // maxW = 768 - 2*24 = 720; 720 / 2000 = 0.36 exactly.
    expect(result!.scale).toBe(0.36);
    expect(inst.rescale).toHaveBeenCalledWith(0.36);
    const card = result!.card as unknown as FakeFrame;
    expect(card.width).toBe(768);
    const box = card.children[0] as FakeFrame;
    expect(box.width).toBeLessThanOrEqual(768 - ANATOMY_PAD * 2);
    const note = scaleNote(result!.scale) as unknown as FakeText;
    expect(note.characters).toBe('Shown at 36%');
  });

  it('gives the card the column width and only hugs its height, so a small diagram sits in a card its own size with a legend that can fill it', async () => {
    const inst = fakeInstance({ x: 0, y: 0, width: 40, height: 40 });
    installAnatomyFigma(inst, {});
    await applyThemeToKit(resolveTheme(emptyBrandTheme()));

    const result = await buildAnatomyDiagram(COMPONENT_ID, [], false, 768);

    expect(result).not.toBeNull();
    const card = result!.card as unknown as FakeFrame;
    expect(card.width).toBe(768);
    expect(card.layoutSizingHorizontal).toBe('FIXED');
    expect(card.counterAxisAlignItems).toBe('CENTER'); // centres the (small) box
    const [box, legend] = card.children as FakeFrame[];
    expect(box.width).toBe(40); // the box is the instance's own size...
    expect(box.width).toBeLessThan(card.width); // ...not stretched to the column
    expect(legend.layoutSizingHorizontal).toBe('FILL'); // ...but the legend can fill it
  });

  it('fans crowded top-row pins apart and connects each to its part with a three-segment elbow leader', async () => {
    // Instance sits at an arbitrary canvas offset, to prove normalization
    // subtracts the instance's own x/y rather than assuming it starts at 0.
    const inst = fakeInstance({ x: 500, y: 300, width: 200, height: 100 });
    installAnatomyFigma(inst, {
      p1: { x: 540, y: 340, width: 20, height: 20 }, // centre x=50, y=50 -> nx .25, ny .5, ty .4
      p2: { x: 560, y: 340, width: 20, height: 20 }, // centre x=70, y=50 -> nx .35, ny .5, ty .4
    });
    await applyThemeToKit(resolveTheme(emptyBrandTheme()));

    const parts = [part('1', 'p1'), part('2', 'p2')];
    const result = await buildAnatomyDiagram(COMPONENT_ID, parts, false, 1000);

    expect(result).not.toBeNull();
    expect(result!.scale).toBe(1);
    expect(inst.rescale).not.toHaveBeenCalled();

    // Both parts share the same y (a horizontal row) -> pins go on top, spread
    // along x. Natural centres [50, 70] (nx * 200) are 20px apart, closer than
    // pinSize+gap (24), so both fan out: [48, 72] (see fanOutPins' own tests).
    const box = (result!.card as unknown as FakeFrame).children[0] as FakeFrame;
    expect(box.children[0]).toBe(inst);
    expect(box.width).toBe(200);
    expect(box.height).toBe(100 + PIN_SIZE + 10 + 24); // renderedH + ZONE

    const rect = (i: number) => {
      const f = box.children[i] as FakeFrame;
      return { x: f.x, y: f.y, width: f.width, height: f.height };
    };
    const point = (i: number) => {
      const f = box.children[i] as FakeFrame;
      return { x: f.x, y: f.y };
    };

    // Pin '1': anchored at x=50 (its part's centre), fanned to pin centre 48 ->
    // the elbow's three segments (out from the part, along the rail, in to the
    // pin), then the connect dot, then the pin badge itself.
    expect(rect(1)).toEqual({ x: 50, y: 42, width: 1, height: 50 }); // out, to the rail
    expect(rect(2)).toEqual({ x: 48, y: 42, width: 2, height: 1 }); // along the rail
    expect(rect(3)).toEqual({ x: 48, y: 18, width: 1, height: 24 }); // in, to the pin
    expect(point(4)).toEqual({ x: 47, y: 89 }); // connect dot at the part anchor
    expect(point(5)).toEqual({ x: 39, y: 0 }); // pin badge

    // Pin '2': anchored at x=70, fanned to pin centre 72.
    expect(rect(6)).toEqual({ x: 70, y: 42, width: 1, height: 50 });
    expect(rect(7)).toEqual({ x: 70, y: 42, width: 2, height: 1 });
    expect(rect(8)).toEqual({ x: 72, y: 18, width: 1, height: 24 });
    expect(point(9)).toEqual({ x: 67, y: 89 });
    expect(point(10)).toEqual({ x: 63, y: 0 });
  });
});
