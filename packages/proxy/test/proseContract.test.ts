import { describe, it, expect } from 'vitest';
import { validateProseBody, parseProseCacheKey, upstreamRequest } from '../src/handlers';
import {
  groupProseRequest, groupCacheKey, proseCacheKey, proseRequest,
  PROSE_SYSTEM_PROMPT, PROSE_MAX_TOKENS, proseFewShot,
  LEGACY_PROSE_SYSTEM_PROMPT, legacyProseFewShot, LEGACY_PROSE_MAX_TOKENS,
  type FoundationGroupBrief, type IntermediateSpec,
} from '@spec-layer/extractor';

/**
 * The client/server contract for /v1/prose, tested against the server's REAL
 * validator rather than a restatement of it.
 *
 * This exists because of a shipped bug: the foundation group-description request
 * used a bare content hash as its cacheKey, the proxy rejects anything not
 * matching /^prose:v\d+:/, and the whole feature silently degraded to "the AI did
 * not run". Every unit test passed, because they all stubbed fetch, and a stub
 * cannot enforce a rule that lives on the server.
 */

const briefs: FoundationGroupBrief[] = [{
  folder: 'c1|color/surface', title: 'Surface', resolvedType: 'COLOR',
  tokenNames: ['color/surface/primary'], sampleValues: ['#722ED1'],
}];
const groupInput = { collectionName: 'Semantic', modeNames: ['Light'], aliasCounts: [], groups: briefs };

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1', description: '', documentationLinks: [],
  anatomy: [], anatomyComponentId: '1:1', props: [], variants: [], variantInstances: [], states: [],
  tokens: [], related: [], gaps: [], layout: [], rawValues: [], nodeEffects: [],
} as unknown as IntermediateSpec;

const v9 = (tier: 'pro' | 'free') => ({ cacheKey: proseCacheKey(spec, { tier }), request: proseRequest(spec) });

describe('/v1/prose accepts what the v9 client sends', () => {
  it('accepts the component payload for both tiers', () => {
    expect(validateProseBody(v9('free'))).toBeNull();
    expect(validateProseBody(v9('pro'))).toBeNull();
  });

  it('accepts the group payload for both tiers', () => {
    expect(validateProseBody(groupProseRequest(groupInput, 'free'))).toBeNull();
    expect(validateProseBody(groupProseRequest(groupInput, 'pro'))).toBeNull();
  });

  it('rejects a v9 body that names a model', () => {
    const body = v9('free');
    expect(validateProseBody({ ...body, request: { ...body.request, model: 'claude-haiku-4-5' } })).toBe('model not allowed');
  });

  it('rejects a v9 key without a tier segment, and one with an unknown segment', () => {
    const body = v9('free');
    expect(validateProseBody({ ...body, cacheKey: body.cacheKey.replace(':free:', ':') })).toBe('bad cacheKey');
    expect(validateProseBody({ ...body, cacheKey: body.cacheKey.replace(':free:', ':gold:') })).toBe('bad cacheKey');
  });

  it('rejects v9 bytes under a v8 key and v8 bytes under a v9 key', () => {
    const body = v9('free');
    expect(validateProseBody({ ...body, cacheKey: 'prose:v8:abc' })).toBe('model not allowed');
    const legacy = {
      cacheKey: body.cacheKey,
      request: { model: 'claude-haiku-4-5', max_tokens: LEGACY_PROSE_MAX_TOKENS, system: LEGACY_PROSE_SYSTEM_PROMPT,
        messages: [...legacyProseFewShot(), { role: 'user', content: 'Component: Button\n\nReturn ONLY a JSON object with these keys: definition.' }] },
    };
    expect(validateProseBody(legacy)).toBe('model not allowed');
  });

  it('requires exactly the shipped cap, system prompt and few-shot', () => {
    const body = v9('free');
    expect(validateProseBody({ ...body, request: { ...body.request, max_tokens: PROSE_MAX_TOKENS + 1 } })).toBe('max_tokens not allowed');
    expect(validateProseBody({ ...body, request: { ...body.request, system: PROSE_SYSTEM_PROMPT + ' ' } })).toBe('system not allowed');
    const [user, assistant] = proseFewShot();
    const altered = [user, { ...assistant, content: [{ type: 'text', text: '{}', cache_control: { type: 'ephemeral' } }] }, body.request.messages[2]];
    expect(validateProseBody({ ...body, request: { ...body.request, messages: altered } })).toBe('invalid messages');
  });

  it('rejects a cache_control anywhere but the exemplar answer, and one missing from it', () => {
    const body = v9('free');
    const [user, assistant, final] = body.request.messages;
    const noBreakpoint = [user, { role: 'assistant', content: [{ type: 'text', text: (assistant.content as Array<{ text: string }>)[0].text }] }, final];
    expect(validateProseBody({ ...body, request: { ...body.request, messages: noBreakpoint } })).toBe('invalid messages');
    const onFinal = [user, assistant, { role: 'user', content: [{ type: 'text', text: final.content as string, cache_control: { type: 'ephemeral' } }] }];
    expect(validateProseBody({ ...body, request: { ...body.request, messages: onFinal } })).toBe('invalid messages');
  });

  it('still accepts the shipped v8 payload until the 6.0.0 plugin is live', () => {
    expect(validateProseBody({
      cacheKey: 'prose:v8:abc123',
      request: { model: 'claude-haiku-4-5', max_tokens: LEGACY_PROSE_MAX_TOKENS, system: LEGACY_PROSE_SYSTEM_PROMPT,
        messages: [...legacyProseFewShot(), { role: 'user', content: 'Component: Button\n\nReturn ONLY a JSON object with these keys: definition.' }] },
    })).toBeNull();
  });

  it('rejects caller-controlled Anthropic options and remote image URLs', () => {
    const body = v9('free');
    expect(validateProseBody({ ...body, request: { ...body.request, temperature: 1 } })).toBe('unexpected request field');
    const [user, assistant] = body.request.messages;
    const remote = [user, assistant, { role: 'user', content: [
      { type: 'image', source: { type: 'url', url: 'https://example.test/image.png' } },
      { type: 'text', text: body.request.messages[2].content },
    ] }];
    expect(validateProseBody({ ...body, request: { ...body.request, messages: remote } })).toBe('invalid messages');
  });

  it('keeps group keys out of the component namespace', () => {
    expect(groupCacheKey(groupInput, 'free')).toContain(':groups:');
    expect(groupCacheKey(groupInput, 'free')).not.toBe(proseCacheKey(spec, { tier: 'free' }));
  });
});

describe('parseProseCacheKey', () => {
  it('reads version, kind and tier', () => {
    expect(parseProseCacheKey('prose:v9:pro:abc')).toEqual({ version: 9, kind: 'component', tier: 'pro' });
    expect(parseProseCacheKey('prose:v2:groups:free:abc')).toEqual({ version: 2, kind: 'groups', tier: 'free' });
    expect(parseProseCacheKey('prose:v8:abc')).toEqual({ version: 8, kind: 'component', tier: null });
    expect(parseProseCacheKey('prose:v1:groups:abc')).toEqual({ version: 1, kind: 'groups', tier: null });
    expect(parseProseCacheKey('abc')).toBeNull();
  });
});

describe('upstreamRequest', () => {
  const request = { max_tokens: PROSE_MAX_TOKENS, system: PROSE_SYSTEM_PROMPT, messages: [] };
  it('assigns Sonnet 5 with low effort to pro and Haiku 4.5 with nothing extra to free', () => {
    expect(upstreamRequest(request, 'pro', false)).toEqual({ ...request, model: 'claude-sonnet-5', output_config: { effort: 'low' } });
    expect(upstreamRequest(request, 'free', false)).toEqual({ ...request, model: 'claude-haiku-4-5' });
  });
  it('never adds a thinking field', () => {
    expect('thinking' in upstreamRequest(request, 'pro', false)).toBe(false);
  });
  it('forwards a legacy request untouched', () => {
    const legacy = { ...request, model: 'claude-haiku-4-5' };
    expect(upstreamRequest(legacy, 'pro', true)).toEqual(legacy);
  });
});
