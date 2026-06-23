import { describe, it, expect } from 'vitest';
import { draftProse, proseCacheKey } from '../src/prose/client';
import type { IntermediateSpec } from '../src/extract';

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [], props: [], variants: [], states: [], tokens: [], related: [], gaps: [], layout: [],
} as unknown as IntermediateSpec;

const PROSE = JSON.stringify({ definition: 'd', accessibility: 'a', dos: ['x'], donts: ['y'] });

function memStore() {
  const m = new Map<string, string>();
  return { store: m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
}

interface ContentBlock {
  type: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  text?: string;
}
interface RequestBody {
  messages: Array<{ role: string; content: ContentBlock[] }>;
}

describe('draftProse base64 image', () => {
  it('sends a base64 image content block when imageBase64 is provided', async () => {
    let captured: RequestBody | undefined;
    const fetcher = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string) as RequestBody;
      return { ok: true, json: async () => ({ content: [{ text: PROSE }] }) };
    }) as unknown as typeof fetch;
    const { get, set } = memStore();
    await draftProse(spec, {
      apiKey: 'k', fetcher, cacheStore: { get, set },
      imageBase64: 'AAAA', imageMediaType: 'image/png',
    });
    const userMsg = captured!.messages.at(-1)!;
    const imgBlock = userMsg.content.find((c) => c.type === 'image')!;
    expect(imgBlock.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'AAAA' });
  });

  it('keys a base64 vision draft separately from a text-only draft', () => {
    const textKey = proseCacheKey(spec, {});
    const visionKey = proseCacheKey(spec, { image: true });
    expect(visionKey).not.toEqual(textKey);
    // base64 must produce the vision-marked key, not the text-only one:
    expect(proseCacheKey(spec, { image: true })).toContain(':img');
  });
});
