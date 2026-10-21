import { describe, it, expect } from 'vitest';
import {
  DESCRIPTION_SYSTEM_PROMPT, DESCRIPTION_CHUNK, MAX_DESCRIPTION_CHARS,
  buildDescriptionPrompt, parseDescriptionDraft, chunkDescriptionItems,
  type DescriptionBrief,
} from '../src/prose/descriptionPrompt';

function brief(over: { [K in keyof DescriptionBrief]?: DescriptionBrief[K] | undefined } = {}): DescriptionBrief {
  return {
    key: 'VariableID:1:1', kind: 'variable', name: 'color/surface/primary', type: 'COLOR',
    values: ['Light = #FFFFFF', 'Dark = #111111'], scopes: ['ALL_FILLS'],
    ...over,
  } as DescriptionBrief;
}

describe('DESCRIPTION_SYSTEM_PROMPT', () => {
  it('forbids inventing anything it was not given', () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/Never invent/);
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/leave it out/);
  });
  it('bans dashes and asks for one sentence of JSON', () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/Never use em dashes/);
    expect(DESCRIPTION_SYSTEM_PROMPT).not.toContain('—');
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/One sentence/);
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/Return ONLY a JSON object/);
  });
});

describe('buildDescriptionPrompt', () => {
  it('opens with the marker the proxy checks and closes with the JSON ask', () => {
    const text = buildDescriptionPrompt({ items: [brief()] });
    expect(text.startsWith('Items to describe:\n')).toBe(true);
    expect(text).toContain('\nReturn JSON: ');
  });
  it('writes every fact it has and nothing for a fact it lacks', () => {
    const text = buildDescriptionPrompt({ items: [brief({ aliasOf: 'color/neutral/0' })] });
    expect(text).toContain('  key: VariableID:1:1');
    expect(text).toContain('  kind: variable');
    expect(text).toContain('  name: color/surface/primary');
    expect(text).toContain('  type: COLOR');
    expect(text).toContain('  values: Light = #FFFFFF; Dark = #111111');
    expect(text).toContain('  scopes: ALL_FILLS');
    expect(text).toContain('  alias of: color/neutral/0');
    const bare = buildDescriptionPrompt({ items: [brief({ values: undefined, scopes: undefined })] });
    expect(bare).not.toContain('values:');
    expect(bare).not.toContain('scopes:');
    expect(bare).not.toContain('alias of:');
  });
  it('is byte-stable for the same input', () => {
    expect(buildDescriptionPrompt({ items: [brief()] })).toBe(buildDescriptionPrompt({ items: [brief()] }));
  });
});

describe('chunkDescriptionItems', () => {
  it('splits at the chunk size and keeps order', () => {
    const items = Array.from({ length: DESCRIPTION_CHUNK * 2 + 1 }, (_, i) => brief({ key: `k${i}` }));
    const chunks = chunkDescriptionItems(items);
    expect(chunks.map((c) => c.length)).toEqual([DESCRIPTION_CHUNK, DESCRIPTION_CHUNK, 1]);
    expect(chunks[2][0].key).toBe(`k${DESCRIPTION_CHUNK * 2}`);
  });
  it('returns no chunks for no items', () => {
    expect(chunkDescriptionItems([])).toEqual([]);
  });
});

describe('parseDescriptionDraft', () => {
  it('keeps only requested keys, trimmed, with dashes collapsed', () => {
    const out = parseDescriptionDraft(
      'Sure: {"a": "  The page background — in both modes. ", "zzz": "ignored"}',
      ['a', 'b'],
    );
    expect(out).toEqual({ a: 'The page background, in both modes.' });
  });
  it('drops an empty, non-string or overlong answer rather than defaulting it', () => {
    const long = 'x'.repeat(MAX_DESCRIPTION_CHARS + 1);
    const out = parseDescriptionDraft(`{"a": "", "b": 3, "c": "${long}"}`, ['a', 'b', 'c']);
    expect(out).toEqual({});
  });
  it('returns nothing for unusable text', () => {
    expect(parseDescriptionDraft('not json', ['a'])).toEqual({});
    expect(parseDescriptionDraft('[1,2]', ['a'])).toEqual({});
  });
});
