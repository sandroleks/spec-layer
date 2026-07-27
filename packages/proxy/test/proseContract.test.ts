import { describe, it, expect } from 'vitest';
import { validateProseBody } from '../src/handlers';
import {
  groupProseRequest, groupCacheKey, proseCacheKey,
  type FoundationGroupBrief,
} from '@spec-layer/extractor';
import type { IntermediateSpec } from '@spec-layer/extractor';

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
  folder: 'c1|color/surface',
  title: 'Surface',
  resolvedType: 'COLOR',
  tokenNames: ['color/surface/primary'],
  sampleValues: ['#722ED1'],
}];

describe('/v1/prose accepts what the client sends', () => {
  it('accepts the group-description payload', () => {
    const payload = groupProseRequest({ collectionName: 'Semantic', groups: briefs });
    expect(validateProseBody(payload)).toBeNull();
  });

  it('accepts a component prose cacheKey too', () => {
    // The other caller of the same endpoint, so the prefix rule is covered for
    // both and neither can drift alone.
    const spec = { name: 'Button' } as unknown as IntermediateSpec;
    expect(validateProseBody({
      cacheKey: proseCacheKey(spec),
      request: { model: 'claude-haiku-4-5', max_tokens: 3000, messages: [] },
    })).toBeNull();
  });

  it('rejects the bare hash the group request used to send', () => {
    // The actual bug, pinned so it cannot come back.
    const payload = groupProseRequest({ collectionName: 'Semantic', groups: briefs });
    const bare = payload.cacheKey.replace(/^prose:v\d+:groups:/, '');
    expect(validateProseBody({ ...payload, cacheKey: bare })).toBe('bad cacheKey');
  });

  it('keeps group keys out of the component prose namespace', () => {
    // Both hit one endpoint and one server-side cache, so a shared key would let
    // a component response be served as a group description.
    const spec = { name: 'Button' } as unknown as IntermediateSpec;
    const groupKey = groupCacheKey({ collectionName: 'Semantic', groups: briefs });
    expect(groupKey).not.toBe(proseCacheKey(spec));
    expect(groupKey).toContain(':groups:');
  });

  it('stays inside the max_tokens ceiling the proxy enforces', () => {
    const payload = groupProseRequest({ collectionName: 'Semantic', groups: briefs });
    expect(payload.request.max_tokens).toBeLessThanOrEqual(3000);
  });

  it('uses the only model the proxy allows', () => {
    const payload = groupProseRequest({ collectionName: 'Semantic', groups: briefs });
    expect(payload.request.model).toBe('claude-haiku-4-5');
  });
});
