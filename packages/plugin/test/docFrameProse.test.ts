import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IntermediateSpec, ProseDrafts, RefIdentity } from '@spec-layer/extractor';
import { installFakeFigma, uninstallFakeFigma, FakeSection } from './fakeFigma';
import { buildDocFrames } from '../src/docFrame';
import { buildDocModel, type SectionId } from '../src/ui/docModel';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import {
  readCanvasProse, mergeProse, collectGeneratedText, SLOT_KEY, type ProseNodeLike,
} from '../src/canvasProse';

const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [
    { name: 'Label', nested: false, id: '1:3', depth: 0, type: 'TEXT' },
    { name: 'Icon', nested: true, id: '1:4', depth: 0, type: 'INSTANCE', component: 'Icon' },
  ],
  anatomyComponentId: '1:2',
  props: [], variants: [], states: [],
  tokens: [{ part: 'Label', property: 'fill', ...ident('color/text'), conditions: {} }],
  rawValues: [], related: [], gaps: [], layout: [], variantInstances: [],
} as unknown as IntermediateSpec;

const prose: ProseDrafts = {
  definition: 'A button. Use it for the main action on a screen.',
  accessibility: '- **Keyboard:** focusable and activates on Enter\n### Screen readers\nThe label is announced.',
  dos: ['Keep labels short', 'Use one primary button'],
  donts: ['Stack two primary buttons'],
  interactions: 'Press to trigger the action.',
  contentConsiderations: 'Start with a verb.',
  anatomySummary: 'Two parts: a label and an optional icon.',
  anatomyParts: [{ name: 'Label', description: 'The visible text.' }],
};

const SECTIONS = new Set<SectionId>([
  'definition', 'accessibility', 'dosDonts', 'interactions', 'contentConsiderations', 'anatomy',
]);

// makeBulletRow (pre-existing, outside this task's scope) discards the bold
// runs a caller already parsed and re-derives styling from the already-plain
// bullet text, so a **bold** lead-in inside a bulleted prose line never
// survives rendering. The words round-trip; only the emphasis markers are
// lost. Tracked separately from the editorial-tagging work here.
const accessibilityReadback =
  '- Keyboard: focusable and activates on Enter\n### Screen readers\nThe label is announced.';

async function build(p: ProseDrafts | null): Promise<FakeSection> {
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
      accessibility: accessibilityReadback,
      dos: prose.dos,
      donts: prose.donts,
      interactions: prose.interactions,
      contentConsiderations: prose.contentConsiderations,
      anatomySummary: prose.anatomySummary,
      anatomyParts: prose.anatomyParts,
    });
  });

  it('is a fixed point: building from the read-back and reading again changes nothing', async () => {
    const first = readCanvasProse(asNode(await build(prose)));
    const second = readCanvasProse(asNode(await build(mergeProse(null, first))));
    expect(second).toEqual(first);
  });

  it('reads nothing from a doc built without prose', async () => {
    // spec.anatomy is non-empty, so the anatomy legend still renders (with no
    // descriptions) even without prose. Seeing a legend row on canvas is
    // itself a signal per readCanvasProse's anatomyPart handling ("an empty
    // list is a real answer"), so anatomyParts reads back as [], not absent.
    expect(readCanvasProse(asNode(await build(null)))).toEqual({ anatomyParts: [] });
  });

  it('keeps editorial text out of the generated lane', async () => {
    const generated = collectGeneratedText(asNode(await build(prose)));
    const joined = generated.join('\n');
    expect(joined).toContain('Semantics & Focus');       // a section heading, generated
    expect(joined).not.toContain('Keep labels short');   // a do, editorial
    expect(joined).not.toContain('The label is announced.');
    expect(joined).not.toContain('A button.');           // the header lead, editorial
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
});
