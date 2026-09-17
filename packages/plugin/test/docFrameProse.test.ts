import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IntermediateSpec, ProseV2, RefIdentity } from '@spec-layer/extractor';
import { upgradeProseV1 } from '@spec-layer/extractor';
import { installFakeFigma, uninstallFakeFigma, FakeSection, FakeText } from './fakeFigma';
import { buildDocFrames } from '../src/docFrame';
import { buildDocModel, type SectionId } from '../src/ui/docModel';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import { palette, solidFill } from '../src/frameKit';
import {
  readCanvasProse, mergeProse, collectGeneratedText, SLOT_KEY, type ProseNodeLike,
} from '../src/canvasProse';

const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  description: '',
  documentationLinks: [],
  anatomy: [
    { name: 'Label', nested: false, id: '1:3', depth: 0, type: 'TEXT' },
    { name: 'Icon', nested: true, id: '1:4', depth: 0, type: 'INSTANCE', component: 'Icon' },
  ],
  anatomyComponentId: '1:2',
  props: [], variants: [], states: [],
  tokens: [{ part: 'Label', property: 'fill', ...ident('color/text'), conditions: {} }],
  rawValues: [], related: [], gaps: [], layout: [], variantInstances: [],
} as unknown as IntermediateSpec;

const prose: ProseV2 = {
  v: 2,
  overview: { lede: 'A button.', body: ['Use it for the main action on a screen.'] },
  anatomySummary: 'Two parts: a label and an optional icon.',
  anatomyParts: [{ name: 'Label', role: 'The visible text.' }],
};

/**
 * Overview and Anatomy are the two editorial slots the renderer still tags.
 * The Docs 2.0 model turns Semantics, Content and the former Interactions
 * section into bullets and a keyboard table, and Do and don't into guideline
 * pairs; Task 12 gives each of those its own slot and this file grows back to
 * cover them.
 */
const SECTIONS = new Set<SectionId>(['definition', 'anatomy']);

async function build(p: ProseV2 | null): Promise<FakeSection> {
  const model = buildDocModel(spec, p, SECTIONS, new Set(), { measureViews: [] });
  const section = await buildDocFrames(model, resolveTheme(emptyBrandTheme()), null);
  return section as unknown as FakeSection;
}

const asNode = (s: FakeSection): ProseNodeLike => s as unknown as ProseNodeLike;

describe('docFrame editorial tags', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('reads every editorial slot back from a freshly built doc', async () => {
    const read = readCanvasProse(asNode(await build(prose)));
    expect(read).toEqual({
      // The lead sentence is lifted into the header, so the definition comes
      // back as lead + body on separate lines. Same words, same order.
      definition: 'A button.\nUse it for the main action on a screen.',
      anatomySummary: prose.anatomySummary,
      // The read-back is still v1-shaped, so a part's role comes back under
      // `description`; Task 9 moves it to the v2 field.
      anatomyParts: [{ name: 'Label', description: 'The visible text.' }],
    });
  });

  it('is a fixed point: building from the read-back and reading again changes nothing', async () => {
    const first = readCanvasProse(asNode(await build(prose)));
    const merged = mergeProse(null, first);
    const second = readCanvasProse(asNode(await build(merged ? upgradeProseV1(merged) : null)));
    expect(second).toEqual(first);
  });

  it('reads nothing from a doc built without prose', async () => {
    // spec.anatomy is non-empty, so the anatomy legend still renders (with no
    // roles) even without prose. Seeing a legend row on canvas is itself a
    // signal per readCanvasProse's anatomyPart handling ("an empty list is a
    // real answer"), so anatomyParts reads back as [], not absent.
    const read = readCanvasProse(asNode(await build(null)));
    expect(read).toEqual({ anatomyParts: [] });
    // But that lone empty array carries no real content, so the two modules
    // must agree: merging it against no stored prose is still "no prose".
    expect(mergeProse(null, read)).toBeNull();
  });

  it('keeps editorial text out of the generated lane', async () => {
    const generated = collectGeneratedText(asNode(await build(prose)));
    const joined = generated.join('\n');
    expect(joined).toContain('Anatomy');                     // a section heading, generated
    expect(joined).not.toContain('The visible text.');       // a part role, editorial
    expect(joined).not.toContain('Two parts');               // the anatomy summary, editorial
    expect(joined).not.toContain('A button.');               // the header lead, editorial
  });

  it('tags the header lead and not the header title', async () => {
    const section = await build(prose);
    const tagged: string[] = [];
    const visit = (n: ProseNodeLike): void => {
      if (n.getPluginData(SLOT_KEY) === 'definitionLead') tagged.push(n.characters ?? '');
      for (const c of n.children ?? []) visit(c);
    };
    visit(asNode(section));
    expect(tagged).toEqual(['A button.']);
  });

  it('paints a code span in the header lead with an ink other than the heading ink', async () => {
    // The header band uses palette.headerBg, which is the same colour as
    // palette.heading on the default theme; a code span there must not use
    // applyRuns' default (heading) ink, or it disappears against the band.
    const withCode: ProseV2 = {
      ...prose,
      overview: { lede: 'Use `aria-checked` on the box.', body: ['It updates on toggle.'] },
    };
    const section = await build(withCode);
    let leadNode: FakeText | null = null;
    const visit = (n: ProseNodeLike): void => {
      if (n.getPluginData(SLOT_KEY) === 'definitionLead') leadNode = n as unknown as FakeText;
      for (const c of n.children ?? []) visit(c);
    };
    visit(asNode(section));
    expect(leadNode).not.toBeNull();
    const node = leadNode as unknown as FakeText;
    const codeStart = node.characters.indexOf('aria-checked');
    expect(codeStart).toBeGreaterThanOrEqual(0);
    expect(node.getRangeFill(codeStart)).not.toEqual(solidFill(palette.heading));
    expect(node.getRangeFill(codeStart)).toEqual(solidFill(palette.onHeader));
  });
});
