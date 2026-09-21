import { describe, it, expect } from 'vitest';
import { validateProseBody, parseProseCacheKey, upstreamRequest } from '../src/handlers';
import {
  groupProseRequest, groupCacheKey, proseCacheKey, proseRequest, contentHash,
  PROSE_SYSTEM_PROMPT, PROSE_MAX_TOKENS, proseFewShot, FOUNDATION_SYSTEM_PROMPT,
  LEGACY_PROSE_SYSTEM_PROMPT, legacyProseFewShot, LEGACY_PROSE_MAX_TOKENS,
  LEGACY_FOUNDATION_SYSTEM_PROMPT, LEGACY_GROUP_MAX_TOKENS, GROUP_MAX_TOKENS,
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
const groupInput = { collections: [{
  collectionId: 'c1', collectionName: 'Semantic', modeNames: ['Light'], aliasCounts: [], groups: briefs,
}] };

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1', description: '', documentationLinks: [],
  anatomy: [], anatomyComponentId: '1:1', props: [], variants: [], variantInstances: [], states: [],
  tokens: [], related: [], gaps: [], layout: [], rawValues: [], nodeEffects: [],
} as unknown as IntermediateSpec;

const v9 = (tier: 'pro' | 'free') => ({ cacheKey: proseCacheKey(spec, { tier }), request: proseRequest(spec) });

/**
 * The shipped 5.1.0 foundation group payload, rebuilt from the client at this
 * branch's merge base (9dc840a: `groupCacheKey`, `groupProseRequest` and
 * `buildGroupPrompt`). It is written out rather than imported because nothing
 * in the tree builds it any more: the key gained a tier segment, the prompt
 * gained the modes, alias counts and overview lines, and the request stopped
 * naming a model. The system bytes come from the frozen export.
 */
const LEGACY_GROUP_PROMPT = [
  'Collection: Semantic',
  '',
  'Groups to describe:',
  '',
  'key: c1|color/surface',
  'heading: Surface',
  'type: COLOR',
  '  color/surface/primary = #722ED1',
  '',
  'Return JSON: { "<key>": "<description>", ... } with one entry per key above.',
].join('\n');

const LEGACY_GROUP_BODY = {
  // The v1 hash was `contentHash({ collectionName, groups })` over the same
  // five brief fields the v2 key still hashes. The validator never reads the
  // hash, only the key's shape, so any well-formed `prose:v1:groups:<hex>`
  // would serve here just as well.
  cacheKey: `prose:v1:groups:${contentHash({ collectionName: 'Semantic', groups: briefs })}`,
  request: {
    model: 'claude-haiku-4-5',
    max_tokens: LEGACY_GROUP_MAX_TOKENS,
    system: LEGACY_FOUNDATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: LEGACY_GROUP_PROMPT }],
  },
};

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

  it('still accepts the shipped v1 group payload until the 6.0.0 plugin is live', () => {
    // Task 5 edited FOUNDATION_SYSTEM_PROMPT in place. Without the frozen v8
    // copy, this body fails 'system not allowed' the moment the proxy deploys,
    // and every 5.1.0 foundation build reports that AI descriptions were
    // skipped. The two prompts really are different bytes:
    expect(LEGACY_FOUNDATION_SYSTEM_PROMPT).not.toBe(FOUNDATION_SYSTEM_PROMPT);
    expect(validateProseBody(LEGACY_GROUP_BODY)).toBeNull();
  });

  it('rejects v3 group bytes under a v1 key and v8 group bytes under a v3 key', () => {
    const v3 = groupProseRequest(groupInput, 'free');
    // v3 bytes under the old key: the legacy branch requires the model the
    // shipped client named, and the v3 request names none.
    expect(validateProseBody({ ...v3, cacheKey: LEGACY_GROUP_BODY.cacheKey })).toBe('model not allowed');
    // v8 bytes under a v9-era key: the model is refused first...
    expect(validateProseBody({ ...LEGACY_GROUP_BODY, cacheKey: v3.cacheKey })).toBe('model not allowed');
    // ...and the old system prompt right after it, which is the assertion that
    // pins the freeze to the legacy branch alone.
    const { model: _model, ...noModel } = LEGACY_GROUP_BODY.request;
    expect(validateProseBody({ cacheKey: v3.cacheKey, request: noModel })).toBe('system not allowed');
  });

  it('accepts the v3 group request, including a collection with no groups', () => {
    const noGroups = { collections: [{ collectionId: 'c2', collectionName: 'Spacing', modeNames: [], aliasCounts: [], groups: [] }] };
    expect(validateProseBody(groupProseRequest(groupInput, 'free'))).toBeNull();
    expect(validateProseBody(groupProseRequest(noGroups, 'pro'))).toBeNull();
    expect(validateProseBody(groupProseRequest({ collections: [...groupInput.collections, ...noGroups.collections] }, 'free'))).toBeNull();
  });

  it('still accepts the frozen 5.1.0 group request and rejects the unshipped v2 key', () => {
    expect(validateProseBody(LEGACY_GROUP_BODY)).toBeNull();
    const v2 = groupProseRequest(groupInput, 'free');
    expect(validateProseBody({ ...v2, cacheKey: v2.cacheKey.replace(':v3:', ':v2:') })).toBe('bad cacheKey');
  });

  it('holds the two token caps apart, so raising the v3 one leaves 5.1.0 alone', () => {
    // v3 raised GROUP_MAX_TOKENS and LEGACY_GROUP_MAX_TOKENS stayed where the
    // shipped client left it. Each branch must demand its own number: the
    // shipped 1200 under a v3 key is a client sending the wrong bytes, and the
    // new cap under the frozen key is the same mistake the other way.
    expect(GROUP_MAX_TOKENS).not.toBe(LEGACY_GROUP_MAX_TOKENS);
    const v3 = groupProseRequest(groupInput, 'free');
    expect(v3.request.max_tokens).toBe(GROUP_MAX_TOKENS);
    expect(validateProseBody({ ...v3, request: { ...v3.request, max_tokens: LEGACY_GROUP_MAX_TOKENS } })).toBe('max_tokens not allowed');
    expect(validateProseBody({
      ...LEGACY_GROUP_BODY,
      request: { ...LEGACY_GROUP_BODY.request, max_tokens: GROUP_MAX_TOKENS },
    })).toBe('max_tokens not allowed');
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
    expect(parseProseCacheKey('prose:v3:groups:free:abc')).toEqual({ version: 3, kind: 'groups', tier: 'free' });
    // The v2 groups key never shipped, so nothing legitimate sends it.
    expect(parseProseCacheKey('prose:v2:groups:free:abc')).toBeNull();
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
