import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IntermediateSpec, ProseV2, RefIdentity } from '@spec-layer/extractor';
import { installFakeFigma, uninstallFakeFigma, FakeSection, FakeFrame, FakeText } from './fakeFigma';
import { buildDocFrames } from '../src/docFrame';
import { buildDocModel, ALL_SECTIONS, type SectionId } from '../src/ui/docModel';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import { palette, solidFill } from '../src/frameKit';
import {
  readCanvasProse, mergeProse, collectGeneratedText, SLOT_KEY, type ProseNodeLike,
} from '../src/canvasProse';

const ident = (name: string): RefIdentity => ({ id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const spec = {
  name: 'checkbox', figmaKey: '', figmaFile: 'f', figmaFileName: 'DS', figmaNode: '1:1',
  description: 'Selects one or more options.', documentationLinks: [],
  anatomy: [
    { name: 'checkboxItem', nested: false, id: '1:3', depth: 0, type: 'FRAME', path: 'Container/checkboxItem' },
    { name: 'Label', nested: false, id: '1:4', depth: 0, type: 'TEXT', path: 'Container/Label' },
  ],
  anatomyComponentId: '1:2',
  props: [{ name: 'showLabel', kind: 'boolean', default: true }],
  variants: [], states: [], variantInstances: [],
  tokens: [{ part: 'Label', path: 'Container/Label', property: 'fill', ...ident('color/text'), conditions: {} }],
  rawValues: [], related: ['Radio'], gaps: [], layout: [], nodeEffects: [],
} as unknown as IntermediateSpec;

const prose: ProseV2 = {
  v: 2,
  overview: { lede: 'A checkbox selects options.', body: ['Use it in forms.'] },
  whenToUse: ['Several options apply.'],
  whenNotToUse: ['One option applies. Use a Radio.'],
  anatomySummary: 'A box and a label.',
  anatomyParts: [{ name: 'Label', role: 'Names the option.' }],
  properties: [{ name: 'showLabel', description: 'Hides the label.' }],
  keyboard: [{ keys: ['Space'], action: 'Toggles the box.' }],
  pointer: ['Clicking the label toggles the box.'],
  semantics: ['Render a native `<input type="checkbox">`.'],
  content: ['Write labels as statements.'],
  guidelines: [{ do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not hide the label.', reason: '' } }],
};

const ALL = new Set<SectionId>(ALL_SECTIONS.map((s) => s.id));

/** The same component with no Figma description, so the AI lede is what leads
 *  the header. With a description present the description leads instead, and
 *  the AI lede renders inside the Overview. */
const undescribed = { ...spec, description: '' } as unknown as IntermediateSpec;

async function buildFrom(s: IntermediateSpec, p: ProseV2 | null, aiEnabled = true): Promise<FakeSection> {
  const model = buildDocModel(s, p, ALL, new Set(), { measureViews: [], aiEnabled });
  return await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null) as unknown as FakeSection;
}

async function build(p: ProseV2 | null, aiEnabled = true): Promise<FakeSection> {
  return buildFrom(spec, p, aiEnabled);
}
const asNode = (s: FakeSection): ProseNodeLike => s as unknown as ProseNodeLike;

/** The node carrying a given editorial slot tag, or null. */
function findSlot(root: ProseNodeLike, slot: string): ProseNodeLike | null {
  if (root.getPluginData(SLOT_KEY) === slot) return root;
  for (const child of root.children ?? []) {
    const hit = findSlot(child, slot);
    if (hit) return hit;
  }
  return null;
}

describe('docFrame', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('reads every editorial slot back from a freshly built doc', async () => {
    const read = readCanvasProse(asNode(await build(prose)));
    expect(read).toEqual({
      overview: { lede: 'A checkbox selects options.', body: ['Use it in forms.'] },
      whenToUse: prose.whenToUse,
      whenNotToUse: prose.whenNotToUse,
      anatomySummary: prose.anatomySummary,
      anatomyParts: prose.anatomyParts,
      properties: prose.properties,
      keyboard: prose.keyboard,
      pointer: prose.pointer,
      semantics: prose.semantics,
      content: prose.content,
      guidelines: prose.guidelines,
    });
  });

  it('is a fixed point: building from the read-back and reading again changes nothing', async () => {
    const first = readCanvasProse(asNode(await build(prose)));
    const second = readCanvasProse(asNode(await build(mergeProse(null, first))));
    expect(second).toEqual(first);
  });

  it('names frames in reading order and titles them for people', async () => {
    const section = await build(prose);
    expect(section.name).toBe('checkbox: Documentation');
    const frames = section.children as FakeFrame[];
    expect(frames.map((f) => f.name)).toEqual(['1 Usage', '2 Specifications', '3 Accessibility']);
    expect(frames[0].textChars()).toContain('Checkbox');
    expect(frames[0].textChars()).not.toContain('checkbox');
  });

  it('renders the description verbatim and untagged when AI is off, and builds no Accessibility frame', async () => {
    const section = await build(null, false);
    const frames = section.children as FakeFrame[];
    expect(frames.map((f) => f.name)).toEqual(['1 Usage', '2 Specifications']);
    expect(frames[0].textChars()).toContain('Selects one or more options.');
    expect(readCanvasProse(asNode(section))).toEqual({ anatomyParts: [] });
    expect(collectGeneratedText(asNode(section))).toContain('Selects one or more options.');
  });

  it('draws the facts strip once, under the Usage header', async () => {
    const section = await build(prose);
    const usage = (section.children as FakeFrame[])[0];
    expect(usage.findAllNamed('Facts')).toHaveLength(1);
    expect(usage.findAllNamed('Facts')[0].textChars()).toEqual(['PROPERTIES', '1', 'PARTS', '2', 'TOKENS', '1', 'DS']);
    const specs = (section.children as FakeFrame[])[1];
    expect(specs.findAllNamed('Facts')).toHaveLength(0);
  });

  it('puts no placeholder text anywhere', async () => {
    const chars = (await build(null, false)).children.flatMap((f) => (f as FakeFrame).textChars()).join('\n');
    expect(chars).not.toContain('To be written');
    expect(chars).not.toContain('None.');
  });

  it('keeps editorial text out of the generated lane', async () => {
    const joined = collectGeneratedText(asNode(await build(prose))).join('\n');
    expect(joined).toContain('Anatomy');                      // a section heading, generated
    expect(joined).not.toContain('Names the option.');        // a part role, editorial
    expect(joined).not.toContain('A box and a label.');       // the anatomy summary, editorial
    expect(joined).not.toContain('A checkbox selects options.'); // the header lead, editorial
    expect(joined).not.toContain('Toggles the box.');         // a keyboard action, editorial
    expect(joined).not.toContain('It widens the target.');    // a guideline reason, editorial
  });

  it('tags the header lead when it came from the AI, and never the title', async () => {
    const tagged: string[] = [];
    const visit = (n: ProseNodeLike): void => {
      if (n.getPluginData(SLOT_KEY) === 'definitionLead') tagged.push(n.characters ?? '');
      for (const c of n.children ?? []) visit(c);
    };
    visit(asNode(await buildFrom(undescribed, prose)));
    expect(tagged).toEqual(['A checkbox selects options.']);
  });

  it('lets the description lead the header and keeps the AI lede in the Overview', async () => {
    const described = {
      ...spec, description: 'Selects one or more options. It pairs a box with a label.',
    } as unknown as IntermediateSpec;
    const section = await buildFrom(described, prose);
    const usage = (section.children as FakeFrame[])[0];

    // The header carries the designer's first sentence, and carries it as
    // generated text: an Update re-reads it from the component.
    expect(usage.textChars()).toContain('Selects one or more options.');
    expect(findSlot(asNode(section), 'definitionLead')?.characters).toBe('A checkbox selects options.');
    expect(collectGeneratedText(asNode(section))).toContain('Selects one or more options.');

    // The AI lede is not lost and not duplicated: it opens the Overview body.
    const read = readCanvasProse(asNode(section));
    expect(read.overview).toEqual({ lede: 'A checkbox selects options.', body: ['Use it in forms.'] });
    expect(mergeProse(prose, read)?.overview).toEqual(prose.overview);
  });

  it('paints a code span in the header lead with an ink other than the heading ink', async () => {
    // The header band uses palette.headerBg, which is the same colour as
    // palette.heading on the default theme; a code span there must not use
    // applyRuns' default (heading) ink, or it disappears against the band.
    const withCode: ProseV2 = {
      ...prose,
      overview: { lede: 'Use `aria-checked` on the box.', body: ['It updates on toggle.'] },
    };
    // No description, so the AI lede is what lands on the header band.
    const lead = findSlot(asNode(await buildFrom(undescribed, withCode)), 'definitionLead');
    expect(lead).not.toBeNull();
    const node = lead as unknown as FakeText;
    const codeStart = node.characters.indexOf('aria-checked');
    expect(codeStart).toBeGreaterThanOrEqual(0);
    expect(node.getRangeFill(codeStart)).toEqual(solidFill(palette.onHeader));
  });

  it('draws no "None." row for a variant whose tokens all match the default', async () => {
    // A non-default variant with no differing bindings produces an empty token
    // table. The "Identical to default" note under it is what explains that;
    // a "None." row would read as "this variant binds nothing".
    const twoVariants = {
      ...spec,
      props: [{ name: 'type', kind: 'variant', options: ['Primary', 'Secondary'], default: 'Primary' }],
      variants: [{ prop: 'type', values: ['Primary', 'Secondary'] }],
      variantInstances: [
        { nodeId: '1:10', name: 'type=Primary', values: { type: 'Primary' } },
        { nodeId: '1:11', name: 'type=Secondary', values: { type: 'Secondary' } },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(
      twoVariants, null, new Set<SectionId>(['tokens']), new Set(['1:10', '1:11']),
      { measureViews: [], aiEnabled: false },
    );
    const section = await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null) as unknown as FakeSection;
    const chars = section.children.flatMap((f) => (f as FakeFrame).textChars());
    expect(chars.join('\n')).toContain('Identical to default');
    expect(chars).not.toContain('None.');
  });

  it('keeps the Overview as a body section when lifting it would leave no Usage frame', async () => {
    // The subtitle rides the Usage header. A one-sentence description on a
    // component with nothing else in Usage would otherwise lift away into a
    // header that is never drawn, and the only human-written line in the file
    // would vanish.
    const lonely = { ...spec, related: [] } as unknown as IntermediateSpec;
    const model = buildDocModel(lonely, null, ALL, new Set(), { measureViews: [], aiEnabled: false });
    const section = await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null) as unknown as FakeSection;
    const frames = section.children as FakeFrame[];
    expect(frames.map((f) => f.name)).toEqual(['1 Usage', '2 Specifications']);
    expect(frames[0].textChars()).toContain('Selects one or more options.');
  });
});

// ---------------------------------------------------------------------------
// Measure section seam (Task 13): docFrame's 'measure' case must call the new
// three-argument buildMeasureSection and print scaleNote's text under the
// diagram, but only when the component was too wide for the column.
// ---------------------------------------------------------------------------

/** A minimal spec that draws nothing but the Measurements section: no anatomy,
 *  no tokens, no variants, so buildDocModel's other branches stay untouched
 *  and the only thing on canvas is the measure diagram (or its fallback). */
const measureSpec = {
  name: 'button', figmaKey: '', figmaFile: 'f', figmaFileName: 'DS', figmaNode: '2:1',
  description: '', documentationLinks: [],
  anatomy: [], anatomyComponentId: 'comp:measure',
  props: [], variants: [], states: [], variantInstances: [],
  tokens: [], rawValues: [], related: [], gaps: [], layout: [], nodeEffects: [],
} as unknown as IntermediateSpec;

/** A COMPONENT node wide/narrow enough to drive buildMeasureSection's own
 *  scale math, with no auto-layout so the diagram only draws the plain
 *  top/left total-size badges (no rails to nudge). */
function fakeMeasureComponent(width: number, height = 100): Record<string, unknown> {
  return {
    type: 'COMPONENT',
    width, height,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    itemSpacing: 0, layoutMode: 'NONE', cornerRadius: 0,
    children: [] as unknown[],
    createInstance: () => fakeMeasureInstance(width, height),
  };
}

/** The instance the last buildMeasureDoc created, so a test can assert what
 *  was (or was not) done to it. */
let lastMeasureInstance: { rescaleCalls: number[] } | null = null;

function fakeMeasureInstance(width: number, height: number): Record<string, unknown> {
  const rescaleCalls: number[] = [];
  const inst: Record<string, unknown> = {
    id: 'measure-inst', x: 0, y: 0, width, height, rescaleCalls,
    setExplicitVariableModeForCollection: () => {},
    remove: () => {},
  };
  inst.rescale = (s: number) => { rescaleCalls.push(s); inst.width = width * s; inst.height = height * s; };
  lastMeasureInstance = inst as unknown as { rescaleCalls: number[] };
  return inst;
}

/** A frame stand-in that never throws on a hugging width. measureSection's own
 *  badges hug their text and the module reads badge.width/.height directly to
 *  place them (see placeRightRail/placeBottomRail and the single centered
 *  width/height badges), which the shared FakeFrame deliberately refuses to
 *  model (by design — see fakeFigma.ts). This test only cares whether the
 *  scale note text appears, not exact badge geometry, so a loose stub whose
 *  width/height default to 0 and change only via resize() is enough. */
function looseFrame(): Record<string, unknown> {
  const f: Record<string, unknown> = {
    type: 'FRAME', children: [] as unknown[], width: 0, height: 0, x: 0, y: 0, fills: [],
    remove: () => {},
  };
  const pluginData: Record<string, string> = {};
  f.appendChild = (n: unknown) => { (f.children as unknown[]).push(n); };
  f.resize = (w: number, h: number) => { f.width = w; f.height = h; };
  f.resizeWithoutConstraints = (w: number, h: number) => { f.width = w; f.height = h; };
  f.setPluginData = (k: string, v: string) => { pluginData[k] = v; };
  f.getPluginData = (k: string) => pluginData[k] ?? '';
  return f;
}

/** Depth-first search for a FakeText whose characters match `pattern`. */
function findText(root: unknown, pattern: RegExp): string | null {
  if (root instanceof FakeText && pattern.test(root.characters)) return root.characters;
  const children = (root as { children?: unknown[] })?.children ?? [];
  for (const child of children) {
    const hit = findText(child, pattern);
    if (hit) return hit;
  }
  return null;
}

async function buildMeasureDoc(componentWidth: number): Promise<FakeSection> {
  lastMeasureInstance = null;
  installFakeFigma({
    createFrame: () => looseFrame(),
    getNodeByIdAsync: async (id: string) =>
      (id === measureSpec.anatomyComponentId ? fakeMeasureComponent(componentWidth) : null),
  });
  const model = buildDocModel(
    measureSpec, null, new Set<SectionId>(['measurements']), new Set(), { measureViews: [], aiEnabled: false },
  );
  return await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null) as unknown as FakeSection;
}

describe('docFrame measure section', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('prints the scale note under the diagram when the component is wider than the column', async () => {
    const section = await buildMeasureDoc(3000);
    expect(findText(section, /^Shown at \d+%$/)).toBe('Shown at 35%');
  });

  it('prints no scale note when the component fits at true size', async () => {
    const section = await buildMeasureDoc(200);
    expect(findText(section, /^Shown at \d+%$/)).toBeNull();
  });

  it('never upscales a narrow component: rescale is not called at all', async () => {
    // The absent scale note above passes just as well if the code upscaled and
    // then refused to mention it, so assert on the instance itself.
    await buildMeasureDoc(200);
    expect(lastMeasureInstance).not.toBeNull();
    expect(lastMeasureInstance!.rescaleCalls).toEqual([]);
  });

  it('scales a wide component down, and only down', async () => {
    await buildMeasureDoc(3000);
    expect(lastMeasureInstance!.rescaleCalls).toHaveLength(1);
    expect(lastMeasureInstance!.rescaleCalls[0]).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// The keyed writing slots on a component that has both variant axes and a
// state matrix. `variantsIntro` is one blob, `variantsGuide` is keyed by
// option value and `stateMeaning` by state name, so each has to survive the
// build -> read-back -> merge -> rebuild loop under its own key. This is the
// seam where a guide entry naming an option the spec no longer has used to
// live forever, so the fixture is worth holding onto.
// ---------------------------------------------------------------------------

/** A component with a non-state axis (`type`) and a state axis (`State`), so
 *  the Variants matrix and the States table are both drawn. */
const variantSpec = {
  name: 'button', figmaKey: '', figmaFile: 'f', figmaFileName: 'DS', figmaNode: '3:1',
  description: '', documentationLinks: [],
  anatomy: [{ name: 'Label', nested: false, id: '3:4', depth: 0, type: 'TEXT', path: 'Container/Label' }],
  anatomyComponentId: '3:2',
  props: [
    { name: 'type', kind: 'variant', options: ['Primary', 'Secondary'], default: 'Primary' },
    { name: 'State', kind: 'variant', options: ['Default', 'Hover'], default: 'Default' },
  ],
  variants: [
    { prop: 'type', values: ['Primary', 'Secondary'] },
    { prop: 'State', values: ['Default', 'Hover'] },
  ],
  variantInstances: [
    { nodeId: '3:10', name: 'Primary/Default', values: { type: 'Primary', State: 'Default' } },
    { nodeId: '3:11', name: 'Primary/Hover', values: { type: 'Primary', State: 'Hover' } },
    { nodeId: '3:12', name: 'Secondary/Default', values: { type: 'Secondary', State: 'Default' } },
    { nodeId: '3:13', name: 'Secondary/Hover', values: { type: 'Secondary', State: 'Hover' } },
  ],
  states: ['Default', 'Hover'],
  tokens: [
    { part: 'Label', path: 'Container/Label', property: 'fill', ...ident('color/text'), conditions: {} },
    { part: 'Label', path: 'Container/Label', property: 'fill', ...ident('color/text/hover'), conditions: { State: ['Hover'] } },
  ],
  rawValues: [], related: [], gaps: [], layout: [], nodeEffects: [],
} as unknown as IntermediateSpec;

const variantProse: ProseV2 = {
  v: 2,
  variantsIntro: 'Type carries the emphasis; state is not a type.',
  variantsGuide: [
    { name: 'Primary', guidance: 'the one action you want taken.' },
    { name: 'Secondary', guidance: 'everything else on the same surface.' },
  ],
  states: [
    { name: 'Default', whenItApplies: 'Nothing is pointing at the button.' },
    { name: 'Hover', whenItApplies: 'A pointer is over the button.' },
  ],
};

async function buildVariantDoc(p: ProseV2 | null): Promise<FakeSection> {
  const model = buildDocModel(
    variantSpec, p, new Set<SectionId>(['variants', 'states']), new Set(),
    { measureViews: [], aiEnabled: true },
  );
  return await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null) as unknown as FakeSection;
}

describe('docFrame variant and state writing slots', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('writes the intro, the per-option guide and the per-state meaning, and reads all three back', async () => {
    const read = readCanvasProse(asNode(await buildVariantDoc(variantProse)));
    expect(read.variantsIntro).toBe(variantProse.variantsIntro);
    expect(read.variantsGuide).toEqual(variantProse.variantsGuide);
    expect(read.states).toEqual(variantProse.states);
  });

  it('is a fixed point across merge and rebuild', async () => {
    const first = readCanvasProse(asNode(await buildVariantDoc(variantProse)));
    const second = readCanvasProse(asNode(await buildVariantDoc(mergeProse(null, first))));
    expect(second).toEqual(first);
  });

  it('drops a stored guide entry whose option value the spec no longer has', async () => {
    const stale: ProseV2 = {
      ...variantProse,
      variantsGuide: [
        ...(variantProse.variantsGuide ?? []),
        { name: 'Ghost', guidance: 'renamed away since this was written.' },
      ],
    };
    const section = await buildVariantDoc(stale);
    expect(section.children.flatMap((f) => (f as FakeFrame).textChars()).join('\n'))
      .not.toContain('renamed away since this was written.');
    expect(readCanvasProse(asNode(section)).variantsGuide).toEqual(variantProse.variantsGuide);
  });
});
