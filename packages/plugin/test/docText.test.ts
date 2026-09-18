import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';
import { buildProse, makeBulletRow, buildTable, applyRuns } from '../src/docText';
import { parseRuns } from '../src/ui/docModel';
import { applyThemeToKit, palette, solidFill } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';

describe('parseRuns', () => {
  it('reads bold and code runs', () => {
    expect(parseRuns('Use a `<button>` for **actions**.')).toEqual([
      { text: 'Use a ' }, { text: '<button>', code: true }, { text: ' for ' },
      { text: 'actions', bold: true }, { text: '.' },
    ]);
  });
});

describe('docText', () => {
  beforeEach(async () => { installFakeFigma(); await applyThemeToKit(resolveTheme(emptyBrandTheme())); });
  afterEach(() => uninstallFakeFigma());

  it('renders a code span as a Medium run with its own fill and no backticks', () => {
    const [node] = buildProse('Set `aria-checked` on the box.') as unknown as FakeText[];
    expect(node.characters).toBe('Set aria-checked on the box.');
    const segments = node.getStyledTextSegments(['fontName']);
    expect(segments.map((s) => [s.characters, s.fontName.style])).toEqual([
      ['Set ', 'Regular'], ['aria-checked', 'Medium'], [' on the box.', 'Regular'],
    ]);
    expect(node.filledRanges()).toEqual([{ start: 4, end: 16 }]);
  });

  it('keeps bold lead-ins in bullet rows', () => {
    const row = makeBulletRow({ runs: parseRuns('**Name:** the label.'), text: 'Name: the label.' }) as unknown as FakeFrame;
    const content = row.children[1] as FakeText;
    expect(content.characters).toBe('Name: the label.');
    expect(content.getStyledTextSegments(['fontName'])[0]).toMatchObject({ characters: 'Name:', fontName: { style: 'Bold' } });
  });

  it('builds a table whose last column grows and whose others share seventy percent of the width', () => {
    const table = buildTable(['Key', 'Action'], [['Tab', 'Moves focus']], 768) as unknown as FakeFrame;
    const head = table.children[0] as FakeFrame;
    const keyCell = head.children[0] as FakeFrame;
    const actionCell = head.children[1] as FakeFrame;
    expect(keyCell.width).toBe(Math.floor(768 * 0.7));
    expect(actionCell.layoutSizingHorizontal).toBe('FILL');
    expect(table.textChars()).toEqual(['KEY', 'ACTION', 'Tab', 'Moves focus']);
  });

  it('renders a None. row when there are no data rows, instead of a bare header strip', () => {
    const table = buildTable(['Key', 'Action'], [], 768) as unknown as FakeFrame;
    expect(table.textChars()).toEqual(['KEY', 'ACTION', 'None.']);
  });

  it('paints a code run in an explicit ink instead of the heading ink when given one', () => {
    const node = new FakeText();
    node.characters = 'a code span';
    applyRuns(node as unknown as TextNode, [
      { text: 'a ' }, { text: 'code', code: true }, { text: ' span' },
    ], 0, palette.onHeader);
    expect(node.getRangeFill(3)).toEqual(solidFill(palette.onHeader));
    expect(node.getRangeFill(3)).not.toEqual(solidFill(palette.heading));
  });
});
