import { describe, it, expect } from 'vitest';
import { sha256 } from 'js-sha256';
import {
  handlePublish,
  newLibraryId,
  newPullKey,
  LIBRARY_ID_RE,
  PULL_KEY_RE,
  MAX_BUNDLE_CHARS,
  LIBRARY_LIMIT,
  type LibraryMeta,
} from '../src/libraries';
import { SlidingWindowLimiter } from '../src/ratelimit';
import type { HandlerDeps } from '../src/handlers';

const UUID_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_UUID_KEY = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string, _opts?: { expirationTtl?: number }) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
}

const BUNDLE = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'Test File',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'tokens: {}\n', artifact: { spec_layer: { export: { content_hash: 'aaa' } } } },
  components: [{ name: 'Button', ai: 'component: Button\n', artifact: { spec_layer: { export: { content_hash: 'bbb' } } } }],
};

function publishReq(body: unknown, key = UUID_KEY) {
  return new Request('https://proxy.test/v1/libraries', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    salt: 'salt',
    anthropicKey: 'sk-ant-test',
    fetcher: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    licenseCache: new MemKV(),
    now: () => Date.parse('2026-07-01T00:00:00Z'),
    quotaFor: () => {
      throw new Error('quotaFor should not be called by library handlers');
    },
    log: () => {},
    licenseLimiter: new SlidingWindowLimiter(20, 60_000),
    requestLimiter: new SlidingWindowLimiter(60, 60_000),
    libraryStore: new MemKV(),
    ...overrides,
  };
}

/** Seeds a Pro-active license the way handlers.test.ts does for its Pro cases. */
async function seedPro(d: HandlerDeps, key = UUID_KEY) {
  await d.licenseCache.put(`lic:${sha256(key)}`, JSON.stringify({ status: 'active', validatedAt: d.now() }));
}

/** Seeds an expired (free-tier) license the way handlers.test.ts does. */
async function seedFree(d: HandlerDeps, key = UUID_KEY) {
  await d.licenseCache.put(`lic:${sha256(key)}`, JSON.stringify({ status: 'expired', validatedAt: d.now() }));
}

describe('id and key generation', () => {
  it('generates well-formed ids and keys', () => {
    expect(newLibraryId()).toMatch(LIBRARY_ID_RE);
    expect(newPullKey()).toMatch(PULL_KEY_RE);
    expect(newPullKey()).not.toBe(newPullKey());
  });
});

describe('handlePublish', () => {
  it('rejects unauthenticated requests', async () => {
    const d = deps();
    const req = new Request('https://proxy.test/v1/libraries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundle: BUNDLE }),
    });
    const res = await handlePublish(req, d);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('rejects a free-tier license', async () => {
    const d = deps();
    await seedFree(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('license_not_active');
  });

  it('creates a library on first publish', async () => {
    const d = deps();
    await seedPro(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(201);
    const body = await res.json() as { libraryId: string; pullKey: string; publishedAt: string };
    expect(body.libraryId).toMatch(LIBRARY_ID_RE);
    expect(body.pullKey).toMatch(PULL_KEY_RE);
    expect(() => new Date(body.publishedAt).toISOString()).not.toThrow();
    expect(new Date(body.publishedAt).toISOString()).toBe(body.publishedAt);

    const storedBundle = await d.libraryStore.get(`lib:${body.libraryId}:bundle`);
    expect(storedBundle).toBe(JSON.stringify(BUNDLE));

    const metaRaw = await d.libraryStore.get(`lib:${body.libraryId}:meta`);
    expect(metaRaw).not.toBeNull();
    const meta = JSON.parse(metaRaw as string) as LibraryMeta;
    expect(meta.keyHash).toBe(sha256(body.pullKey));
    expect(meta.licenseId).toBe(`lic:${sha256(UUID_KEY)}`);
    expect(meta.bundleHash).toBe(sha256(JSON.stringify(BUNDLE)));

    const ownerRaw = await d.libraryStore.get(`libowner:lic:${sha256(UUID_KEY)}`);
    expect(JSON.parse(ownerRaw as string)).toEqual([body.libraryId]);

    // The raw pull key must never appear in any stored KV value.
    for (const value of d.libraryStore.map.values()) {
      expect(value).not.toContain(body.pullKey);
    }
  });

  it('republishes to an owned library without rotating the key', async () => {
    const d = deps();
    await seedPro(d);
    const first = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    const firstBody = await first.json() as { libraryId: string; pullKey: string };
    const { libraryId, pullKey } = firstBody;

    const updatedBundle = { ...BUNDLE, fileName: 'Renamed File' };
    const second = await handlePublish(publishReq({ libraryId, bundle: updatedBundle }), d);
    expect(second.status).toBe(200);
    const secondBody = await second.json() as Record<string, unknown>;
    expect('pullKey' in secondBody).toBe(false);
    expect(secondBody.libraryId).toBe(libraryId);

    const metaRaw = await d.libraryStore.get(`lib:${libraryId}:meta`);
    const meta = JSON.parse(metaRaw as string) as LibraryMeta;
    expect(meta.keyHash).toBe(sha256(pullKey));

    const storedBundle = await d.libraryStore.get(`lib:${libraryId}:bundle`);
    expect(storedBundle).toBe(JSON.stringify(updatedBundle));

    const ownerRaw = await d.libraryStore.get(`libowner:lic:${sha256(UUID_KEY)}`);
    expect(JSON.parse(ownerRaw as string)).toHaveLength(1);
  });

  it('rejects republish to a library owned by another license', async () => {
    const d = deps();
    await seedPro(d, UUID_KEY);
    await seedPro(d, OTHER_UUID_KEY);
    const first = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    const { libraryId } = await first.json() as { libraryId: string };

    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, OTHER_UUID_KEY), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_owner' });
  });

  it('404s a republish to an unknown libraryId', async () => {
    const d = deps();
    await seedPro(d);
    const res = await handlePublish(publishReq({ libraryId: 'lib_000000000000000000000000', bundle: BUNDLE }), d);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects a malformed bundle', async () => {
    const d = deps();
    await seedPro(d);
    const { schema: _schema, ...withoutSchema } = BUNDLE;
    const res = await handlePublish(publishReq({ bundle: withoutSchema }), d);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid bundle');
  });

  it('rejects an oversized bundle', async () => {
    const d = deps();
    await seedPro(d);
    const bigBundle = {
      ...BUNDLE,
      components: [{ ...BUNDLE.components[0], ai: 'x'.repeat(MAX_BUNDLE_CHARS) }],
    };
    const res = await handlePublish(publishReq({ bundle: bigBundle }), d);
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string; size: number; limit: number };
    expect(body.error).toBe('bundle_too_large');
    expect(body.size).toBeGreaterThan(MAX_BUNDLE_CHARS);
    expect(body.limit).toBe(MAX_BUNDLE_CHARS);
  });

  it('caps libraries per license', async () => {
    const d = deps();
    await seedPro(d);
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    const preseeded = Array.from({ length: LIBRARY_LIMIT }, (_, i) => `lib_${String(i).padStart(24, '0')}`);
    await d.libraryStore.put(`libowner:${licenseId}`, JSON.stringify(preseeded));

    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'library_limit', limit: LIBRARY_LIMIT });
  });

  it('rate limits per IP', async () => {
    const d = deps({ licenseLimiter: new SlidingWindowLimiter(1, 60_000) });
    await seedPro(d);
    const req = () => {
      const r = publishReq({ bundle: BUNDLE });
      r.headers.set('CF-Connecting-IP', '1.2.3.4');
      return r;
    };
    const first = await handlePublish(req(), d);
    expect(first.status).toBe(201);
    const second = await handlePublish(req(), d);
    expect(second.status).toBe(429);
  });
});
