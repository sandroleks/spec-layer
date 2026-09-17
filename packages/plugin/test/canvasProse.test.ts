import { describe, it, expect } from 'vitest';
import type { ProseV2 } from '@spec-layer/extractor';
import {
  SLOT_KEY, SLOT_PART_KEY, LINE_KEY,
  readCanvasProse, mergeProse, collectGeneratedText, textToMarkdown,
  type ProseNodeLike,
} from '../src/canvasProse';

// --- node builders ----------------------------------------------------------

type Font = { family: string; style: string };
const REGULAR: Font = { family: 'Inter', style: 'Regular' };
const BOLD: Font = { family: 'Inter', style: 'Bold' };

interface Seg { characters: string; fontName: Font }

function text(chars: string, opts: { segments?: Seg[]; data?: Record<string, string> } = {}): ProseNodeLike {
  const data = opts.data ?? {};
  return {
    type: 'TEXT',
    characters: chars,
    getPluginData: (k: string) => data[k] ?? '',
    ...(opts.segments
      ? { getStyledTextSegments: () => opts.segments as Seg[] }
      : {}),
  };
}

function frame(children: ProseNodeLike[], data: Record<string, string> = {}, type = 'FRAME'): ProseNodeLike {
  return { type, children, getPluginData: (k: string) => data[k] ?? '' };
}

const slot = (name: string, extra: Record<string, string> = {}) => ({ [SLOT_KEY]: name, ...extra });
const line = (kind: string) => ({ [LINE_KEY]: kind });

/** A bullet row as makeBulletRow builds it: marker text, then content text. */
function bulletRow(content: string, segments?: Seg[]): ProseNodeLike {
  return frame([text('•'), text(content, { segments })], line('bullet'));
}

// --- textToMarkdown ---------------------------------------------------------

describe('textToMarkdown', () => {
  it('returns the characters when the node cannot report segments', () => {
    expect(textToMarkdown(text('Plain words'))).toBe('Plain words');
  });

  it('wraps bold segments in double asterisks', () => {
    const node = text('Keyboard: focusable', {
      segments: [
        { characters: 'Keyboard:', fontName: BOLD },
        { characters: ' focusable', fontName: REGULAR },
      ],
    });
    expect(textToMarkdown(node)).toBe('**Keyboard:** focusable');
  });

  it('does not wrap whitespace-only bold segments', () => {
    const node = text('a b', {
      segments: [
        { characters: 'a', fontName: REGULAR },
        { characters: ' ', fontName: BOLD },
        { characters: 'b', fontName: REGULAR },
      ],
    });
    expect(textToMarkdown(node)).toBe('a b');
  });
});

const MEDIUM: Font = { family: 'Inter', style: 'Medium' };

describe('textToMarkdown code runs', () => {
  it('reads a Medium segment back as a code span', () => {
    const node = text('Set aria-checked now', {
      segments: [
        { characters: 'Set ', fontName: REGULAR },
        { characters: 'aria-checked', fontName: MEDIUM },
        { characters: ' now', fontName: REGULAR },
      ],
    });
    expect(textToMarkdown(node)).toBe('Set `aria-checked` now');
  });
});

/** A container of tagged lines, as buildProseSlot renders one. */
const block = (slotName: string, lines: ProseNodeLike[]) => frame(lines, slot(slotName));
const keyed = (slotName: string, key: string, children: ProseNodeLike[]) =>
  frame(children, { ...slot(slotName), [SLOT_PART_KEY]: key });

describe('readCanvasProse', () => {
  it('reads every slot of a v2 document', () => {
    const doc = frame([
      text('A box.', { data: slot('definitionLead') }),
      block('definition', [text('Use it in forms.', { data: line('paragraph') })]),
      block('whenToUse', [bulletRow('Several options.')]),
      block('whenNotToUse', [bulletRow('One option. Use a Radio.')]),
      block('variantsIntro', [text('Style sets weight.', { data: line('paragraph') })]),
      keyed('variantsGuide', 'Filled', [text('Filled: the default.')]),
      text('A box and a label.', { data: slot('anatomySummary') }),
      keyed('anatomyPart', 'Label', [text('Label: Names the option.')]),
      keyed('propertyDescription', 'showLabel', [text('Hides the label.')]),
      keyed('stateMeaning', 'Hover', [text('Pointer over the box.')]),
      keyed('keyboardRow', 'Enter + Space', [text('Enter'), text('Space'), text('Toggles it.')]),
      block('pointer', [bulletRow('Clicking toggles.')]),
      block('semantics', [bulletRow('Name: the label.', [{ characters: 'Name:', fontName: BOLD }, { characters: ' the label.', fontName: REGULAR }])]),
      block('content', [bulletRow('Write statements.')]),
      keyed('guidelinePair', '0', [
        frame([text('Pair it with a label.'), text('It widens the target.')], slot('guidelineDo')),
        frame([text('Do not use it for one choice.'), text('')], slot('guidelineDont')),
      ]),
      keyed('guidelinePair', '1', [
        frame([text('Keep labels short.'), text('')], slot('guidelineDo')),
      ]),
    ]);
    expect(readCanvasProse(doc)).toEqual({
      overview: { lede: 'A box.', body: ['Use it in forms.'] },
      whenToUse: ['Several options.'],
      whenNotToUse: ['One option. Use a Radio.'],
      variantsIntro: 'Style sets weight.',
      variantsGuide: [{ name: 'Filled', guidance: 'the default.' }],
      anatomySummary: 'A box and a label.',
      anatomyParts: [{ name: 'Label', role: 'Names the option.' }],
      properties: [{ name: 'showLabel', description: 'Hides the label.' }],
      states: [{ name: 'Hover', whenItApplies: 'Pointer over the box.' }],
      keyboard: [{ keys: ['Enter', 'Space'], action: 'Toggles it.' }],
      pointer: ['Clicking toggles.'],
      semantics: ['**Name:** the label.'],
      content: ['Write statements.'],
      guidelines: [
        { do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: { rule: 'Do not use it for one choice.', reason: '' } },
        { do: { rule: 'Keep labels short.', reason: '' }, dont: null },
      ],
    });
  });

  it('reads an undescribed anatomy row as no role and an edited description by the tagged name', () => {
    const doc = frame([
      keyed('anatomyPart', 'Icon: Left', [text('Icon: Left  ·  Icon')]),
      keyed('anatomyPart', 'Label', [text('Label: Names it.')]),
    ]);
    expect(readCanvasProse(doc).anatomyParts).toEqual([{ name: 'Label', role: 'Names it.' }]);
  });

  it('skips instance subtrees and leaves an unknown slot alone', () => {
    const doc = frame([
      frame([text('Label', { data: slot('definitionLead') })], {}, 'INSTANCE'),
      frame([text('future')], slot('somethingNew')),
    ]);
    expect(readCanvasProse(doc)).toEqual({});
  });

  it('accumulates a repeated block rather than overwriting it', () => {
    const doc = frame([
      block('pointer', [bulletRow('One.')]),
      block('pointer', [bulletRow('Two.')]),
    ]);
    expect(readCanvasProse(doc).pointer).toEqual(['One.', 'Two.']);
  });

  it('orders guideline pairs by their index key whatever the canvas order', () => {
    const doc = frame([
      keyed('guidelinePair', '1', [frame([text('B'), text('')], slot('guidelineDo'))]),
      keyed('guidelinePair', '0', [frame([text('A'), text('')], slot('guidelineDo'))]),
    ]);
    expect(readCanvasProse(doc).guidelines?.map((g) => g.do?.rule)).toEqual(['A', 'B']);
  });

  it('reads a three-node guideline card as plain text, ignoring the leading DO/DONT label', () => {
    const doc = frame([
      keyed('guidelinePair', '0', [
        frame([
          text('DO', { segments: [{ characters: 'DO', fontName: MEDIUM }] }),
          text('Pair it with a label.', { segments: [{ characters: 'Pair it with a label.', fontName: BOLD }] }),
          text('It widens the target.'),
        ], slot('guidelineDo')),
      ]),
    ]);
    expect(readCanvasProse(doc).guidelines).toEqual([
      { do: { rule: 'Pair it with a label.', reason: 'It widens the target.' }, dont: null },
    ]);
  });
});

describe('mergeProse', () => {
  const stored: ProseV2 = { v: 2, overview: { lede: 'Stored.', body: [] }, pointer: ['stored pointer'] };
  it('lets the canvas win per field and fills the rest from storage', () => {
    expect(mergeProse(stored, { pointer: ['canvas pointer'] })).toEqual({
      v: 2, overview: { lede: 'Stored.', body: [] }, pointer: ['canvas pointer'],
    });
  });
  it('is null when neither side has content', () => {
    expect(mergeProse(null, {})).toBeNull();
    expect(mergeProse({ v: 2 }, { anatomyParts: [] })).toBeNull();
  });

  const storedOverview: ProseV2 = { v: 2, overview: { lede: 'Stored lede.', body: ['Stored body.'] } };
  it('keeps the stored body when only the header lead is tagged on canvas', () => {
    expect(mergeProse(storedOverview, { overview: { lede: 'Canvas lede.' } })).toEqual({
      v: 2, overview: { lede: 'Canvas lede.', body: ['Stored body.'] },
    });
  });
  it('keeps the stored lede when only the Overview body is tagged on canvas', () => {
    expect(mergeProse(storedOverview, { overview: { body: ['Canvas body.'] } })).toEqual({
      v: 2, overview: { lede: 'Stored lede.', body: ['Canvas body.'] },
    });
  });
});

describe('collectGeneratedText', () => {
  it('returns text outside slots, instances and the publish pill only', () => {
    const doc = frame([
      text('Heading'),
      frame([text('editorial')], slot('semantics')),
      frame([text('instance text')], {}, 'INSTANCE'),
      text('v1.0.0 · Published', { data: { specLayerPill: '1' } }),
      text('Cell'),
    ]);
    expect(collectGeneratedText(doc)).toEqual(['Heading', 'Cell']);
  });
});
