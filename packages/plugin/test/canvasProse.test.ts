import { describe, it, expect } from 'vitest';
import type { ProseV2 } from '@spec-layer/extractor';
import {
  SLOT_KEY, SLOT_PART_KEY, LINE_KEY, PLACEHOLDER_KEY, GUIDELINE_LABEL, isUnfilledPlaceholder,
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

  it('reads a revealed part\'s role without the "Shown when" note the legend appends', () => {
    const doc = frame([
      keyed('anatomyPart', 'Required', [text('Required: Marks the field as mandatory.  ·  Shown when isRequired is true')]),
      // No note, and a role that merely ends in "is true": nothing to strip.
      keyed('anatomyPart', 'Label', [text('Label: Reads back when the statement is true')]),
    ]);
    expect(readCanvasProse(doc).anatomyParts).toEqual([
      { name: 'Required', role: 'Marks the field as mandatory.' },
      { name: 'Label', role: 'Reads back when the statement is true' },
    ]);
  });

  it('does not invent a role from a nested part whose component name contains a colon', () => {
    // The legend prints the DISPLAY name ("Icon leading") while the tag keeps
    // the raw key ("iconLeading"); the nested note here ("Icon: 24") itself
    // contains ": ", which used to fool the loose fallback into reading "24"
    // as an authored role.
    const doc = frame([
      keyed('anatomyPart', 'iconLeading', [text('Icon leading  ·  Icon: 24')]),
    ]);
    expect(readCanvasProse(doc).anatomyParts).toEqual([]);
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

// --- placeholders -------------------------------------------------------------

const stamp = (guidance: string) => ({ [PLACEHOLDER_KEY]: guidance });
/** A guidance text node as docBlocks draws it, optionally typed over. */
const guidance = (g: string, typed?: string) => text(typed ?? g, { data: stamp(g) });

describe('isUnfilledPlaceholder', () => {
  it('is true while the node still shows its guidance, ignoring outer whitespace', () => {
    expect(isUnfilledPlaceholder(guidance('Say why.'))).toBe(true);
    expect(isUnfilledPlaceholder(text('  Say why. ', { data: stamp('Say why.') }))).toBe(true);
  });
  it('is false once someone typed over it, and for a node that was never a placeholder', () => {
    expect(isUnfilledPlaceholder(guidance('Say why.', 'Because it is clear.'))).toBe(false);
    expect(isUnfilledPlaceholder(text('Say why.'))).toBe(false);
  });
});

describe('readCanvasProse placeholders', () => {
  const box = (...children: ProseNodeLike[]) => frame([text('Placeholder'), ...children]);

  it('reads an untouched placeholder of every shape as nothing', () => {
    const root = frame([
      box(frame([guidance('Describe what this component is and what it is for.')], slot('definition'))),
      box(frame([frame([guidance('Describe what hover, press, and drag do.')])], slot('pointer'))),
      box(frame([
        frame([text('When to use'), frame([frame([guidance('A.')])], slot('whenToUse'))]),
        frame([text('When not to use'), frame([frame([guidance('B.')])], slot('whenNotToUse'))]),
      ])),
      box(frame([
        frame([text('DO'), guidance('Describe a correct use.'), guidance('Say why it works.')], slot('guidelineDo')),
        frame([text('DON’T'), guidance('Describe a misuse to avoid.'), guidance('Say what goes wrong.')], slot('guidelineDont')),
      ], slot('guidelinePair', { [SLOT_PART_KEY]: '0' }))),
      box(frame([text('KEY'), text('ACTION')]), frame([guidance('Key'), guidance('Describe what this key does.')], slot('keyboardRow'))),
    ]);
    expect(readCanvasProse(root)).toEqual({});
  });

  it('reads what someone typed over the guidance as prose', () => {
    const root = frame([
      box(frame([guidance('Describe it.', 'A checkbox selects options.')], slot('definition'))),
      box(frame([
        frame([guidance('Describe hover.', 'Hover darkens the box.')]),
        frame([guidance('Describe hover.', 'Clicking the label toggles it.')]), // a duplicated row
      ], slot('pointer'))),
      box(frame([
        frame([text('DO'), guidance('Describe a correct use.', 'Pair it with a label.'), guidance('Say why it works.')], slot('guidelineDo')),
        frame([text('DON’T'), guidance('Describe a misuse to avoid.'), guidance('Say what goes wrong.')], slot('guidelineDont')),
      ], slot('guidelinePair', { [SLOT_PART_KEY]: '0' }))),
      box(frame([guidance('Key', 'Shift + Tab'), guidance('Describe it.', 'Moves focus back.')], slot('keyboardRow'))),
    ]);
    expect(readCanvasProse(root)).toEqual({
      overview: { body: ['A checkbox selects options.'] },
      pointer: ['Hover darkens the box.', 'Clicking the label toggles it.'],
      guidelines: [{ do: { rule: 'Pair it with a label.', reason: '' }, dont: null }],
      keyboard: [{ keys: ['Shift', 'Tab'], action: 'Moves focus back.' }],
    });
  });

  it('drops a key-less keyboard row until both its key and its action are filled', () => {
    const keyOnly = frame([frame([guidance('Key', 'Tab'), guidance('Describe it.')], slot('keyboardRow'))]);
    const actionOnly = frame([frame([guidance('Key'), guidance('Describe it.', 'Moves focus.')], slot('keyboardRow'))]);
    expect(readCanvasProse(keyOnly)).toEqual({});
    expect(readCanvasProse(actionOnly)).toEqual({});
  });

  it('still skips the legacy To be written. line', () => {
    const root = frame([frame([text('To be written.', { data: line('placeholder') })], slot('definition'))]);
    expect(readCanvasProse(root)).toEqual({});
  });
});

describe('readCanvasProse guideline cards', () => {
  const label = (chars: string) => text(chars, { data: line('label') });
  const pair = (...cards: ProseNodeLike[]) => frame([keyed('guidelinePair', '0', cards)]);
  const doCard = (...children: ProseNodeLike[]) => frame(children, slot('guidelineDo'));

  it('reads no card when the rule node is deleted and the reason is still guidance', () => {
    const root = pair(doCard(label('DO'), guidance('Say why it works.')));
    expect(readCanvasProse(root)).toEqual({});
  });

  it('reads the rule with an empty reason when the reason node is deleted', () => {
    const root = pair(doCard(label('DO'), guidance('Describe a correct use.', 'Pair it with a label.')));
    expect(readCanvasProse(root).guidelines).toEqual([{ do: { rule: 'Pair it with a label.', reason: '' }, dont: null }]);
  });

  it('never reads the label as a rule or the rule as a reason on a card missing a node', () => {
    const ai = pair(
      doCard(label(GUIDELINE_LABEL.do), text('Pair it with a label.')),
      frame([label(GUIDELINE_LABEL.dont), text('Do not use it for one choice.')], slot('guidelineDont')),
    );
    expect(readCanvasProse(ai).guidelines).toEqual([{
      do: { rule: 'Pair it with a label.', reason: '' },
      dont: { rule: 'Do not use it for one choice.', reason: '' },
    }]);
  });

  it('still skips a legacy untagged label, DO or DON’T', () => {
    const root = pair(
      doCard(text('DO'), text('Pair it with a label.'), text('It widens the target.')),
      frame([text('DON’T'), text('Do not use it for one choice.')], slot('guidelineDont')),
    );
    expect(readCanvasProse(root).guidelines).toEqual([{
      do: { rule: 'Pair it with a label.', reason: 'It widens the target.' },
      dont: { rule: 'Do not use it for one choice.', reason: '' },
    }]);
  });

  it('labels cards with the exact characters the renderer draws', () => {
    expect(GUIDELINE_LABEL).toEqual({ do: 'DO', dont: 'DON\u2019T' });
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
