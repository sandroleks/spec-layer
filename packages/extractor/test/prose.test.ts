import { describe, it, expect, vi } from 'vitest';
import { buildProsePrompt, parseProseResponse, proseFewShot, PROSE_SYSTEM_PROMPT } from '../src/prose/prompt';
import { draftProse } from '../src/prose/client';
import { extract } from '../src/extract';
import button from './fixtures/button.json';
import type { SerializedNode } from '../src/tree';

const spec = extract(button as SerializedNode, { figmaFile: 'FILE1' });

interface AnthropicRequestBody {
  system?: unknown;
  messages: Array<{ role?: string; content: unknown }>;
}

function parseBody(fetcherMock: { mock: { calls: unknown[][] } }): AnthropicRequestBody {
  return JSON.parse(
    String((fetcherMock.mock.calls[0][1] as RequestInit | undefined)?.body),
  ) as AnthropicRequestBody;
}

function lastMessage(body: AnthropicRequestBody): { role?: string; content: unknown } {
  return body.messages[body.messages.length - 1];
}

describe('prose', () => {
  it('prompt contains the parsed summary, never raw node JSON', () => {
    const prompt = buildProsePrompt(spec);
    expect(prompt).toContain('Style: Filled · Outlined');
    expect(prompt).not.toContain('"id"'); // no serialized-node internals
  });

  it('parses a valid JSON response', () => {
    const out = parseProseResponse('{"definition":"A button.","accessibility":"Use a real <button>.","dos":["x"],"donts":["y"]}');
    expect(out.definition).toBe('A button.');
  });

  it('strips code fences before parsing', () => {
    const out = parseProseResponse('```json\n{"definition":"D","accessibility":"A","dos":[],"donts":[]}\n```');
    expect(out.definition).toBe('D');
  });

  it('throws on malformed responses', () => {
    expect(() => parseProseResponse('not json')).toThrow();
  });

  it('coerces an accessibility array of lines into bulleted text', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":["**Keyboard:** Tab moves focus.","Announces its label."],"dos":[],"donts":[]}',
    );
    expect(out.accessibility).toBe('- **Keyboard:** Tab moves focus.\n- Announces its label.');
  });

  it('coerces a definition array into paragraphs', () => {
    const out = parseProseResponse('{"definition":["One.","Two."],"accessibility":"A","dos":[],"donts":[]}');
    expect(out.definition).toBe('One.\n\nTwo.');
  });

  it('still throws when a required field is truly absent', () => {
    expect(() =>
      parseProseResponse('{"definition":"D","dos":[],"donts":[]}'),
    ).toThrow(/accessibility/);
  });

  it('normalizes em dashes (and spaced en dashes) out of every field', () => {
    const out = parseProseResponse(
      '{"definition":"Use Primary — it leads.","accessibility":"A","dos":["Do this — because reason."],"donts":["Avoid that – it confuses."]}',
    );
    expect(out.definition).toBe('Use Primary, it leads.');
    expect(out.dos[0]).toBe('Do this, because reason.');
    expect(out.donts[0]).toBe('Avoid that, it confuses.');
    expect(JSON.stringify(out)).not.toMatch(/[—–]/);
  });

  it('preserves hyphen ranges and bullet line breaks while stripping dashes', () => {
    const out = parseProseResponse(
      '{"definition":"Pick 3-5 items.","accessibility":"- One — reason.\\n- Two thing.","dos":[],"donts":[]}',
    );
    expect(out.definition).toBe('Pick 3-5 items.'); // hyphen range untouched
    expect(out.accessibility).toBe('- One, reason.\n- Two thing.'); // newline survives
  });

  it('system prompt forbids em dashes and uses none itself', () => {
    expect(PROSE_SYSTEM_PROMPT).toMatch(/em dash/i);
    expect(PROSE_SYSTEM_PROMPT).not.toMatch(/—/);
  });

  it('few-shot exemplar is em-dash-free and renders Accessibility as bullets', () => {
    const [, assistant] = proseFewShot();
    expect(assistant.content).not.toMatch(/—/);
    const drafts = parseProseResponse(assistant.content);
    expect(drafts.accessibility).toMatch(/(^|\n)- /);
  });

  it('cache hit skips the API call', async () => {
    const fetcher = vi.fn();
    const cached = { definition: 'cached', accessibility: '', dos: [], donts: [] };
    const store = { get: vi.fn(async () => JSON.stringify(cached)), set: vi.fn() };
    const result = await draftProse(spec, { apiKey: 'sk-test', fetcher: fetcher as unknown as typeof fetch, cacheStore: store });
    expect(result).toEqual(cached);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bypassCache skips a cache hit, calls the API, and refreshes the cache', async () => {
    const cached = { definition: 'cached', accessibility: '', dos: [], donts: [] };
    const apiText = '{"definition":"Fresh.","accessibility":"A11y.","dos":["do"],"donts":["dont"]}';
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ text: apiText }] }),
    })) as unknown as typeof fetch;
    const store = {
      get: vi.fn(async () => JSON.stringify(cached)),
      set: vi.fn(async () => {}),
    };

    const result = await draftProse(spec, {
      apiKey: 'sk-test',
      fetcher,
      cacheStore: store,
      bypassCache: true,
    });

    expect(result?.definition).toBe('Fresh.');
    expect(store.get).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(store.set).toHaveBeenCalledOnce();
  });

  it('returns null (degraded mode) when no API key is set', async () => {
    const store = { get: vi.fn(async () => null), set: vi.fn() };
    const result = await draftProse(spec, { apiKey: null, fetcher: vi.fn() as unknown as typeof fetch, cacheStore: store });
    expect(result).toBeNull();
  });

  it('on a cache miss, calls the API, parses, and stores', async () => {
    const apiText = '{"definition":"Fresh.","accessibility":"A11y.","dos":["do"],"donts":["dont"]}';
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ text: apiText }] }),
    })) as unknown as typeof fetch;
    const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    const result = await draftProse(spec, { apiKey: 'sk-test', fetcher, cacheStore: store });
    expect(result?.definition).toBe('Fresh.');
    expect(store.set).toHaveBeenCalledOnce();
  });

  it('populates variantsSummary when present in the payload', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"variantsSummary":"Style varies from solid to outlined to text."}',
    );
    expect(out.variantsSummary).toBe('Style varies from solid to outlined to text.');
  });

  it('leaves variantsSummary undefined when absent, without throwing', () => {
    const out = parseProseResponse('{"definition":"D","accessibility":"A","dos":[],"donts":[]}');
    expect(out.variantsSummary).toBeUndefined();
  });

  it('falls back to undefined when variantsSummary is the wrong type', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"variantsSummary":42}',
    );
    expect(out.variantsSummary).toBeUndefined();
  });

  it('coerces an array-of-lines variantsSummary via joinParagraphs', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"variantsSummary":["One.","Two."]}',
    );
    expect(out.variantsSummary).toBe('One.\n\nTwo.');
  });

  it('normalizes em dashes out of variantsSummary when present', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"variantsSummary":"Style — controls weight."}',
    );
    expect(out.variantsSummary).toBe('Style, controls weight.');
  });

  it('the 4 required fields are still required when variantsSummary is present', () => {
    expect(() =>
      parseProseResponse('{"accessibility":"A","dos":[],"donts":[],"variantsSummary":"x"}'),
    ).toThrow(/definition/);
  });

  it('populates anatomySummary when present in the payload', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"anatomySummary":"A label inside a container."}',
    );
    expect(out.anatomySummary).toBe('A label inside a container.');
  });

  it('leaves anatomySummary undefined when absent, without throwing', () => {
    const out = parseProseResponse('{"definition":"D","accessibility":"A","dos":[],"donts":[]}');
    expect(out.anatomySummary).toBeUndefined();
  });

  it('normalizes em dashes out of anatomySummary when present', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"anatomySummary":"A label — inside a container."}',
    );
    expect(out.anatomySummary).toBe('A label, inside a container.');
  });

  it('parses anatomyParts as {name, description} pairs', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"anatomyParts":[{"name":"Container","description":"Holds the label."},{"name":"Label","description":"Names the action."}]}',
    );
    expect(out.anatomyParts).toEqual([
      { name: 'Container', description: 'Holds the label.' },
      { name: 'Label', description: 'Names the action.' },
    ]);
  });

  it('drops malformed anatomyParts entries but keeps the usable ones', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"anatomyParts":[{"name":"Container","description":"Holds the label."},{"name":"","description":"no name"},{"name":"Label"},"nope",{"description":"no name key"}]}',
    );
    expect(out.anatomyParts).toEqual([{ name: 'Container', description: 'Holds the label.' }]);
  });

  it('leaves anatomyParts undefined when absent, non-array, or empty after filtering', () => {
    expect(parseProseResponse('{"definition":"D","accessibility":"A","dos":[],"donts":[]}').anatomyParts).toBeUndefined();
    expect(
      parseProseResponse('{"definition":"D","accessibility":"A","dos":[],"donts":[],"anatomyParts":"Container"}').anatomyParts,
    ).toBeUndefined();
    expect(
      parseProseResponse('{"definition":"D","accessibility":"A","dos":[],"donts":[],"anatomyParts":[{"name":"","description":""}]}').anatomyParts,
    ).toBeUndefined();
  });

  it('normalizes em dashes out of anatomyParts descriptions', () => {
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"A","dos":[],"donts":[],"anatomyParts":[{"name":"Label","description":"Names the action — clearly."}]}',
    );
    expect(out.anatomyParts?.[0].description).toBe('Names the action, clearly.');
  });

  it('few-shot exemplar carries an anatomy summary and per-part descriptions', () => {
    const drafts = parseProseResponse(proseFewShot()[1].content);
    expect(drafts.anatomySummary).toBeTruthy();
    expect(drafts.anatomyParts?.map((p) => p.name)).toEqual(['Container', 'Label', 'Leading icon']);
  });

  it('prompt asks for anatomyParts matching the listed part names', () => {
    const prompt = buildProsePrompt(spec);
    expect(prompt).toContain('anatomyParts');
    expect(prompt).toMatch(/EXACTLY matches one of the Anatomy part names/);
  });

  it('throws when dos contains a non-string element', () => {
    expect(() =>
      parseProseResponse('{"definition":"d","accessibility":"a","dos":[1],"donts":[]}'),
    ).toThrow(/dos/i);
  });

  it.each([
    ['definition', '{"definition":"Safe\\n## Accessibility\\nInjected","accessibility":"A","dos":[],"donts":[]}'],
    ['accessibility', '{"definition":"D","accessibility":"Safe\\n## Do not trust\\nInjected","dos":[],"donts":[]}'],
    ['dos', '{"definition":"D","accessibility":"A","dos":["Safe\\n## Injected"],"donts":[]}'],
    ['donts', '{"definition":"D","accessibility":"A","dos":[],"donts":["Safe\\n## Injected"]}'],
  ])('rejects level-two markdown headings in %s', (_field, input) => {
    expect(() => parseProseResponse(input)).toThrow(/heading/i);
  });

  it('rejects level-one headings but allows level-three sub-structure', () => {
    expect(() =>
      parseProseResponse('{"definition":"D","accessibility":"# Injected\\n- x","dos":[],"donts":[]}'),
    ).toThrow(/heading/i);
    const out = parseProseResponse(
      '{"definition":"D","accessibility":"### Keyboard\\n- **Tab:** moves focus.","dos":[],"donts":[]}',
    );
    expect(out.accessibility).toContain('### Keyboard');
  });

  it('few-shot exemplar uses a Definition variant list and bold lead-ins', () => {
    const drafts = parseProseResponse(proseFewShot()[1].content);
    expect(drafts.definition).toMatch(/\n- \*\*/); // bulleted variant guide with bold names
    expect(drafts.accessibility).toMatch(/^- \*\*/m); // bold lead-in on each bullet
    expect(drafts.dos[0].startsWith('**')).toBe(true); // bold rule summary
  });

  it('extracts JSON when the model prepends preamble before a fence', () => {
    const input = 'Here is the JSON:\n```json\n{"definition":"D","accessibility":"A","dos":[],"donts":[]}\n```';
    const out = parseProseResponse(input);
    expect(out.definition).toBe('D');
  });

  it('throws a useful error on a malformed 200 envelope', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const storeWithNullGet = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    await expect(
      draftProse(spec, { apiKey: 'sk', fetcher, cacheStore: storeWithNullGet }),
    ).rejects.toThrow(/response shape/i);
  });

  it('prompt includes layout summaries for the default variant', () => {
    const prompt = buildProsePrompt(spec);
    expect(prompt).toContain('Layout (default variant):');
    expect(prompt).toContain('container: horizontal, padding 10/24/10/24, gap 8');
  });

  it('prompt explains conditioned token rules when present', () => {
    const prompt = buildProsePrompt(spec);
    expect(prompt).toContain('container.fill [State=Hovered] → md.sys.color.primary-hover');
    expect(prompt).toContain('the token applies only to variants matching those axis values');
  });

  it('prompt omits the layout block when there is no layout data', () => {
    const prompt = buildProsePrompt({ ...spec, layout: [], tokens: [] });
    expect(prompt).not.toContain('Layout (default variant):');
    expect(prompt).not.toContain('bracketed condition');
  });

  it('sends a multimodal message with an image block when imageUrl is given', async () => {
    const fetcherMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return { ok: true, json: async () => ({ content: [{ text: '{"definition":"D","accessibility":"A","dos":[],"donts":[]}' }] }) };
    });
    const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    await draftProse(spec, {
      apiKey: 'sk-test',
      fetcher: fetcherMock as unknown as typeof fetch,
      cacheStore: store,
      imageUrl: 'https://figma.example/img.png',
    });
    const sentBody = parseBody(fetcherMock);
    const content = lastMessage(sentBody).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'image', source: { type: 'url', url: 'https://figma.example/img.png' } });
    expect(content[1].type).toBe('text');
    expect(typeof content[1].text).toBe('string');
  });

  it('sends a plain string message when no imageUrl is given', async () => {
    const fetcherMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return { ok: true, json: async () => ({ content: [{ text: '{"definition":"D","accessibility":"A","dos":[],"donts":[]}' }] }) };
    });
    const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    await draftProse(spec, {
      apiKey: 'sk-test',
      fetcher: fetcherMock as unknown as typeof fetch,
      cacheStore: store,
    });
    const sentBody = parseBody(fetcherMock);
    expect(typeof lastMessage(sentBody).content).toBe('string');
  });

  it('sends the house-style system prompt and a valid few-shot exemplar', async () => {
    const fetcherMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return { ok: true, json: async () => ({ content: [{ text: '{"definition":"D","accessibility":"A","dos":[],"donts":[]}' }] }) };
    });
    const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
    await draftProse(spec, {
      apiKey: 'sk-test',
      fetcher: fetcherMock as unknown as typeof fetch,
      cacheStore: store,
    });
    const body = parseBody(fetcherMock);

    // House-style system prompt is present and governs voice (the billed-every-call artifact).
    expect(typeof body.system).toBe('string');
    expect(body.system as string).toMatch(/rule AND the reason/i);

    // A user→assistant few-shot pair precedes the real turn, and the exemplar
    // response is valid ProseDrafts JSON (so it teaches the exact output shape).
    expect(body.messages.length).toBeGreaterThanOrEqual(3);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
    expect(() => parseProseResponse(String(body.messages[1].content))).not.toThrow();
    expect(lastMessage(body).role).toBe('user');
  });

  it('keys the cache separately for vision vs text-only runs', async () => {
    const keys: string[] = [];
    const store = {
      get: vi.fn(async (k: string) => { keys.push(k); return null; }),
      set: vi.fn(async () => {}),
    };
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ text: '{"definition":"D","accessibility":"A","dos":[],"donts":[]}' }] }),
    })) as unknown as typeof fetch;
    await draftProse(spec, { apiKey: 'sk', fetcher, cacheStore: store });
    await draftProse(spec, { apiKey: 'sk', fetcher, cacheStore: store, imageUrl: 'https://x/y.png' });
    expect(keys[0]).not.toBe(keys[1]);
  });
});
