import { describe, it, expect } from 'vitest';
import {
  buildGroupPrompt, parseGroupResponse, FOUNDATION_SYSTEM_PROMPT, GROUP_SAMPLE_LIMIT,
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

describe('buildGroupPrompt', () => {
  it('names each group by its key, heading and type', () => {
    const prompt = buildGroupPrompt('Semantic', [brief()]);
    expect(prompt).toContain('Collection: Semantic');
    expect(prompt).toContain('key: color/surface');
    expect(prompt).toContain('heading: Surface');
    expect(prompt).toContain('type: COLOR');
  });

  it('shows each token beside its resolved value', () => {
    const prompt = buildGroupPrompt('Semantic', [brief()]);
    expect(prompt).toContain('color/surface/primary = #722ED1');
  });

  it('omits the value when there is none rather than printing an empty one', () => {
    const prompt = buildGroupPrompt('S', [brief({
      tokenNames: ['a/b'], sampleValues: [''],
    })]);
    expect(prompt).toContain('a/b');
    expect(prompt).not.toContain('a/b = ');
  });

  it('caps the sample and says how many were held back', () => {
    // An unbounded prompt on a 150-token group is both slow and expensive.
    const names = Array.from({ length: GROUP_SAMPLE_LIMIT + 5 }, (_, i) => `c/t${i}`);
    const prompt = buildGroupPrompt('S', [brief({
      tokenNames: names, sampleValues: names.map(() => '#000000'),
    })]);
    expect(prompt).toContain(`c/t${GROUP_SAMPLE_LIMIT - 1}`);
    expect(prompt).not.toContain(`c/t${GROUP_SAMPLE_LIMIT}`);
    expect(prompt).toContain('(and 5 more)');
  });

  it('covers every group in one request', () => {
    const prompt = buildGroupPrompt('S', [
      brief(), brief({ folder: 'color/text', title: 'Text' }),
    ]);
    expect(prompt).toContain('key: color/surface');
    expect(prompt).toContain('key: color/text');
  });
});

describe('parseGroupResponse', () => {
  const folders = ['color/surface', 'color/text'];

  it('reads a plain JSON object', () => {
    const out = parseGroupResponse(
      '{"color/surface":"Backgrounds and large areas.","color/text":"Copy colours."}', folders);
    expect(out).toEqual({
      'color/surface': 'Backgrounds and large areas.',
      'color/text': 'Copy colours.',
    });
  });

  it('tolerates prose or a code fence around the JSON', () => {
    const out = parseGroupResponse(
      'Here you go:\n```json\n{"color/surface":"Backgrounds."}\n```\nDone.', folders);
    expect(out).toEqual({ 'color/surface': 'Backgrounds.' });
  });

  it('drops keys that were never asked for', () => {
    // Model output is untrusted: an invented key has no block to sit under, and
    // rendering it would put unrequested text into the document.
    const out = parseGroupResponse(
      '{"color/surface":"ok","color/invented":"nope"}', folders);
    expect(out).toEqual({ 'color/surface': 'ok' });
  });

  it('drops non-string and empty values rather than defaulting them', () => {
    const out = parseGroupResponse(
      '{"color/surface":42,"color/text":"   "}', folders);
    expect(out).toEqual({});
  });

  it('drops a description that runs absurdly long', () => {
    const out = parseGroupResponse(
      JSON.stringify({ 'color/surface': 'x'.repeat(401) }), folders);
    expect(out).toEqual({});
  });

  it('replaces an em dash the model slipped in', () => {
    // Belt and braces: the prompt asks, and the parser enforces, because the
    // house style rule is absolute and a slip would reach the canvas.
    const out = parseGroupResponse(
      '{"color/surface":"Backgrounds — and large areas."}', folders);
    expect(out['color/surface']).toBe('Backgrounds, and large areas.');
    expect(out['color/surface']).not.toContain('—');
  });

  it('returns nothing for unparseable output instead of throwing', () => {
    // A bad response must cost the descriptions, not the frames.
    expect(parseGroupResponse('total nonsense', folders)).toEqual({});
    expect(parseGroupResponse('{ broken', folders)).toEqual({});
    expect(parseGroupResponse('', folders)).toEqual({});
    expect(parseGroupResponse('["an","array"]', folders)).toEqual({});
  });
});
