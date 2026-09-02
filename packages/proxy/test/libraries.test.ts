import { describe, it, expect } from 'vitest';
import { sha256 } from 'js-sha256';
import {
  handlePublish,
  handlePull,
  handleRotate,
  newLibraryId,
  newPullKey,
  LIBRARY_ID_RE,
  PULL_KEY_RE,
  MAX_BUNDLE_BYTES,
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
  async list(opts: { prefix: string }) {
    return { keys: [...this.map.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name })) };
  }
}

const byteLength = (s: string) => new TextEncoder().encode(s).byteLength;

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

function pullReq(libraryId: string, key: string, etag?: string) {
  return new Request(`https://proxy.test/v1/libraries/${libraryId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(etag ? { 'If-None-Match': etag } : {}) },
  });
}

function rotateReq(libraryId: string, key = UUID_KEY) {
  return new Request(`https://proxy.test/v1/libraries/${libraryId}/rotate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
  });
}

/** Helper that publishes a library and returns the deps, libraryId, and pullKey. */
async function publishedLibrary(
  d: HandlerDeps = deps(),
  key = UUID_KEY,
) {
  await seedPro(d, key);
  const res = await handlePublish(publishReq({ bundle: BUNDLE }, key), d);
  const body = await res.json() as { libraryId: string; pullKey: string };
  return { deps: d, libraryId: body.libraryId, pullKey: body.pullKey };
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
    // The key digest has its own record so rotate and republish never write the same value.
    expect(meta.keyHash).toBeUndefined();
    expect(await d.libraryStore.get(`lib:${body.libraryId}:key`)).toBe(sha256(body.pullKey));
    expect(meta.licenseId).toBe(`lic:${sha256(UUID_KEY)}`);
    expect(meta.bundleHash).toBe(sha256(JSON.stringify(BUNDLE)));

    // One ownership record per library, so concurrent creates never overwrite a list.
    expect(await d.libraryStore.get(`libowner:lic:${sha256(UUID_KEY)}:${body.libraryId}`)).not.toBeNull();
    expect(await d.libraryStore.get(`libowner:lic:${sha256(UUID_KEY)}`)).toBeNull();

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
    expect(meta.keyHash).toBeUndefined();
    expect(await d.libraryStore.get(`lib:${libraryId}:key`)).toBe(sha256(pullKey));

    const storedBundle = await d.libraryStore.get(`lib:${libraryId}:bundle`);
    expect(storedBundle).toBe(JSON.stringify(updatedBundle));

    // A republish adds no ownership record: still exactly one for this license.
    const { keys } = await d.libraryStore.list({ prefix: `libowner:lic:${sha256(UUID_KEY)}:` });
    expect(keys).toHaveLength(1);
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

  it('rejects an oversized bundle, measuring the body in bytes', async () => {
    const d = deps();
    await seedPro(d);
    const bigBundle = {
      ...BUNDLE,
      components: [{ ...BUNDLE.components[0], ai: 'x'.repeat(MAX_BUNDLE_BYTES) }],
    };
    const res = await handlePublish(publishReq({ bundle: bigBundle }), d);
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string; size: number; limit: number };
    expect(body.error).toBe('bundle_too_large');
    expect(body.size).toBe(byteLength(JSON.stringify({ bundle: bigBundle })));
    expect(body.limit).toBe(MAX_BUNDLE_BYTES);
  });

  it('measures multi-byte text in bytes on both the header check and the body check', async () => {
    // 1.8M three-byte characters: under the cap in UTF-16 code units, over it in bytes.
    const bundle = { ...BUNDLE, components: [{ ...BUNDLE.components[0], ai: '\u6f22'.repeat(1_800_000) }] };
    const payload = JSON.stringify({ bundle });
    const d = deps();
    await seedPro(d);
    const withHeader = new Request('https://proxy.test/v1/libraries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${UUID_KEY}`, 'content-length': String(byteLength(payload)) },
      body: payload,
    });
    const res = await handlePublish(withHeader, d);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'bundle_too_large', size: byteLength(payload), limit: MAX_BUNDLE_BYTES });

    // The same text at a size that is over the cap in bytes but with no header still 413s with bytes.
    const noHeader = new Request('https://proxy.test/v1/libraries', {
      method: 'POST', headers: { Authorization: `Bearer ${UUID_KEY}` }, body: payload,
    });
    const res2 = await handlePublish(noHeader, d);
    expect(res2.status).toBe(413);
    expect(((await res2.json()) as { size: number }).size).toBe(byteLength(payload));
  });

  it('rejects an unsupported bundle version', async () => {
    const d = deps();
    await seedPro(d);
    const res = await handlePublish(publishReq({ bundle: { ...BUNDLE, version: '2.0.0' } }), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported bundle version', version: '2.0.0' });
  });

  it('rejects a bundle without extractorVersion, the same way the CLI would', async () => {
    const d = deps();
    await seedPro(d);
    const { extractorVersion: _e, ...noExtractor } = BUNDLE;
    const res = await handlePublish(publishReq({ bundle: noExtractor }), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid bundle' });
  });

  it('caps libraries per license', async () => {
    const d = deps();
    await seedPro(d);
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    for (let i = 0; i < LIBRARY_LIMIT; i += 1) {
      await d.libraryStore.put(`libowner:${licenseId}:lib_${String(i).padStart(24, '0')}`, '1');
    }

    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'library_limit', limit: LIBRARY_LIMIT });
  });

  it('migrates a legacy owner array to per-library keys and counts both', async () => {
    const d = deps();
    await seedPro(d);
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    const legacy = Array.from({ length: LIBRARY_LIMIT - 1 }, (_, i) => `lib_${String(i).padStart(24, '0')}`);
    await d.libraryStore.put(`libowner:${licenseId}`, JSON.stringify(legacy));

    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(201);
    const { libraryId } = await res.json() as { libraryId: string };
    for (const id of legacy) expect(await d.libraryStore.get(`libowner:${licenseId}:${id}`)).not.toBeNull();
    expect(await d.libraryStore.get(`libowner:${licenseId}:${libraryId}`)).not.toBeNull();
    expect(await d.libraryStore.get(`libowner:${licenseId}`)).toBeNull();

    const full = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(full.status).toBe(403);
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

describe('handlePull', () => {
  it('returns the stored bundle bytes verbatim with ETag and X-Published-At', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    const res = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(BUNDLE));
    expect(res.headers.get('ETag')).toBe(`"${sha256(JSON.stringify(BUNDLE))}"`);
    expect(res.headers.get('X-Published-At')).toBe(new Date(d.now()).toISOString());
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('returns 304 with headers and empty body on a matching If-None-Match', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    const etag = `"${sha256(JSON.stringify(BUNDLE))}"`;
    const res = await handlePull(pullReq(libraryId, pullKey, etag), d, libraryId);
    expect(res.status).toBe(304);
    const text = await res.text();
    expect(text).toBe('');
    expect(res.headers.get('ETag')).toBe(etag);
    expect(res.headers.get('X-Published-At')).toBe(new Date(d.now()).toISOString());
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('returns the full body when If-None-Match does not match', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    const wrongEtag = '"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"';
    const res = await handlePull(pullReq(libraryId, pullKey, wrongEtag), d, libraryId);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(BUNDLE));
  });

  it('rejects a malformed key', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const res = await handlePull(pullReq(libraryId, 'nope'), d, libraryId);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_key' });
  });

  it('rejects a well-formed wrong key', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const wrongKey = 'sl_' + '0'.repeat(48);
    const res = await handlePull(pullReq(libraryId, wrongKey), d, libraryId);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_key' });
  });

  it('404s an unknown library id', async () => {
    const d = deps();
    const unknownLibId = 'lib_' + '0'.repeat(24);
    const someKey = 'sl_' + '0'.repeat(48);
    const res = await handlePull(pullReq(unknownLibId, someKey), d, unknownLibId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('still serves pulls after the license lapses', async () => {
    const d = deps();
    await seedPro(d);
    const publishRes = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    const publishBody = await publishRes.json() as { libraryId: string; pullKey: string };
    const { libraryId, pullKey } = publishBody;

    // Flip the license fixture to free (expired) by re-seeding
    await seedFree(d);
    const pullRes = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(pullRes.status).toBe(200);
    const text = await pullRes.text();
    expect(text).toBe(JSON.stringify(BUNDLE));
  });

  it('rate limits pulls per IP', async () => {
    const d = deps({ requestLimiter: new SlidingWindowLimiter(1, 60_000) });
    const { libraryId, pullKey } = await publishedLibrary(d);

    const req = () => {
      const r = pullReq(libraryId, pullKey);
      r.headers.set('CF-Connecting-IP', '5.6.7.8');
      return r;
    };
    const first = await handlePull(req(), d, libraryId);
    expect(first.status).toBe(200);
    const second = await handlePull(req(), d, libraryId);
    expect(second.status).toBe(429);
  });
});

describe('handleRotate', () => {
  it('rotates the key: old key stops pulling, new key pulls', async () => {
    const { deps: d, libraryId, pullKey: oldKey } = await publishedLibrary();
    const metaBefore = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`)) as string) as LibraryMeta;

    const res = await handleRotate(rotateReq(libraryId), d, libraryId);
    expect(res.status).toBe(200);
    const body = await res.json() as { pullKey: string };
    expect(body.pullKey).toMatch(PULL_KEY_RE);
    expect(body.pullKey).not.toBe(oldKey);

    const oldPull = await handlePull(pullReq(libraryId, oldKey), d, libraryId);
    expect(oldPull.status).toBe(401);
    expect(await oldPull.json()).toEqual({ error: 'invalid_key' });

    const newPull = await handlePull(pullReq(libraryId, body.pullKey), d, libraryId);
    expect(newPull.status).toBe(200);
    expect(await newPull.text()).toBe(JSON.stringify(BUNDLE));

    // Rotate touches only the key record, so it can never clobber a concurrent republish's meta.
    const metaAfter = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`)) as string) as LibraryMeta;
    expect(metaAfter).toEqual(metaBefore);
    expect(await d.libraryStore.get(`lib:${libraryId}:key`)).toBe(sha256(body.pullKey));
  });

  it('still authenticates a library published before the key record existed', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    const meta = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`)) as string) as LibraryMeta;
    await d.libraryStore.put(`lib:${libraryId}:meta`, JSON.stringify({ ...meta, keyHash: sha256(pullKey) }));
    await d.libraryStore.delete(`lib:${libraryId}:key`);

    const pull = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(pull.status).toBe(200);

    const rotated = await handleRotate(rotateReq(libraryId), d, libraryId);
    const { pullKey: next } = await rotated.json() as { pullKey: string };
    expect((await handlePull(pullReq(libraryId, pullKey), d, libraryId)).status).toBe(401);
    expect((await handlePull(pullReq(libraryId, next), d, libraryId)).status).toBe(200);
  });

  it('rejects a non-owner license', async () => {
    const d = deps();
    await seedPro(d, UUID_KEY);
    await seedPro(d, OTHER_UUID_KEY);
    const publishRes = await handlePublish(publishReq({ bundle: BUNDLE }, UUID_KEY), d);
    const { libraryId } = await publishRes.json() as { libraryId: string };

    const res = await handleRotate(rotateReq(libraryId, OTHER_UUID_KEY), d, libraryId);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_owner' });
  });

  it('rejects a lapsed license', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    await seedFree(d);
    const res = await handleRotate(rotateReq(libraryId), d, libraryId);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('license_not_active');
  });

  it('404s an unknown library', async () => {
    const d = deps();
    await seedPro(d);
    const unknownLibId = 'lib_' + '0'.repeat(24);
    const res = await handleRotate(rotateReq(unknownLibId), d, unknownLibId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
