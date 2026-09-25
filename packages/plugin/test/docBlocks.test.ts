import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';
import {
  buildTwoColumns, buildGuidelinePairs, buildKeyboardTable,
  buildPropertiesTable, columnParagraph, buildPlaceholderBlock,
} from '../src/docBlocks';
import { applyThemeToKit, palette, solidFill } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import { readCanvasProse, collectGeneratedText, PLACEHOLDER_KEY, SLOT_KEY, type ProseNodeLike } from '../src/canvasProse';
import { parseRuns } from '../src/ui/docModel';
import { placeholderShapeFor, type PlaceholderShape } from '../src/ui/placeholders';
import type { SectionId } from '../src/ui/docModel';

const asNode = (f: FakeFrame): ProseNodeLike => f as unknown as ProseNodeLike;

describe('docBlocks', () => {
  beforeEach(async () => { installFakeFigma(); await applyThemeToKit(resolveTheme(emptyBrandTheme())); });
  afterEach(() => uninstallFakeFigma());

  it('lets a paragraph fill the content column, whatever its width', () => {
    // Decided 2026-09-18: prose spans the column like the tables under it. The
    // old 640px readable measure left a visible empty margin on the right.
    const p = columnParagraph('Some text.', 768) as unknown as FakeFrame;
    expect(p.width).toBe(768);
    const narrow = columnParagraph('Some text.', 500) as unknown as FakeFrame;
    expect(narrow.width).toBe(500);
  });

  it('round-trips two columns, pairs, keyboard and properties through the canvas reader', () => {
    const doc = new FakeFrame();
    doc.appendChild(buildTwoColumns(
      { heading: 'When to use', items: [{ runs: parseRuns('Many options.'), text: 'Many options.' }], slot: 'whenToUse' },
      { heading: 'When not to use', items: [{ runs: parseRuns('One option.'), text: 'One option.' }], slot: 'whenNotToUse' },
      768,
    ));
    doc.appendChild(buildGuidelinePairs([
      { do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not hide the label.', reason: '' } },
      { do: null, dont: { rule: 'Do not nest it.', reason: 'Nesting breaks focus.' } },
    ], 768));
    doc.appendChild(buildKeyboardTable([{ keys: ['Enter', 'Space'], action: 'Toggles it.' }, { keys: ['Shift+Tab'], action: 'Moves focus back.' }], 768));
    doc.appendChild(buildPropertiesTable([
      { name: 'showLabel', type: 'Boolean', values: 'true / false', defaultValue: 'true', description: 'Hides the label.' },
      { name: 'label', type: 'Text', values: '', defaultValue: 'Label', description: null },
    ], true, 768));

    expect(readCanvasProse(asNode(doc))).toEqual({
      whenToUse: ['Many options.'],
      whenNotToUse: ['One option.'],
      guidelines: [
        { do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not hide the label.', reason: '' } },
        { do: null, dont: { rule: 'Do not nest it.', reason: 'Nesting breaks focus.' } },
      ],
      keyboard: [{ keys: ['Enter', 'Space'], action: 'Toggles it.' }, { keys: ['Shift+Tab'], action: 'Moves focus back.' }],
      properties: [{ name: 'showLabel', description: 'Hides the label.' }],
    });
  });

  it('gives the properties table a Values column wide enough for a two-word option', () => {
    const table = buildPropertiesTable([
      { name: 'Style', type: 'Variant', values: 'Default · Color Background · Status', defaultValue: 'Default', description: 'Sets the treatment.' },
    ], true, 768) as unknown as FakeFrame;
    const cells = (table.children[0] as FakeFrame).children as FakeFrame[];
    // Four equal fixed columns at 55% gave Values 105px, and "Color
    // Background" broke mid-word. Values now gets the widest fixed share.
    expect(cells[2].width).toBeGreaterThanOrEqual(160);
    expect(cells[2].width).toBeGreaterThan(cells[0].width);
    expect(cells[4].layoutSizingHorizontal).toBe('FILL');
  });

  it('omits the description column when no row has one', () => {
    const table = buildPropertiesTable([{ name: 'a', type: 'Text', values: '', defaultValue: '', description: null }], false, 768) as unknown as FakeFrame;
    expect(table.textChars()).toEqual(['PROPERTY', 'TYPE', 'VALUES', 'DEFAULT', 'a', 'Text', '', '']);
  });

  it("tints Do cards green and Don't cards red, with the label in the matching ink", () => {
    const grid = buildGuidelinePairs([
      { do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not hide the label.', reason: 'It confuses screen readers.' } },
    ], 768) as unknown as FakeFrame;
    const [doCard, dontCard] = (grid.children[0] as FakeFrame).children as FakeFrame[];
    expect(doCard.fills).toEqual(solidFill(palette.doTint));
    expect(doCard.strokes).toEqual(solidFill(palette.doBorder));
    expect((doCard.children[0] as FakeText).fills).toEqual(solidFill(palette.doInk));
    expect(dontCard.fills).toEqual(solidFill(palette.dontTint));
    expect(dontCard.strokes).toEqual(solidFill(palette.dontBorder));
    expect((dontCard.children[0] as FakeText).fills).toEqual(solidFill(palette.dontInk));
    // Semantic, not brand: the inks are fixed and are neither the theme
    // accent nor the heading ink the labels used before.
    expect(palette.doInk).not.toEqual(palette.accent);
    expect(palette.dontInk).not.toEqual(palette.heading);
  });

  it('stretches both cards of a pair to one height, however long each reason runs', () => {
    const grid = buildGuidelinePairs([
      { do: { rule: 'Pair it with a label.', reason: 'Short.' }, dont: { rule: 'Do not hide the label.', reason: 'A much longer reason that wraps onto several lines on canvas and makes this card taller.' } },
    ], 768) as unknown as FakeFrame;
    const row = grid.children[0] as FakeFrame;
    const [doCard, dontCard] = row.children as FakeFrame[];
    // The row hugs the taller card; each card fills the row's height, so the
    // shorter card grows to match instead of ending where its text ends.
    expect(row.counterAxisSizingMode).toBe('AUTO');
    expect(doCard.layoutSizingVertical).toBe('FILL');
    expect(dontCard.layoutSizingVertical).toBe('FILL');
  });

  it('lets the guideline grid hug its height instead of clipping to a 1px placeholder', () => {
    const grid = buildGuidelinePairs([
      { do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not hide the label.', reason: 'It confuses screen readers.' } },
      { do: { rule: 'Give it a large tap target.', reason: 'Small targets miss taps.' }, dont: null },
    ], 768) as unknown as FakeFrame;
    expect(grid.width).toBe(768);
    expect(grid.height).toBeGreaterThan(1);
    const rows = grid.children as FakeFrame[];
    const expectedHeight = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(rows.length - 1, 0) * 16;
    expect(grid.height).toBe(expectedHeight);
  });
});

describe('buildPlaceholderBlock', () => {
  beforeEach(async () => { installFakeFigma(); await applyThemeToKit(resolveTheme(emptyBrandTheme())); });
  afterEach(() => uninstallFakeFigma());

  const shapeOf = (id: SectionId): PlaceholderShape => placeholderShapeFor(id)!;
  const IDS: SectionId[] = ['definition', 'whenToUse', 'dosDonts', 'keyboard', 'pointer', 'accessibility', 'contentConsiderations'];

  /** Every text node below `root`, depth first. */
  const texts = (root: FakeFrame): FakeText[] => root.children.flatMap((c) =>
    c instanceof FakeText ? [c] : c instanceof FakeFrame ? texts(c) : []);

  it('draws a dashed, untagged box whose first child is the Placeholder tag', () => {
    for (const id of IDS) {
      const box = buildPlaceholderBlock(shapeOf(id), 800) as unknown as FakeFrame;
      expect(box.dashPattern).toEqual([4, 3]);
      expect(box.strokes).toEqual(solidFill(palette.border));
      expect(box.getPluginData(SLOT_KEY)).toBe('');
      expect((box.children[0] as FakeFrame).textChars()).toEqual(['Placeholder']);
    }
  });

  it('stamps every guidance node with its guidance, in muted Regular', () => {
    const box = buildPlaceholderBlock(shapeOf('dosDonts'), 800) as unknown as FakeFrame;
    const stamped = texts(box).filter((t) => t.getPluginData(PLACEHOLDER_KEY) !== '');
    expect(stamped.map((t) => t.characters)).toEqual([
      'Describe a correct use.', 'Say why it works.', 'Describe a misuse to avoid.', 'Say what goes wrong.',
    ]);
    for (const t of stamped) {
      expect(t.getPluginData(PLACEHOLDER_KEY)).toBe(t.characters);
      expect(t.fills).toEqual(solidFill(palette.muted));
      expect((t.fontName as { style: string }).style).toBe('Regular');
    }
  });

  it('reads back as nothing untouched, for every shape', () => {
    for (const id of IDS) {
      expect(readCanvasProse(asNode(buildPlaceholderBlock(shapeOf(id), 800) as unknown as FakeFrame))).toEqual({});
    }
  });

  it('reads back what someone typed over it', () => {
    const box = buildPlaceholderBlock(shapeOf('keyboard'), 800) as unknown as FakeFrame;
    const [keyCell, actionCell] = texts(box).filter((t) => t.getPluginData(PLACEHOLDER_KEY) !== '');
    keyCell.characters = 'Space';
    actionCell.characters = 'Toggles the box.';
    expect(readCanvasProse(asNode(box))).toEqual({ keyboard: [{ keys: ['Space'], action: 'Toggles the box.' }] });

    const bullets = buildPlaceholderBlock(shapeOf('accessibility'), 800) as unknown as FakeFrame;
    texts(bullets).find((t) => t.getPluginData(PLACEHOLDER_KEY) !== '')!.characters = 'Render a native input.';
    expect(readCanvasProse(asNode(bullets))).toEqual({ semantics: ['Render a native input.'] });
  });

  it('keeps guidance out of the generated lane, and the tag in it', () => {
    const generated = collectGeneratedText(asNode(buildPlaceholderBlock(shapeOf('whenToUse'), 800) as unknown as FakeFrame));
    expect(generated).toEqual(['Placeholder', 'When to use', 'When not to use']);
  });
});
