import { describe, it, expect } from 'vitest';
import type { ProseDrafts } from '@spec-layer/extractor';
import {
  SLOT_KEY, SLOT_PART_KEY, LINE_KEY, PLACEHOLDER_TEXT,
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

// --- readCanvasProse --------------------------------------------------------

describe('readCanvasProse', () => {
  it('reads nothing from an untagged section', () => {
    const section = frame([frame([text('Usage'), text('Some table cell')])], {}, 'SECTION');
    expect(readCanvasProse(section)).toEqual({});
  });

  it('reads a prose block back as markdown lines', () => {
    const block = frame([
      text('First paragraph.', { data: line('paragraph') }),
      frame([text('Mouse')], line('heading')),
      bulletRow('Click to activate', [
        { characters: 'Click', fontName: BOLD },
        { characters: ' to activate', fontName: REGULAR },
      ]),
      text('Second paragraph.', { data: line('paragraph') }),
    ], slot('accessibility'));
    expect(readCanvasProse(frame([block]))).toEqual({
      accessibility: 'First paragraph.\n### Mouse\n- **Click** to activate\nSecond paragraph.',
    });
  });

  it('skips the untouched placeholder so the slot reads as absent', () => {
    const block = frame([text(PLACEHOLDER_TEXT, { data: line('placeholder') })], slot('interactions'));
    expect(readCanvasProse(frame([block]))).toEqual({});
  });

  it('reads a placeholder that was typed over as a paragraph', () => {
    const block = frame([text('Tap once to open.', { data: line('placeholder') })], slot('interactions'));
    expect(readCanvasProse(frame([block]))).toEqual({ interactions: 'Tap once to open.' });
  });

  it('reads an untagged text node added inside a slot as a paragraph', () => {
    const block = frame([
      text('Generated line.', { data: line('paragraph') }),
      text('Added by the designer.'),
    ], slot('contentConsiderations'));
    expect(readCanvasProse(frame([block]))).toEqual({
      contentConsiderations: 'Generated line.\nAdded by the designer.',
    });
  });

  it('joins the header lead and the definition body, lead first', () => {
    const lead = text('A button.', { data: slot('definitionLead') });
    const body = frame([text('Use it for the main action.', { data: line('paragraph') })], slot('definition'));
    // Header sits in a different frame from the body, as on canvas.
    const section = frame([frame([lead]), frame([body])], {}, 'SECTION');
    expect(readCanvasProse(section)).toEqual({ definition: 'A button.\nUse it for the main action.' });
  });

  it('reads a lead with no body and a body with no lead', () => {
    const lead = text('A button.', { data: slot('definitionLead') });
    expect(readCanvasProse(frame([lead]))).toEqual({ definition: 'A button.' });
    const body = frame([text('Body only.', { data: line('paragraph') })], slot('definition'));
    expect(readCanvasProse(frame([body]))).toEqual({ definition: 'Body only.' });
  });

  it('reads dos and donts one row each, in order, including a duplicated row', () => {
    const dos = frame([bulletRow('Do A'), bulletRow('Do B'), bulletRow('Do B')], slot('dos'));
    const donts = frame([bulletRow("Don't C")], slot('donts'));
    expect(readCanvasProse(frame([dos, donts]))).toEqual({ dos: ['Do A', 'Do B', 'Do B'], donts: ["Don't C"] });
  });

  it('reads an emptied bullet container as an empty list, not as absent', () => {
    const donts = frame([], slot('donts'));
    expect(readCanvasProse(frame([donts]))).toEqual({ donts: [] });
  });

  it('reads a placeholder-only bullet container as absent', () => {
    const dos = frame([frame([text(PLACEHOLDER_TEXT)])], slot('dos'));
    expect(readCanvasProse(frame([dos]))).toEqual({});
  });

  it('reads a plain text node dropped into a bullet container as an item', () => {
    const dos = frame([bulletRow('Do A'), text('Do Z')], slot('dos'));
    expect(readCanvasProse(frame([dos]))).toEqual({ dos: ['Do A', 'Do Z'] });
  });

  it('reads the anatomy summary and variants summary', () => {
    const summary = text('Three parts.', { data: slot('anatomySummary') });
    const variants = frame([
      text('Two styles.', { data: line('paragraph') }),
      bulletRow('Filled for the main action', [
        { characters: 'Filled', fontName: BOLD },
        { characters: ' for the main action', fontName: REGULAR },
      ]),
    ], slot('variantsSummary'));
    expect(readCanvasProse(frame([summary, variants]))).toEqual({
      anatomySummary: 'Three parts.',
      variantsSummary: 'Two styles.\n- **Filled** for the main action',
    });
  });

  it('reads anatomy part descriptions by tag name, splitting at the first colon', () => {
    const rows = frame([
      frame([text('1'), text('Label: The visible text.')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Label' })),
      frame([text('2'), text('Icon  ·  component')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Icon' })),
      frame([text('3'), text('Badge: Count: unread items')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Badge' })),
    ]);
    expect(readCanvasProse(frame([rows]))).toEqual({
      anatomyParts: [
        { name: 'Label', description: 'The visible text.' },
        { name: 'Badge', description: 'Count: unread items' },
      ],
    });
  });

  it('reads anatomy rows with every description removed as an empty list', () => {
    const rows = frame([
      frame([text('1'), text('Label')], slot('anatomyPart', { [SLOT_PART_KEY]: 'Label' })),
    ]);
    expect(readCanvasProse(frame([rows]))).toEqual({ anatomyParts: [] });
  });

  it('never descends into component instances', () => {
    const inst = frame([frame([text('Mirror')], slot('definition'))], {}, 'INSTANCE');
    expect(readCanvasProse(frame([inst]))).toEqual({});
  });

  it('ignores a slot name it does not know', () => {
    const block = frame([text('x')], slot('somethingNew'));
    expect(readCanvasProse(frame([block]))).toEqual({});
  });
});

// --- mergeProse -------------------------------------------------------------

describe('mergeProse', () => {
  const stored: ProseDrafts = {
    definition: 'Stored definition.', accessibility: 'Stored a11y.',
    dos: ['Stored do'], donts: ['Stored dont'],
    interactions: 'Stored interactions.', designConsiderations: 'Stored design.',
    anatomyParts: [{ name: 'Label', description: 'Stored label.' }],
  };

  it('returns null when neither side has anything', () => {
    expect(mergeProse(null, {})).toBeNull();
  });

  it('returns the stored prose unchanged when the canvas shows nothing', () => {
    expect(mergeProse(stored, {})).toEqual(stored);
  });

  it('lets the canvas win per field and keeps stored fields the canvas does not show', () => {
    const merged = mergeProse(stored, { definition: 'Canvas definition.', dos: [], anatomyParts: [] });
    expect(merged).toEqual({
      ...stored,
      definition: 'Canvas definition.',
      dos: [],
      anatomyParts: [],
    });
  });

  it('fills required fields with empty values when only the canvas has content', () => {
    expect(mergeProse(null, { interactions: 'Tap.' })).toEqual({
      definition: '', accessibility: '', dos: [], donts: [], interactions: 'Tap.',
    });
  });

  it('does not add optional keys that neither side has', () => {
    const merged = mergeProse(null, { definition: 'Only this.' });
    expect(merged).toEqual({ definition: 'Only this.', accessibility: '', dos: [], donts: [] });
    expect(merged && 'variantsSummary' in merged).toBe(false);
  });

  it('returns null when the only content is an empty anatomyParts array', () => {
    expect(mergeProse(null, { anatomyParts: [] })).toBeNull();
  });

  it('returns null when the only content is an empty dos array', () => {
    expect(mergeProse(null, { dos: [] })).toBeNull();
  });

  it('returns null when the only content is a blank definition', () => {
    expect(mergeProse(null, { definition: '  ' })).toBeNull();
  });

  it('is not null once an array field actually has an item', () => {
    expect(mergeProse(null, { dos: ['x'] })).not.toBeNull();
  });
});

// --- collectGeneratedText ---------------------------------------------------

describe('collectGeneratedText', () => {
  it('collects every text outside slots and skips instances', () => {
    const section = frame([
      text('Heading'),
      frame([text('Cell A'), text('Cell B')]),
      frame([text('Mirror')], {}, 'INSTANCE'),
    ], {}, 'SECTION');
    expect(collectGeneratedText(section)).toEqual(['Heading', 'Cell A', 'Cell B']);
  });

  it('skips a slot container and everything under it', () => {
    const section = frame([
      text('Heading'),
      frame([text('Editorial line')], slot('accessibility')),
      text('Lead', { data: slot('definitionLead') }),
      text('Footer'),
    ], {}, 'SECTION');
    expect(collectGeneratedText(section)).toEqual(['Heading', 'Footer']);
  });

  it('collects all text from an untagged legacy section', () => {
    const section = frame([text('A'), frame([text('B')])], {}, 'SECTION');
    expect(collectGeneratedText(section)).toEqual(['A', 'B']);
  });
});
