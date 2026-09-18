import { describe, it, expect } from 'vitest';
import {
  buildGroupPrompt, parseGroupDraft, FOUNDATION_SYSTEM_PROMPT,
  GROUP_SAMPLE_LIMIT, MAX_OVERVIEW,
  type FoundationGroupBrief,
} from '../src/prose/foundationPrompt';

function brief(over: Partial<FoundationGroupBrief> = {}): FoundationGroupBrief {
  return {
    folder: 'color/surface',
    title: 'Surface',
    resolvedType: 'COLOR',
    tokenNames: ['color/surface/primary', 'color/surface/secondary'],
    sampleValues: ['#722ED1', '#551DB0'],
    ...over,
  };
}

describe('FOUNDATION_SYSTEM_PROMPT', () => {
  it('forbids inventing anything the names do not support', () => {
    // The single most important property: a docs tool that states usage rules
    // nobody chose is worse than one that says nothing.
    expect(FOUNDATION_SYSTEM_PROMPT).toMatch(/Never invent/);
    expect(FOUNDATION_SYSTEM_PROMPT).toMatch(/invented one is a defect/);
  });

  it('bans em dashes, like every other piece of generated copy', () => {
    expect(FOUNDATION_SYSTEM_PROMPT).toMatch(/Never use em dashes/);
    expect(FOUNDATION_SYSTEM_PROMPT).not.toContain('—');
  });

  it('asks for JSON only, so the response is parseable', () => {
    expect(FOUNDATION_SYSTEM_PROMPT).toMatch(/Return ONLY a JSON object/);
  });
});

function collectionBrief(over: Partial<{ collectionName: string; modeNames: string[]; aliasCounts: { collection: string; count: number }[] }> = {}) {
  return { collectionName: 'Semantic', modeNames: [], aliasCounts: [], ...over };
}

describe('buildGroupPrompt', () => {
  it('names each group by its key, heading and type', () => {
    const prompt = buildGroupPrompt(collectionBrief(), [brief()]);
    expect(prompt).toContain('Collection: Semantic');
    expect(prompt).toContain('key: color/surface');
    expect(prompt).toContain('heading: Surface');
    expect(prompt).toContain('type: COLOR');
  });

  it('shows each token beside its resolved value', () => {
    const prompt = buildGroupPrompt(collectionBrief(), [brief()]);
    expect(prompt).toContain('color/surface/primary = #722ED1');
  });

  it('omits the value when there is none rather than printing an empty one', () => {
    const prompt = buildGroupPrompt(collectionBrief({ collectionName: 'S' }), [brief({
      tokenNames: ['a/b'], sampleValues: [''],
    })]);
    expect(prompt).toContain('a/b');
    expect(prompt).not.toContain('a/b = ');
  });

  it('caps the sample and says how many were held back', () => {
    // An unbounded prompt on a 150-token group is both slow and expensive.
    const names = Array.from({ length: GROUP_SAMPLE_LIMIT + 5 }, (_, i) => `c/t${i}`);
    const prompt = buildGroupPrompt(collectionBrief({ collectionName: 'S' }), [brief({
      tokenNames: names, sampleValues: names.map(() => '#000000'),
    })]);
    expect(prompt).toContain(`c/t${GROUP_SAMPLE_LIMIT - 1}`);
    expect(prompt).not.toContain(`c/t${GROUP_SAMPLE_LIMIT}`);
    expect(prompt).toContain('(and 5 more)');
  });

  it('covers every group in one request', () => {
    const prompt = buildGroupPrompt(collectionBrief({ collectionName: 'S' }), [
      brief(), brief({ folder: 'color/text', title: 'Text' }),
    ]);
    expect(prompt).toContain('key: color/surface');
    expect(prompt).toContain('key: color/text');
  });
});

describe('buildGroupPrompt overview facts', () => {
  const collection = { collectionName: 'Semantic', modeNames: ['Light', 'Dark'], aliasCounts: [{ collection: 'Primitives', count: 42 }, { collection: 'Brand', count: 3 }] };
  const groups = [{ folder: 'c|color/surface', title: 'Surface', resolvedType: 'COLOR' as const, tokenNames: ['color/surface/1'], sampleValues: ['#fff'] }];

  it('names the modes and the alias counts before the groups', () => {
    const prompt = buildGroupPrompt(collection, groups);
    expect(prompt.startsWith('Collection: Semantic\nModes: Light, Dark\nAliases into other collections: Primitives (42), Brand (3)\n\nGroups to describe:\n')).toBe(true);
  });

  it('omits the modes and aliases lines when there is nothing to say', () => {
    const prompt = buildGroupPrompt({ collectionName: 'Solo', modeNames: [], aliasCounts: [] }, groups);
    expect(prompt.startsWith('Collection: Solo\n\nGroups to describe:\n')).toBe(true);
    expect(prompt).not.toContain('Modes:');
    expect(prompt).not.toContain('Aliases into');
  });

  it('asks for the overview entry beside the group entries', () => {
    expect(buildGroupPrompt(collection, groups)).toContain('\nReturn JSON: { "overview": "<one paragraph about the whole collection>", "<key>": "<description>", ... } with one entry per key above.');
  });
});

describe('parseGroupDraft', () => {
  it('returns the overview and the descriptions, trimmed and dash-normalised', () => {
    const out = parseGroupDraft('{"overview":"  Semantic colours for surfaces — and text. ","c|x":"Backgrounds."}', ['c|x']);
    expect(out).toEqual({ overview: 'Semantic colours for surfaces, and text.', descriptions: { 'c|x': 'Backgrounds.' } });
  });
  it('drops an overview that is missing, not a string, empty, or too long', () => {
    expect(parseGroupDraft('{"c|x":"B."}', ['c|x']).overview).toBeNull();
    expect(parseGroupDraft('{"overview":3,"c|x":"B."}', ['c|x']).overview).toBeNull();
    expect(parseGroupDraft('{"overview":"   ","c|x":"B."}', ['c|x']).overview).toBeNull();
    expect(parseGroupDraft(JSON.stringify({ overview: 'x'.repeat(MAX_OVERVIEW + 1), 'c|x': 'B.' }), ['c|x']).overview).toBeNull();
  });
  it('never treats "overview" as a group key', () => {
    expect(parseGroupDraft('{"overview":"O."}', ['overview']).descriptions).toEqual({});
  });
});

describe('FOUNDATION_SYSTEM_PROMPT overview rule', () => {
  it('tells the model what the overview may say and how long it is', () => {
    expect(FOUNDATION_SYSTEM_PROMPT).toContain('"overview"');
    expect(FOUNDATION_SYSTEM_PROMPT).toContain('Under 400 characters');
  });
});

describe('parseGroupDraft descriptions', () => {
  const folders = ['color/surface', 'color/text'];
  /** The descriptions half, which is all these cases are about. They ran
   *  through `parseGroupResponse` until that wrapper was deleted for having
   *  no caller outside this block. */
  const descriptions = (text: string, keys: string[]): Record<string, string> =>
    parseGroupDraft(text, keys).descriptions;

  it('reads a plain JSON object', () => {
    const out = descriptions('{"color/surface":"Backgrounds and large areas.","color/text":"Copy colours."}', folders);
    expect(out).toEqual({
      'color/surface': 'Backgrounds and large areas.',
      'color/text': 'Copy colours.',
    });
  });

  it('tolerates prose or a code fence around the JSON', () => {
    const out = descriptions('Here you go:\n```json\n{"color/surface":"Backgrounds."}\n```\nDone.', folders);
    expect(out).toEqual({ 'color/surface': 'Backgrounds.' });
  });

  it('drops keys that were never asked for', () => {
    // Model output is untrusted: an invented key has no block to sit under, and
    // rendering it would put unrequested text into the document.
    const out = descriptions('{"color/surface":"ok","color/invented":"nope"}', folders);
    expect(out).toEqual({ 'color/surface': 'ok' });
  });

  it('drops non-string and empty values rather than defaulting them', () => {
    const out = descriptions('{"color/surface":42,"color/text":"   "}', folders);
    expect(out).toEqual({});
  });

  it('drops a description that runs absurdly long', () => {
    const out = descriptions(JSON.stringify({ 'color/surface': 'x'.repeat(401) }), folders);
    expect(out).toEqual({});
  });

  it('replaces an em dash the model slipped in', () => {
    // Belt and braces: the prompt asks, and the parser enforces, because the
    // house style rule is absolute and a slip would reach the canvas.
    const out = descriptions('{"color/surface":"Backgrounds — and large areas."}', folders);
    expect(out['color/surface']).toBe('Backgrounds, and large areas.');
    expect(out['color/surface']).not.toContain('—');
  });

  it('returns nothing for unparseable output instead of throwing', () => {
    // A bad response must cost the descriptions, not the frames.
    expect(descriptions('total nonsense', folders)).toEqual({});
    expect(descriptions('{ broken', folders)).toEqual({});
    expect(descriptions('', folders)).toEqual({});
    expect(descriptions('["an","array"]', folders)).toEqual({});
  });
});
