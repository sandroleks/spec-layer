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

/** One collection block, from the collection facts and its groups. */
const oneCollection = (
  collection: ReturnType<typeof collectionBrief>, groups: FoundationGroupBrief[],
): string => buildGroupPrompt({ collections: [{ ...collection, collectionId: 'c1', groups }] });

describe('buildGroupPrompt', () => {
  it('names each group by its key, heading and type', () => {
    const prompt = oneCollection(collectionBrief(), [brief()]);
    expect(prompt).toContain('Collection: Semantic');
    expect(prompt).toContain('key: color/surface');
    expect(prompt).toContain('heading: Surface');
    expect(prompt).toContain('type: COLOR');
  });

  it('shows each token beside its resolved value', () => {
    const prompt = oneCollection(collectionBrief(), [brief()]);
    expect(prompt).toContain('color/surface/primary = #722ED1');
  });

  it('omits the value when there is none rather than printing an empty one', () => {
    const prompt = oneCollection(collectionBrief({ collectionName: 'S' }), [brief({
      tokenNames: ['a/b'], sampleValues: [''],
    })]);
    expect(prompt).toContain('a/b');
    expect(prompt).not.toContain('a/b = ');
  });

  it('caps the sample and says how many were held back', () => {
    // An unbounded prompt on a 150-token group is both slow and expensive.
    const names = Array.from({ length: GROUP_SAMPLE_LIMIT + 5 }, (_, i) => `c/t${i}`);
    const prompt = oneCollection(collectionBrief({ collectionName: 'S' }), [brief({
      tokenNames: names, sampleValues: names.map(() => '#000000'),
    })]);
    expect(prompt).toContain(`c/t${GROUP_SAMPLE_LIMIT - 1}`);
    expect(prompt).not.toContain(`c/t${GROUP_SAMPLE_LIMIT}`);
    expect(prompt).toContain('(and 5 more)');
  });

  it('covers every group in one request', () => {
    const prompt = oneCollection(collectionBrief({ collectionName: 'S' }), [
      brief(), brief({ folder: 'color/text', title: 'Text' }),
    ]);
    expect(prompt).toContain('key: color/surface');
    expect(prompt).toContain('key: color/text');
  });

  it('omits the modes and aliases lines when there is nothing to say', () => {
    const prompt = oneCollection(collectionBrief({ collectionName: 'Solo' }), [brief()]);
    expect(prompt.startsWith('Collection: Solo (key: c1)\nGroups to describe:\n')).toBe(true);
    expect(prompt).not.toContain('Modes:');
    expect(prompt).not.toContain('Aliases into');
  });
});

const SEMANTIC = {
  collectionId: 'c1', collectionName: 'Semantic', modeNames: ['Light', 'Dark'],
  aliasCounts: [{ collection: 'Primitives', count: 42 }],
  groups: [{ folder: 'c1|surface', title: 'Surface', resolvedType: 'COLOR' as const,
    tokenNames: ['surface/default'], sampleValues: ['#FFFFFF'] }],
};
const SPACING = { collectionId: 'c2', collectionName: 'Spacing', modeNames: [], aliasCounts: [], groups: [] };

describe('buildGroupPrompt, one block per collection', () => {
  const prompt = buildGroupPrompt({ collections: [SEMANTIC, SPACING] });
  it('opens each block with the collection and its key, then modes and aliases', () => {
    expect(prompt.startsWith('Collection: Semantic (key: c1)\nModes: Light, Dark\nAliases into other collections: Primitives (42)\nGroups to describe:\n')).toBe(true);
    expect(prompt).toContain('\n\nCollection: Spacing (key: c2)\nGroups to describe: none\n');
  });
  it('asks for one overview per collection key beside the group keys', () => {
    expect(prompt.endsWith('\nReturn JSON: { "<collection key>|overview": "<one paragraph about that collection>", "<group key>": "<description>", ... } with one overview per collection key and one entry per group key above.')).toBe(true);
  });
  it('still lists each group by key, heading and type', () => {
    expect(prompt).toContain('  key: c1|surface\n  heading: Surface\n  type: COLOR\n    surface/default = #FFFFFF');
  });
});

describe('parseGroupDraft overviews', () => {
  it('keeps one overview per requested collection and every requested group', () => {
    const out = parseGroupDraft(
      '{"c1|overview":"Semantic colours.","c2|overview":"Spacing steps.","c1|surface":"Surfaces.","c9|overview":"nope","overview":"bare"}',
      ['c1|surface'], ['c1', 'c2'],
    );
    expect(out).toEqual({ descriptions: { 'c1|surface': 'Surfaces.' }, overviews: { c1: 'Semantic colours.', c2: 'Spacing steps.' } });
  });
  it('drops an empty, non-string or over-long overview', () => {
    const long = 'x'.repeat(MAX_OVERVIEW + 1);
    expect(parseGroupDraft(`{"c1|overview":"","c2|overview":${JSON.stringify(long)},"c3|overview":3}`, [], ['c1', 'c2', 'c3']).overviews).toEqual({});
  });
  it('collapses dashes in an overview like it does in a description', () => {
    expect(parseGroupDraft('{"c1|overview":"Light — and dark."}', [], ['c1']).overviews.c1).toBe('Light, and dark.');
  });
  it('lets a real group key win the `<id>|overview` collision', () => {
    // A colour variable named `overview/...` in collection c1 folders to
    // `overview`, so its group key IS `c1|overview`. The group has a block on
    // the canvas waiting for text; the overview is a nice-to-have, so the group
    // takes the answer and the collection goes without.
    const out = parseGroupDraft('{"c1|overview":"Overview swatches."}', ['c1|overview'], ['c1']);
    expect(out).toEqual({ descriptions: { 'c1|overview': 'Overview swatches.' }, overviews: {} });
  });
});

describe('FOUNDATION_SYSTEM_PROMPT overview rule', () => {
  it('tells the model to write one overview per collection key, under 400 characters', () => {
    expect(FOUNDATION_SYSTEM_PROMPT).toContain('"<collection key>|overview"');
    expect(FOUNDATION_SYSTEM_PROMPT).toContain('Under 400 characters');
  });
});

describe('parseGroupDraft descriptions', () => {
  const folders = ['color/surface', 'color/text'];
  /** The descriptions half, which is all these cases are about. They ran
   *  through `parseGroupResponse` until that wrapper was deleted for having
   *  no caller outside this block. */
  const descriptions = (text: string, keys: string[]): Record<string, string> =>
    parseGroupDraft(text, keys, []).descriptions;

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
