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

async function build(p: ProseV2 | null, aiEnabled = true): Promise<FakeSection> {
  const model = buildDocModel(spec, p, ALL, new Set(), { measureViews: [], aiEnabled });
  return await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null) as unknown as FakeSection;
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
    const section = await build(prose);
    const tagged: string[] = [];
    const visit = (n: ProseNodeLike): void => {
      if (n.getPluginData(SLOT_KEY) === 'definitionLead') tagged.push(n.characters ?? '');
      for (const c of n.children ?? []) visit(c);
    };
    visit(asNode(section));
    expect(tagged).toEqual(['A checkbox selects options.']);
  });

  it('paints a code span in the header lead with an ink other than the heading ink', async () => {
    // The header band uses palette.headerBg, which is the same colour as
    // palette.heading on the default theme; a code span there must not use
    // applyRuns' default (heading) ink, or it disappears against the band.
    const withCode: ProseV2 = {
      ...prose,
      overview: { lede: 'Use `aria-checked` on the box.', body: ['It updates on toggle.'] },
    };
    const lead = findSlot(asNode(await build(withCode)), 'definitionLead');
    expect(lead).not.toBeNull();
    const node = lead as unknown as FakeText;
    const codeStart = node.characters.indexOf('aria-checked');
    expect(codeStart).toBeGreaterThanOrEqual(0);
    expect(node.getRangeFill(codeStart)).toEqual(solidFill(palette.onHeader));
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
