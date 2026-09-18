import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame } from './fakeFigma';
import {
  buildFactsStrip, buildTwoColumns, buildGuidelinePairs, buildKeyboardTable,
  buildPropertiesTable, buildStatesTable, measuredParagraph,
} from '../src/docBlocks';
import { applyThemeToKit, PROSE_MEASURE } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import { readCanvasProse, type ProseNodeLike } from '../src/canvasProse';
import { parseRuns } from '../src/ui/docModel';

const asNode = (f: FakeFrame): ProseNodeLike => f as unknown as ProseNodeLike;

describe('docBlocks', () => {
  beforeEach(async () => { installFakeFigma(); await applyThemeToKit(resolveTheme(emptyBrandTheme())); });
  afterEach(() => uninstallFakeFigma());

  it('draws the facts strip as label over value pairs plus the source file and links', () => {
    const strip = buildFactsStrip({
      items: [{ label: 'Properties', value: '4' }, { label: 'States', value: '2' }],
      sourceFile: 'Design System', links: ['https://example.com/checkbox'],
    }, 768) as unknown as FakeFrame;
    expect(strip.textChars()).toEqual(['PROPERTIES', '4', 'STATES', '2', 'Design System', 'https://example.com/checkbox']);
  });

  it('draws nothing for an empty facts strip', () => {
    expect(buildFactsStrip({ items: [], sourceFile: null, links: [] }, 768)).toBeNull();
  });

  it('caps a paragraph at the prose measure', () => {
    const p = measuredParagraph('Some text.', 768) as unknown as FakeFrame;
    expect(p.width).toBe(PROSE_MEASURE);
    const narrow = measuredParagraph('Some text.', 500) as unknown as FakeFrame;
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

  it('writes the states table changes as chips and says when nothing changes', () => {
    const table = buildStatesTable([
      { name: 'Default', changes: [], whenItApplies: null },
      { name: 'Hover', changes: [{ part: 'Box', property: 'border', from: 'color/a', to: 'color/b' }, { part: 'Box', property: 'shadow', from: null, to: 'shadow/1' }], whenItApplies: null },
    ], 768) as unknown as FakeFrame;
    const chars = table.textChars();
    expect(chars).toContain('No token changes');
    expect(chars).toContain('Box border: color/a → color/b');
    expect(chars).toContain('Box shadow: added shadow/1');
  });

  it('omits the description column when no row has one', () => {
    const table = buildPropertiesTable([{ name: 'a', type: 'Text', values: '', defaultValue: '', description: null }], false, 768) as unknown as FakeFrame;
    expect(table.textChars()).toEqual(['PROPERTY', 'TYPE', 'VALUES', 'DEFAULT', 'a', 'Text', '', '']);
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
