import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';
import { fanOutPins, buildAnatomyLegend, scaleNote } from '../src/anatomySection';
import { applyThemeToKit } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';
import { SLOT_KEY, SLOT_PART_KEY } from '../src/canvasProse';

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
