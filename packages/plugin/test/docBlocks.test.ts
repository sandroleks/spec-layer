import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';
import {
  buildTwoColumns, buildGuidelinePairs, buildKeyboardTable,
  buildPropertiesTable, buildStatesTable, columnParagraph, chip, fitChip,
} from '../src/docBlocks';
import { applyThemeToKit, palette, solidFill } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import { readCanvasProse, type ProseNodeLike } from '../src/canvasProse';
import { parseRuns } from '../src/ui/docModel';

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

  it('round-trips two columns, pairs, keyboard, properties and states through the canvas reader', () => {
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
    doc.appendChild(buildStatesTable([
      { name: 'Default', changes: [], whenItApplies: null },
      { name: 'Hover', changes: [{ part: 'Box', property: 'border', from: 'color/a', to: 'color/b' }], whenItApplies: 'Pointer over it.' },
    ], 768));

    expect(readCanvasProse(asNode(doc))).toEqual({
      whenToUse: ['Many options.'],
      whenNotToUse: ['One option.'],
      guidelines: [
        { do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not hide the label.', reason: '' } },
        { do: null, dont: { rule: 'Do not nest it.', reason: 'Nesting breaks focus.' } },
      ],
      keyboard: [{ keys: ['Enter', 'Space'], action: 'Toggles it.' }, { keys: ['Shift+Tab'], action: 'Moves focus back.' }],
      properties: [{ name: 'showLabel', description: 'Hides the label.' }],
      states: [{ name: 'Hover', whenItApplies: 'Pointer over it.' }],
    });
  });

  it('writes each state change as a part and property line over from and to chips, and says when nothing changes', () => {
    const table = buildStatesTable([
      { name: 'Default', changes: [], whenItApplies: null },
      { name: 'Hover', changes: [{ part: 'checkBox', property: 'border', from: 'color/a', to: 'color/b' }, { part: 'checkBox', property: 'shadow', from: null, to: 'shadow/1' }], whenItApplies: null },
    ], 768) as unknown as FakeFrame;
    const chars = table.textChars();
    expect(chars).toContain('No token changes');
    // One chip per token, never one chip holding "part property: a → b": a
    // token path is long, and two of them in one chip overran the column.
    expect(chars).toEqual(expect.arrayContaining(['Check box border', 'color/a', '→', 'color/b', 'Check box shadow', 'added', 'shadow/1']));
    expect(chars.some((c) => c.includes('→ color'))).toBe(false);
    // The changes column gets more than half the table; the sentence column
    // grows into the rest.
    const head = table.children[0] as FakeFrame;
    const cells = head.children as FakeFrame[];
    expect(cells[1].width).toBeGreaterThanOrEqual(Math.floor(768 * 0.5));
    expect(cells[2].layoutSizingHorizontal).toBe('FILL');
  });

  it('lets a chip wider than its column wrap its text instead of overrunning it', () => {
    const wide = chip('Background/Chip/Chip Neutral Hover Pressed Selected') as unknown as FakeFrame;
    (wide.children[0] as FakeText).width = 400;
    fitChip(wide as unknown as FrameNode, 300);
    expect(wide.layoutSizingHorizontal).toBe('FILL');
    expect((wide.children[0] as FakeText).textAutoResize).toBe('HEIGHT');

    const narrow = chip('color/a') as unknown as FakeFrame;
    (narrow.children[0] as FakeText).width = 60;
    fitChip(narrow as unknown as FrameNode, 300);
    expect(narrow.layoutSizingHorizontal).toBe('HUG');
    expect((narrow.children[0] as FakeText).textAutoResize).toBe('WIDTH_AND_HEIGHT');
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
