import { describe, it, expect, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { libraryBundleContentHash } from '@spec-layer/extractor';
import {
  handlePublish,
  handlePull,
  handleRotate,
  handleVersions,
  newLibraryId,
  newPullKey,
  ifNoneMatchMatches,
  LIBRARY_ID_RE,
  PULL_KEY_RE,
  MAX_BUNDLE_BYTES,
  LIBRARY_LIMITS,
  MAX_FILE_NAME_LENGTH,
  truncateUtf16,
  type LibraryMeta,
} from '../src/libraries';
import { versionsKey, versionBundleKey, type VersionLog } from '../src/versions';
import { hashFigmaId } from '../src/identity';
import { SlidingWindowLimiter } from '../src/ratelimit';
import { PRO_SOFT_THRESHOLD, RESERVATION_TTL_MS } from '../src/quota';
import { memQuota } from './quotaHarness';
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
  async getStream(k: string): Promise<ReadableStream | null> {
    const v = this.map.get(k);
    return v === undefined ? null : new Response(v).body;
  }
}

const byteLength = (s: string) => new TextEncoder().encode(s).byteLength;

/**
 * An artifact with the export envelope a real one carries. `id` and
 * `generated_at` are the two fields the plugin restamps on every build, so a
 * test can move them alone to imitate a rebuild of unchanged sources.
 */
const artifact = (contentHash: string, generatedAt: string) => ({
  spec_layer: {
    kind: 'component',
    export: {
      id: `export:${generatedAt}`, generated_at: generatedAt,
      deterministic: true, content_hash: contentHash,
    },
  },
});

/** The bundle the plugin would assemble from fixed sources at `generatedAt`. */
const bundleAt = (generatedAt: string) => ({
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'Test File',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'tokens: {}\n', artifact: artifact('aaa', generatedAt) },
  components: [{ name: 'Button', ai: 'component: Button\n', artifact: artifact('bbb', generatedAt) }],
});

const BUNDLE = bundleAt('2026-07-01T00:00:00.000Z');

/** BUNDLE with a Card component added: a minor change. */
const BUNDLE_WITH_CARD = {
  ...BUNDLE,
  components: [
    ...BUNDLE.components,
    { name: 'Card', ai: 'component: Card\n', artifact: {
      ...artifact('ccc', '2026-07-01T00:00:00.000Z'),
      spec_layer: { ...artifact('ccc', '2026-07-01T00:00:00.000Z').spec_layer, source: { node_id: '9:9', node_name: 'Card', component_key: 'key-card' } },
    } },
  ],
};
/** BUNDLE with its only component removed: a major change. */
const BUNDLE_EMPTY = { ...BUNDLE, components: [] };
/** BUNDLE with a description-only change: content moved, no property changes. */
const BUNDLE_DESCRIBED = { ...BUNDLE, fileName: 'Renamed File' };

function versionsReq(libraryId: string, key: string, etag?: string) {
  return new Request(`https://proxy.test/v1/libraries/${libraryId}/versions`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(etag ? { 'If-None-Match': etag } : {}) },
  });
}

function publishReq(body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${UUID_KEY}` }) {
  return new Request('https://proxy.test/v1/libraries', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const bearer = (key = UUID_KEY) => ({ Authorization: `Bearer ${key}` });
const figma = (id = 'u1') => ({ 'X-Figma-User': id });
/** The pull key a free-plan library's writes must carry beside the Figma header. */
const pull = (key: string) => ({ 'X-Pull-Key': key });

/** Creates a library on the free plan and returns what the proxy handed back. */
async function freeLibrary(d: HandlerDeps, bundle: unknown = BUNDLE, id = 'u1') {
  const created = await handlePublish(publishReq({ bundle }, figma(id)), d);
  const body = await created.json() as { libraryId: string; pullKey: string; publishedAt: string };
  return { ...body, headers: { ...figma(id), ...pull(body.pullKey) } };
}

function pullReq(libraryId: string, key: string, etag?: string) {
  return new Request(`https://proxy.test/v1/libraries/${libraryId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(etag ? { 'If-None-Match': etag } : {}) },
  });
}

function rotateReq(libraryId: string, headers: Record<string, string> = { Authorization: `Bearer ${UUID_KEY}` }) {
  return new Request(`https://proxy.test/v1/libraries/${libraryId}/rotate`, {
    method: 'POST',
    headers,
  });
}

/** Helper that publishes a library and returns the deps, libraryId, and pullKey. */
async function publishedLibrary(
  d: HandlerDeps = deps(),
  key = UUID_KEY,
) {
  await seedPro(d, key);
  const res = await handlePublish(publishReq({ bundle: BUNDLE }, bearer(key)), d);
  const body = await res.json() as { libraryId: string; pullKey: string };
  return { deps: d, libraryId: body.libraryId, pullKey: body.pullKey };
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const now = overrides.now ?? (() => Date.parse('2026-07-01T00:00:00Z'));
  return {
    salt: 'salt',
    anthropicKey: 'sk-ant-test',
    fetcher: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    licenseCache: new MemKV(),
    now,
    quotaFor: memQuota(now),
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

describe('truncateUtf16', () => {
  /** One code point, two UTF-16 code units: a high surrogate then a low one. */
  const EMOJI = String.fromCodePoint(0x1f600);
  const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

  it('drops a whole surrogate pair when the cut falls between its halves, never leaving a lone high surrogate', () => {
    expect(EMOJI.length).toBe(2);
    expect(truncateUtf16(`a${EMOJI}`, 2)).toBe('a');
    const cut = truncateUtf16(`${'a'.repeat(255)}${EMOJI}`, 256);
    expect(cut).toBe('a'.repeat(255));
    expect(isHighSurrogate(cut.charCodeAt(cut.length - 1))).toBe(false);
  });

  it('keeps a pair that fits exactly, and returns a value at or under the cap unchanged', () => {
    expect(truncateUtf16(`${'a'.repeat(254)}${EMOJI}tail`, 256)).toBe(`${'a'.repeat(254)}${EMOJI}`);
    expect(truncateUtf16(`a${EMOJI}`, 3)).toBe(`a${EMOJI}`);
  });

  it('stores a publish fileName cut at a pair boundary without a lone surrogate', async () => {
    const d = deps();
    const res = await handlePublish(publishReq({ bundle: { ...BUNDLE, fileName: `${'n'.repeat(MAX_FILE_NAME_LENGTH - 1)}${EMOJI}tail` } }, figma()), d);
    expect(res.status).toBe(201);
    const { libraryId } = await res.json() as { libraryId: string };
    const meta = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`))!) as LibraryMeta;
    expect(meta.fileName).toBe('n'.repeat(MAX_FILE_NAME_LENGTH - 1));
    expect(isHighSurrogate((meta.fileName as string).charCodeAt((meta.fileName as string).length - 1))).toBe(false);
  });
});

describe('handlePublish', () => {
  it('records at most 256 characters of fileName in the meta and its echo, and stores the bundle bytes untouched', async () => {
    const d = deps();
    const longName = 'n'.repeat(1000);
    const bundle = { ...BUNDLE, fileName: longName };
    const first = await handlePublish(publishReq({ bundle }, figma()), d);
    expect(first.status).toBe(201);
    const { libraryId } = await first.json() as { libraryId: string };
    const meta = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`))!) as LibraryMeta;
    expect(meta.fileName).toBe('n'.repeat(MAX_FILE_NAME_LENGTH));
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(bundle));
    const second = await handlePublish(publishReq({ bundle: { ...BUNDLE, fileName: 'Second' } }, figma()), d);
    const body = await second.json() as { existing: { fileName: string } };
    expect(body.existing.fileName).toHaveLength(MAX_FILE_NAME_LENGTH);
  });

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

  it('publishes as free when the license is not active but a Figma identity is present', async () => {
    const d = deps();
    await seedFree(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Tier')).toBe('free');
  });

  it('rejects a lapsed license with no Figma identity (legacy client)', async () => {
    const d = deps();
    await seedFree(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe('license_not_active');
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
    // The byte hash serves the pull ETag; the content hash answers "changed?".
    expect(meta.contentHash).toBe(libraryBundleContentHash(BUNDLE));

    // One ownership record per library, so concurrent creates never overwrite a list.
    expect(await d.libraryStore.get(`libowner:lic:${sha256(UUID_KEY)}:${body.libraryId}`)).not.toBeNull();
    expect(await d.libraryStore.get(`libowner:lic:${sha256(UUID_KEY)}`)).toBeNull();

    // The raw pull key must never appear in any stored KV value.
    for (const value of d.libraryStore.map.values()) {
      expect(value).not.toContain(body.pullKey);
    }
  });

  it('creates a library for a free Figma identity, owned by that identity', async () => {
    const d = deps();
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    expect(res.status).toBe(201);
    const { libraryId } = await res.json() as { libraryId: string };
    const meta = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`))!) as LibraryMeta;
    expect(meta.licenseId).toBe(`free:${hashFigmaId('u1', 'salt')}`);
  });

  it('lets a Pro caller sending both headers and the key update a library created while free', async () => {
    const d = deps();
    const { libraryId, headers } = await freeLibrary(d);
    await seedPro(d);
    const changed = {
      ...BUNDLE,
      components: [...BUNDLE.components, { name: 'Card', ai: 'component: Card\n', artifact: { spec_layer: { export: { content_hash: 'ccc' } } } }],
    };
    const res = await handlePublish(publishReq({ libraryId, bundle: changed }, { ...bearer(), ...headers }), d);
    expect(res.status).toBe(200);
    // The license is a secret, but it was not this library's owner: the free
    // identity was, and it still needs the key to write.
    const noKey = await handlePublish(publishReq({ libraryId, bundle: changed }, { ...bearer(), ...figma() }), d);
    expect(noKey.status).toBe(403);
  });

  it('lets a lapsed license update the library it created while Pro', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    await seedFree(d);
    const changed = { ...BUNDLE, fileName: 'Renamed' };
    const res = await handlePublish(publishReq({ libraryId, bundle: changed }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(200);
  });

  it('refuses to publish as free when the license could not be checked', async () => {
    // No cache entry and Lemon Squeezy down: the key may well be active, so
    // the publish must not be metered, capped, or owned as free.
    const d = deps({ fetcher: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'license_not_active', reason: 'unreachable' });
    expect(d.libraryStore.map.size).toBe(0);
  });

  it('says how many libraries a lapsed license still owns when it hits the free limit', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    await d.libraryStore.put(`libowner:${licenseId}:lib_${'1'.repeat(24)}`, '1');
    await d.libraryStore.put(`libowner:${licenseId}:lib_${'2'.repeat(24)}`, '1');
    await seedFree(d);
    const res = await handlePublish(publishReq({ bundle: { ...BUNDLE, fileName: 'Fourth' } }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; limit: number; owned: number; existing: { libraryId: string } };
    expect(body).toMatchObject({ error: 'library_limit', limit: 1, owned: 3 });
    expect([libraryId, `lib_${'1'.repeat(24)}`, `lib_${'2'.repeat(24)}`]).toContain(body.existing.libraryId);
  });

  it('rejects a lapsed bearer-only update to its own library (legacy client)', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    await seedFree(d);
    const changed = { ...BUNDLE, fileName: 'Renamed' };
    const res = await handlePublish(publishReq({ libraryId, bundle: changed }), d);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe('license_not_active');
  });

  it('caps a free identity at one library and names the existing one', async () => {
    const d = deps();
    const first = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const { libraryId } = await first.json() as { libraryId: string };
    const res = await handlePublish(publishReq({ bundle: { ...BUNDLE, fileName: 'Second' } }, figma()), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'library_limit', limit: 1, owned: 1, existing: { libraryId, fileName: 'Test File' },
    });
  });

  it('counts libraries across both proved identities', async () => {
    const d = deps();
    await seedPro(d);
    await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    for (let i = 0; i < LIBRARY_LIMITS.pro - 1; i += 1) {
      await d.libraryStore.put(`libowner:${licenseId}:lib_${String(i).padStart(24, '0')}`, '1');
    }
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(403);
    expect((await res.json() as { limit: number }).limit).toBe(LIBRARY_LIMITS.pro);
  });

  it('refuses a second create even when the KV listing has not caught up, and says existing is unknown', async () => {
    // KV `list` is eventually consistent: model a listing that never sees the first create.
    class ForgetfulKV extends MemKV {
      async list(_opts: { prefix: string }) { return { keys: [] as Array<{ name: string }> }; }
    }
    const d = deps({ libraryStore: new ForgetfulKV() });
    const first = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    expect(first.status).toBe(201);
    const second = await handlePublish(publishReq({ bundle: { ...BUNDLE, fileName: 'Second' } }, figma()), d);
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ error: 'library_limit', limit: 1, owned: 1, existing: null });
  });

  it('counts a create whose writes outlive its reservation, so the ceiling still holds', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    // The listing never catches up and the meta write takes longer than the
    // reservation lives, so by commit time the create slot has been pruned.
    class SlowForgetfulKV extends MemKV {
      async list(_opts: { prefix: string }) { return { keys: [] as Array<{ name: string }> }; }
      async put(k: string, v: string, opts?: { expirationTtl?: number }) {
        if (k.endsWith(':meta')) t += RESERVATION_TTL_MS + 1;
        await super.put(k, v, opts);
      }
    }
    const d = deps({ now: () => t, quotaFor: memQuota(() => t), libraryStore: new SlowForgetfulKV() });
    expect((await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d)).status).toBe(201);
    const second = await handlePublish(publishReq({ bundle: { ...BUNDLE, fileName: 'Second' } }, figma()), d);
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ error: 'library_limit', limit: 1, owned: 1, existing: null });
  });

  it('answers 409 publish_pending while another create by the same identity is still in flight', async () => {
    // Refusing with library_limit here would claim a library that may never
    // exist: the in-flight create can still fail. Pending says what is true.
    const store = new MemKV();
    const d = deps({ libraryStore: store });
    const quota = d.quotaFor(`free:${hashFigmaId('u1', 'salt')}`, 'publish');
    expect((await quota.reserve('free', 'publish:new:lib_000000000000000000000000', { create: { limit: 1, listed: 0 } })).kind).toBe('proceed');
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'publish_pending' });
    expect(res.headers.get('X-Tier')).toBe('free');
    expect(store.map.size).toBe(0);
    await quota.release('publish:new:lib_000000000000000000000000');
    expect((await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d)).status).toBe(201);
  });

  it('answers 409 publish_pending while another writer holds this library, then proceeds once it lets go', async () => {
    const d = deps();
    const { libraryId, headers } = await freeLibrary(d);
    const quota = d.quotaFor(`free:${hashFigmaId('u1', 'salt')}`, 'publish');
    const other = await quota.reserve('free', `publish:${libraryId}:other-writer`, { lock: `publish:${libraryId}` });
    expect(other.kind).toBe('proceed');
    const blocked = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: 'publish_pending' });
    expect(blocked.headers.get('X-Tier')).toBe('free');
    // Nothing was written or versioned while blocked.
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(BUNDLE));
    await quota.release(`publish:${libraryId}:other-writer`);
    const after = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d);
    expect(after.status).toBe(200);
    expect(after.headers.get('X-Library-Version')).toBe('1.1.0');
  });

  it('refuses a changed publish whose reads came before another writer committed, and keeps that writer\'s record', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    const quotas = memQuota(() => t);
    // Parks the next reserve until released, after the handler has read the
    // meta, the log and the bundle and resolved its version.
    let park: { parked: () => void; go: Promise<void> } | null = null;
    const quotaFor: HandlerDeps['quotaFor'] = (id, profile) => {
      const q = quotas(id, profile);
      return {
        ...q,
        reserve: async (tier, cacheKey, opts) => {
          const held = park;
          park = null;
          if (held) { held.parked(); await held.go; }
          return q.reserve(tier, cacheKey, opts);
        },
      };
    };
    const d = deps({ now: () => t, quotaFor });
    const { libraryId, headers } = await freeLibrary(d);
    t += 60_000;
    let go!: () => void;
    const parked = new Promise<void>((resolve) => {
      park = { parked: resolve, go: new Promise<void>((r) => { go = r; }) };
    });
    const b = handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }, headers), d);
    await parked;
    t += 1_000;
    const a = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d);
    expect(a.status).toBe(200);
    expect(a.headers.get('X-Library-Version')).toBe('1.1.0');
    go();
    const blocked = await b;
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: 'publish_pending' });
    const log = JSON.parse(await d.libraryStore.get(versionsKey(libraryId)) as string) as VersionLog;
    expect(log.records.map((r) => r.version)).toEqual(['1.1.0', '1.0.0']);
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(BUNDLE_WITH_CARD));
    // A fresh read of the new head publishes normally.
    const retry = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }, headers), d);
    expect(retry.status).toBe(200);
  });

  it('refuses a publish that read a fresh meta beside a stale version log, and leaves the log alone', async () => {
    // KV caches each key on its own at a colo, so the meta a pull just
    // refreshed can sit beside a log cached before the last publish.
    let t = Date.parse('2026-07-01T00:00:00Z');
    class StaleLogKV extends MemKV {
      staleLog: string | null = null;
      async get(k: string) { return this.staleLog !== null && k.endsWith(':versions') ? this.staleLog : super.get(k); }
    }
    const store = new StaleLogKV();
    const d = deps({ now: () => t, quotaFor: memQuota(() => t), libraryStore: store });
    const { libraryId, headers } = await freeLibrary(d);
    const firstLog = store.map.get(versionsKey(libraryId)) as string;
    t += 10_000;
    expect((await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d)).status).toBe(200);
    const currentLog = store.map.get(versionsKey(libraryId));
    store.staleLog = firstLog;
    t += 25_000;
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }, headers), d);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'publish_pending' });
    expect(store.map.get(versionsKey(libraryId))).toBe(currentLog);
    expect(store.map.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(BUNDLE_WITH_CARD));
  });

  it('proceeds from a log ahead of its meta, left by a writer that stopped before the meta and recorded no head', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    class MetaFailKV extends MemKV {
      failMeta = false;
      async put(k: string, v: string, opts?: { expirationTtl?: number }) {
        if (this.failMeta && k.endsWith(':meta')) { this.failMeta = false; throw new Error('kv unavailable'); }
        await super.put(k, v, opts);
      }
    }
    const store = new MetaFailKV();
    const d = deps({ now: () => t, quotaFor: memQuota(() => t), libraryStore: store });
    const { libraryId, headers, publishedAt } = await freeLibrary(d);
    t += 10_000;
    store.failMeta = true;
    await expect(handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d)).rejects.toThrow('kv unavailable');
    const stopped = JSON.parse(store.map.get(versionsKey(libraryId)) as string) as VersionLog;
    expect(stopped.records.map((r) => r.version)).toEqual(['1.1.0', '1.0.0']);
    expect((JSON.parse(store.map.get(`lib:${libraryId}:meta`) as string) as LibraryMeta).publishedAt).toBe(publishedAt);
    t += 10_000;
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }, headers), d);
    expect(res.status).toBe(200);
    const log = JSON.parse(store.map.get(versionsKey(libraryId)) as string) as VersionLog;
    expect(log.records.map((r) => r.version)).toEqual(['2.0.0', '1.1.0', '1.0.0']);
  });

  it('takes publishedAt past the meta it read when this clock is behind it, so the head never goes backwards', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t) });
    const { libraryId, headers, publishedAt } = await freeLibrary(d);
    // This Worker's clock is five seconds behind the one that wrote the meta.
    t -= 5_000;
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d);
    expect(res.status).toBe(200);
    const expected = new Date(Date.parse(publishedAt) + 1).toISOString();
    expect((await res.json() as { publishedAt: string }).publishedAt).toBe(expected);
    expect((JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`))!) as LibraryMeta).publishedAt).toBe(expected);
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    expect(log.records[0].publishedAt).toBe(expected);
  });

  it('takes publishedAt past a log record ahead of the meta, too', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    class MetaFailKV extends MemKV {
      failMeta = false;
      async put(k: string, v: string, opts?: { expirationTtl?: number }) {
        if (this.failMeta && k.endsWith(':meta')) { this.failMeta = false; throw new Error('kv unavailable'); }
        await super.put(k, v, opts);
      }
    }
    const store = new MetaFailKV();
    const d = deps({ now: () => t, quotaFor: memQuota(() => t), libraryStore: store });
    const { libraryId, headers } = await freeLibrary(d);
    t += 10_000;
    const stoppedAt = t;
    store.failMeta = true;
    await expect(handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d)).rejects.toThrow('kv unavailable');
    t -= 5_000;
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }, headers), d);
    expect(res.status).toBe(200);
    expect((await res.json() as { publishedAt: string }).publishedAt).toBe(new Date(stoppedAt + 1).toISOString());
  });

  it('records the head when an update\'s commit throws after the meta was written, so a stale read is still refused', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    const quotas = memQuota(() => t);
    let failCommit = false;
    const quotaFor: HandlerDeps['quotaFor'] = (id, profile) => {
      const q = quotas(id, profile);
      return {
        ...q,
        commit: async (tier, cacheKey, body, opts) => {
          if (failCommit) { failCommit = false; throw new Error('quota object unavailable'); }
          return q.commit(tier, cacheKey, body, opts);
        },
      };
    };
    class StaleKV extends MemKV {
      stale = new Map<string, string>();
      async get(k: string) { return this.stale.get(k) ?? super.get(k); }
    }
    const store = new StaleKV();
    const d = deps({ now: () => t, quotaFor, libraryStore: store });
    const { libraryId, headers } = await freeLibrary(d);
    const oldMeta = store.map.get(`lib:${libraryId}:meta`) as string;
    const oldLog = store.map.get(versionsKey(libraryId)) as string;
    const oldBundle = store.map.get(`lib:${libraryId}:bundle`) as string;
    t += 10_000;
    failCommit = true;
    await expect(handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d)).rejects.toThrow('quota object unavailable');
    // The write landed in KV even though nothing was committed for it.
    expect((JSON.parse(store.map.get(`lib:${libraryId}:meta`) as string) as LibraryMeta).version).toBe('1.1.0');
    // A colo still serving the library as it was before that write.
    store.stale.set(`lib:${libraryId}:meta`, oldMeta);
    store.stale.set(versionsKey(libraryId), oldLog);
    store.stale.set(`lib:${libraryId}:bundle`, oldBundle);
    t += 20_000;
    const stale = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }, headers), d);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'publish_pending' });
    const log = JSON.parse(store.map.get(versionsKey(libraryId)) as string) as VersionLog;
    expect(log.records.map((r) => r.version)).toEqual(['1.1.0', '1.0.0']);
    // The lock itself was freed: a fresh read publishes at once.
    store.stale.clear();
    const fresh = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }, headers), d);
    expect(fresh.status).toBe(200);
  });

  it('a create records its head, like an update', async () => {
    const d = deps();
    const { libraryId, publishedAt } = await freeLibrary(d);
    const quota = d.quotaFor(`free:${hashFigmaId('u1', 'salt')}`, 'publish');
    const lock = `publish:${libraryId}`;
    expect(await quota.reserve('free', `${lock}:older`, { lock, base: Date.parse(publishedAt) - 1 })).toEqual({ kind: 'pending' });
    expect((await quota.reserve('free', `${lock}:current`, { lock, base: Date.parse(publishedAt) })).kind).toBe('proceed');
  });

  it('a dry run and an unchanged republish take no lock', async () => {
    const d = deps();
    const { libraryId, headers } = await freeLibrary(d);
    const quota = d.quotaFor(`free:${hashFigmaId('u1', 'salt')}`, 'publish');
    await quota.reserve('free', `publish:${libraryId}:other-writer`, { lock: `publish:${libraryId}` });
    expect((await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD, dryRun: true }, headers), d)).status).toBe(200);
    expect((await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, headers), d)).status).toBe(200);
  });

  it('a write that fails frees its own lock, so the same publish can be retried at once', async () => {
    class FailingKV extends MemKV {
      failNext = false;
      async put(k: string, v: string, opts?: { expirationTtl?: number }) {
        if (this.failNext) { this.failNext = false; throw new Error('kv unavailable'); }
        await super.put(k, v, opts);
      }
    }
    const store = new FailingKV();
    const d = deps({ libraryStore: store });
    const { libraryId, headers } = await freeLibrary(d);
    store.failNext = true;
    await expect(handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d)).rejects.toThrow('kv unavailable');
    const retry = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }, headers), d);
    expect(retry.status).toBe(200);
    expect(retry.headers.get('X-Library-Version')).toBe('1.1.0');
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

    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, bearer(OTHER_UUID_KEY)), d);
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

  it('lets the creating Figma identity update a Pro-created library once the license key is gone, if it still holds the pull key', async () => {
    const d = deps();
    await seedPro(d);
    const first = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    const { libraryId, pullKey } = await first.json() as { libraryId: string; pullKey: string };

    // No bearer at all: the license key was removed from the plugin (or this
    // is a device that never had it), exactly the "Remove license" trap.
    const changed = { ...BUNDLE, fileName: 'Renamed' };
    const res = await handlePublish(publishReq({ libraryId, bundle: changed }, { ...figma(), ...pull(pullKey) }), d);
    expect(res.status).toBe(200);
  });

  it('refuses that same recovery without the pull key, even with the right Figma id', async () => {
    const d = deps();
    await seedPro(d);
    const first = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    const { libraryId } = await first.json() as { libraryId: string };

    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, figma()), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_owner' });
  });

  it('refuses that recovery for a Pro library published with no Figma identity to fall back on', async () => {
    const d = deps();
    await seedPro(d);
    const first = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    const { libraryId, pullKey } = await first.json() as { libraryId: string; pullKey: string };

    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, { ...figma(), ...pull(pullKey) }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_owner' });
  });

  it('backfills the Figma fallback onto a library that predates it, the next time its real owner publishes', async () => {
    const d = deps();
    await seedPro(d);
    // Simulate a library created before figmaOwnerHash existed: no bearer's
    // Figma header on the create, so meta starts with the field unset.
    const first = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    const { libraryId } = await first.json() as { libraryId: string };
    const beforeMeta = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`))!) as LibraryMeta;
    expect(beforeMeta.figmaOwnerHash).toBeUndefined();

    // The owner publishes again while they still hold the key, this time
    // with a Figma identity on the request.
    const changed = { ...BUNDLE, fileName: 'Renamed' };
    await handlePublish(publishReq({ libraryId, bundle: changed }, { ...bearer(), ...figma() }), d);
    const afterMeta = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`))!) as LibraryMeta;
    expect(afterMeta.figmaOwnerHash).toBe(`free:${hashFigmaId('u1', 'salt')}`);
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
    // No Content-Length: `size` is the byte count where the read was cut, past the cap and never past the body.
    expect(body.size).toBeGreaterThan(MAX_BUNDLE_BYTES);
    expect(body.size).toBeLessThanOrEqual(byteLength(JSON.stringify({ bundle: bigBundle })));
    expect(body.limit).toBe(MAX_BUNDLE_BYTES);
  });

  it('measures multi-byte text in bytes on both the header check and the body check', async () => {
    // 1.8M three-byte characters: under the cap in UTF-16 code units, over it in bytes.
    const bundle = { ...BUNDLE, components: [{ ...BUNDLE.components[0], ai: '漢'.repeat(1_800_000) }] };
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
    const size2 = ((await res2.json()) as { size: number }).size;
    expect(size2).toBeGreaterThan(MAX_BUNDLE_BYTES);
    expect(size2).toBeLessThanOrEqual(byteLength(payload));
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
    for (let i = 0; i < LIBRARY_LIMITS.pro; i += 1) {
      await d.libraryStore.put(`libowner:${licenseId}:lib_${String(i).padStart(24, '0')}`, '1');
    }

    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'library_limit', limit: LIBRARY_LIMITS.pro, owned: LIBRARY_LIMITS.pro });
  });

  it('migrates a legacy owner array to per-library keys and counts both', async () => {
    const d = deps();
    await seedPro(d);
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    const legacy = Array.from({ length: LIBRARY_LIMITS.pro - 1 }, (_, i) => `lib_${String(i).padStart(24, '0')}`);
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

  it('counts a free publish and returns quota headers', async () => {
    const d = deps();
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    expect(res.headers.get('X-Tier')).toBe('free');
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(res.headers.get('X-Quota-Limit')).toBe('10');
    expect(res.headers.get('X-Quota-Remaining')).toBe('9');
    expect(res.headers.get('X-Quota-Resets-At')).toBe('2026-08-01T00:00:00.000Z');
  });

  it('answers a successful publish from the snapshot commit returns: no separate snapshot hop', async () => {
    const d = deps();
    const inner = d.quotaFor;
    let snapshots = 0;
    d.quotaFor = (id, profile) => {
      const client = inner(id, profile);
      return { ...client, snapshot: (tier) => { snapshots += 1; return client.snapshot(tier); } };
    };
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(snapshots).toBe(0);
  });

  it('replays an unchanged republish without counting or writing', async () => {
    const d = deps();
    const { libraryId, publishedAt, headers } = await freeLibrary(d);
    const puts = d.libraryStore.map.size;
    // What a second click of Publish actually sends: the same sources rebuilt,
    // so only the export envelope's timestamps moved. The bytes differ; the
    // content does not.
    const rebuilt = bundleAt('2026-07-01T00:05:00.000Z');
    expect(JSON.stringify(rebuilt)).not.toBe(JSON.stringify(BUNDLE));
    const res = await handlePublish(publishReq({ libraryId, bundle: rebuilt }, headers), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ libraryId, publishedAt, unchanged: true, version: '1.0.0' });
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(d.libraryStore.map.size).toBe(puts);
    // The first bytes are still the published ones: no write happened.
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(BUNDLE));
  });

  it('writes and counts a revert to an earlier bundle within the response TTL', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t) });
    const a = { ...BUNDLE, fileName: 'A' };
    const b = { ...BUNDLE, fileName: 'B' };
    const { libraryId, headers } = await freeLibrary(d, a);
    t += 60_000;
    expect((await handlePublish(publishReq({ libraryId, bundle: b }, headers), d)).status).toBe(200);
    // Back to A, well inside the 24-hour response cache. Keyed by destination
    // alone this would replay A's first reservation and answer `unchanged`
    // while KV still held B; keyed by the stored state it is a new reservation.
    t += 60_000;
    const res = await handlePublish(publishReq({ libraryId, bundle: a }, headers), d);
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('unchanged');
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(a));
    expect(res.headers.get('X-Quota-Used')).toBe('3');
    // And forward to B again: the same content transition as the second
    // publish, which a transition-keyed cache would replay as `unchanged`
    // while KV still held A.
    t += 60_000;
    const again = await handlePublish(publishReq({ libraryId, bundle: b }, headers), d);
    expect(again.status).toBe(200);
    expect(await again.json()).not.toHaveProperty('unchanged');
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(b));
    expect(again.headers.get('X-Quota-Used')).toBe('4');
  });

  it('answers a retry of a committed update as unchanged without counting', async () => {
    const d = deps();
    const { libraryId, headers } = await freeLibrary(d);
    const changed = { ...BUNDLE, fileName: 'Renamed' };
    const first = await handlePublish(publishReq({ libraryId, bundle: changed }, headers), d);
    expect(first.status).toBe(200);
    const publishedAt = (await first.json() as { publishedAt: string }).publishedAt;
    const retry = await handlePublish(publishReq({ libraryId, bundle: changed }, headers), d);
    expect(retry.status).toBe(200);
    // The stored hash already matches, so the retry costs nothing: one update spent.
    expect(await retry.json()).toEqual({ libraryId, publishedAt, unchanged: true, version: '1.0.1' });
    expect(retry.headers.get('X-Quota-Used')).toBe('2');
  });

  it('replays a committed create reservation with the assigned version, not just the id and date', async () => {
    // A genuine retry of the exact same create request (network hiccup on the
    // first response, say) reuses the exact same reservation cache key, since
    // that key is `publish:new:<newLibraryId()>`. Force the same id twice by
    // fixing the randomness `newLibraryId`/`newPullKey` draw on, so the second
    // call is a true replay of the first commit rather than a second create.
    const fixed = new Uint8Array(24).fill(7);
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((buf: Uint8Array) => {
      buf.set(fixed.subarray(0, buf.length));
      return buf;
    }) as typeof crypto.getRandomValues);
    try {
      const d = deps();
      await seedPro(d);
      const first = await handlePublish(publishReq({ bundle: BUNDLE }), d);
      expect(first.status).toBe(201);
      const firstBody = await first.json() as { libraryId: string; publishedAt: string; version: string };
      expect(firstBody.version).toBe('1.0.0');

      const replay = await handlePublish(publishReq({ bundle: BUNDLE }), d);
      // The cached reservation short-circuits before any write: a 200, not a
      // second 201, and it carries the version the first call was assigned.
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({
        libraryId: firstBody.libraryId, publishedAt: firstBody.publishedAt, unchanged: true, version: '1.0.0',
      });
      expect(replay.headers.get('X-Library-Version')).toBe('1.0.0');
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses the eleventh changed publish in a month with 402', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t) });
    const { libraryId, headers } = await freeLibrary(d);
    for (let i = 1; i < 10; i += 1) {
      t += 60_000;
      const res = await handlePublish(publishReq({ libraryId, bundle: { ...BUNDLE, fileName: `v${i}` } }, headers), d);
      expect(res.status).toBe(200);
    }
    t += 60_000;
    const res = await handlePublish(publishReq({ libraryId, bundle: { ...BUNDLE, fileName: 'v10' } }, headers), d);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00.000Z' });
    expect(res.headers.get('X-Tier')).toBe('free');
    expect(res.headers.get('X-Quota-Remaining')).toBe('0');
  });

  it('creates two distinct libraries from identical bundles', async () => {
    const d = deps();
    await seedPro(d);
    const first = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    const second = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = await first.json() as { libraryId: string; pullKey: string };
    const b = await second.json() as { libraryId: string; pullKey: string };
    expect(a.libraryId).not.toBe(b.libraryId);
    expect(b.pullKey).toMatch(PULL_KEY_RE);
    expect(await d.libraryStore.get(`lib:${b.libraryId}:bundle`)).toBe(JSON.stringify(BUNDLE));
  });

  it('never blocks a Pro publish and flags fair use past the soft threshold', async () => {
    const log = vi.fn();
    const t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t), log });
    await seedPro(d);
    const engine = d.quotaFor(`lic:${sha256(UUID_KEY)}`, 'publish');
    // Seed committed usage directly: reserve() also feeds the engine's shared
    // per-minute rate limiter, and 1000 calls at this frozen clock would trip
    // it before the real publish below ever runs.
    for (let i = 0; i < PRO_SOFT_THRESHOLD; i += 1) {
      await engine.commit('pro', `seed${i}`, '{}');
    }
    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Quota-Limit')).toBe('unlimited');
    expect(log).toHaveBeenCalledWith('fair_use_flag', expect.objectContaining({ tier: 'pro' }));
  });

  it('releases the reservation when the fair-use log throws', async () => {
    let fail = true;
    const log = (event: string) => {
      if (event === 'fair_use_flag' && fail) { fail = false; throw new Error('log sink down'); }
    };
    const t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t), log });
    await seedPro(d);
    const engine = d.quotaFor(`lic:${sha256(UUID_KEY)}`, 'publish');
    for (let i = 0; i < PRO_SOFT_THRESHOLD; i += 1) await engine.commit('pro', `seed${i}`, '{}');
    // Nine listed libraries leave room for one create: a slot the throw kept
    // would turn the next create into 409 publish_pending.
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    for (let i = 0; i < LIBRARY_LIMITS.pro - 1; i += 1) {
      await d.libraryStore.put(`libowner:${licenseId}:lib_${String(i).padStart(24, '0')}`, '1');
    }
    await expect(handlePublish(publishReq({ bundle: BUNDLE }), d)).rejects.toThrow('log sink down');
    expect((await handlePublish(publishReq({ bundle: BUNDLE }), d)).status).toBe(201);
  });

  it('does not count a create that fails validation', async () => {
    const d = deps();
    await handlePublish(publishReq({ bundle: { schema: 'nope' } }, figma()), d);
    const snap = await d.quotaFor(`free:${hashFigmaId('u1', 'salt')}`, 'publish').snapshot('free');
    expect(snap.used).toBe(0);
  });
});

describe('publish rate limiting', () => {
  it('throttles malformed bodies per IP before reading them', async () => {
    const d = deps({ requestLimiter: new SlidingWindowLimiter(3, 60_000) });
    const bad = () => new Request('https://proxy.test/v1/libraries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: '{not json',
    });
    expect((await handlePublish(bad(), d)).status).toBe(400);
    expect((await handlePublish(bad(), d)).status).toBe(400);
    expect((await handlePublish(bad(), d)).status).toBe(400);
    const fourth = await handlePublish(bad(), d);
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'rate_limited' });
  });

  it('a well-formed publish spends the request token and the publish token, a dry run only the request token', async () => {
    const d = deps({ requestLimiter: new SlidingWindowLimiter(60, 60_000), licenseLimiter: new SlidingWindowLimiter(1, 60_000) });
    await seedPro(d);
    const first = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(first.status).toBe(201);
    const { libraryId } = await first.json() as { libraryId: string };
    // The publish budget is spent; a dry run must still be answered.
    const dry = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD, dryRun: true }), d);
    expect(dry.status).toBe(200);
    const second = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }), d);
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

  it('streams the bundle from the store rather than reading it as a string', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    const stringReads: string[] = [];
    const store = d.libraryStore as MemKV;
    const original = store.get.bind(store);
    store.get = async (k: string) => { stringReads.push(k); return original(k); };
    const res = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(BUNDLE));
    expect(stringReads).not.toContain(`lib:${libraryId}:bundle`);
  });

  it('matches a weak or listed If-None-Match and tells caches not to store the body', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    const etag = `"${sha256(JSON.stringify(BUNDLE))}"`;
    const weak = await handlePull(pullReq(libraryId, pullKey, `W/${etag}`), d, libraryId);
    expect(weak.status).toBe(304);
    const listed = await handlePull(pullReq(libraryId, pullKey, `"other", ${etag}`), d, libraryId);
    expect(listed.status).toBe(304);
    expect(listed.headers.get('Cache-Control')).toBe('private, no-store');
    const full = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(full.headers.get('Cache-Control')).toBe('private, no-store');
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

  it('tells caches not to store its error answers either', async () => {
    const d = deps({ requestLimiter: new SlidingWindowLimiter(3, 60_000) });
    const { libraryId } = await publishedLibrary(d);
    const unknown = 'lib_' + '0'.repeat(24);
    const notFound = await handlePull(pullReq(unknown, newPullKey()), d, unknown);
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get('Cache-Control')).toBe('private, no-store');
    const badKey = await handlePull(pullReq(libraryId, 'nope'), d, libraryId);
    expect(badKey.status).toBe(401);
    expect(badKey.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await handlePull(pullReq(libraryId, newPullKey()), d, libraryId)).status).toBe(401);
    const limited = await handlePull(pullReq(libraryId, newPullKey()), d, libraryId);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
  });

  it('answers 404, not an empty 200, when the meta exists but the bundle is gone', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    (d.libraryStore as MemKV).map.delete(`lib:${libraryId}:bundle`);
    const res = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
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
    const publishRes = await handlePublish(publishReq({ bundle: BUNDLE }, bearer(UUID_KEY)), d);
    const { libraryId } = await publishRes.json() as { libraryId: string };

    const res = await handleRotate(rotateReq(libraryId, bearer(OTHER_UUID_KEY)), d, libraryId);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_owner' });
  });

  it('rotates for a lapsed license that owns the library', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    await seedFree(d);
    const res = await handleRotate(rotateReq(libraryId), d, libraryId);
    expect(res.status).toBe(200);
    expect((await res.json() as { pullKey: string }).pullKey).toMatch(PULL_KEY_RE);
  });

  it('lets the creating Figma identity rotate a Pro-created library with no license key at all, using the old pull key', async () => {
    const d = deps();
    await seedPro(d);
    const created = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    const { libraryId, pullKey } = await created.json() as { libraryId: string; pullKey: string };

    const res = await handleRotate(rotateReq(libraryId, { ...figma(), ...pull(pullKey) }), d, libraryId);
    expect(res.status).toBe(200);
    const { pullKey: rotated } = await res.json() as { pullKey: string };
    expect(rotated).toMatch(PULL_KEY_RE);
    expect(rotated).not.toBe(pullKey);
  });

  it('rotates for a free owner holding the key and refuses a stranger', async () => {
    const d = deps();
    const { libraryId, headers, pullKey } = await freeLibrary(d);
    const rotated = await handleRotate(rotateReq(libraryId, headers), d, libraryId);
    expect(rotated.status).toBe(200);
    const { pullKey: next } = await rotated.json() as { pullKey: string };
    // The old key no longer proves anything; the new one does.
    const stale = await handleRotate(rotateReq(libraryId, { ...figma('u1'), ...pull(pullKey) }), d, libraryId);
    expect(stale.status).toBe(403);
    expect((await handleRotate(rotateReq(libraryId, { ...figma('u1'), ...pull(next) }), d, libraryId)).status).toBe(200);
    const stranger = await handleRotate(rotateReq(libraryId, figma('u2')), d, libraryId);
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: 'not_owner' });
  });

  it('refuses a free-plan write that carries the owner\'s Figma id but not the key', async () => {
    // The Figma user id is not a secret: anyone who has seen it can send it.
    const d = deps();
    const { libraryId, pullKey } = await freeLibrary(d);
    const spoofedRotate = await handleRotate(rotateReq(libraryId, figma('u1')), d, libraryId);
    expect(spoofedRotate.status).toBe(403);
    expect(await spoofedRotate.json()).toEqual({ error: 'not_owner' });
    const spoofedUpdate = await handlePublish(publishReq({ libraryId, bundle: { ...BUNDLE, fileName: 'Taken' } }, figma('u1')), d);
    expect(spoofedUpdate.status).toBe(403);
    expect(await spoofedUpdate.json()).toEqual({ error: 'not_owner' });
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(BUNDLE));
    // The key alone is not enough either: the Figma identity must own the library.
    const keyOnly = await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, { ...figma('u2'), ...pull(pullKey) }), d);
    expect(keyOnly.status).toBe(403);
    // A wrong key with the right identity is refused too.
    const wrongKey = await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, { ...figma('u1'), ...pull(newPullKey()) }), d);
    expect(wrongKey.status).toBe(403);
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

describe('library versions', () => {
  it('a first publish is version 1.0.0 with bump initial, and writes the log and the version bundle', async () => {
    const d = deps();
    await seedPro(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(201);
    const body = await res.json() as { libraryId: string; version: string; bump: string; minimumBump: string | null };
    expect(body.version).toBe('1.0.0');
    expect(body.bump).toBe('initial');
    expect(body.minimumBump).toBeNull();
    expect(res.headers.get('X-Library-Version')).toBe('1.0.0');

    const log = JSON.parse((await d.libraryStore.get(versionsKey(body.libraryId)))!) as VersionLog;
    expect(log.v).toBe(1);
    expect(log.records).toHaveLength(1);
    expect(log.records[0]).toMatchObject({ version: '1.0.0', bump: 'initial', minimumBump: null, note: null, changes: [], changesTruncated: false, extractorVersion: '2', pluginVersion: '5.0.0' });
    expect(await d.libraryStore.get(versionBundleKey(body.libraryId, '1.0.0'))).toBe(JSON.stringify(BUNDLE));
    const meta = JSON.parse((await d.libraryStore.get(`lib:${body.libraryId}:meta`))!) as LibraryMeta;
    expect(meta.version).toBe('1.0.0');
  });

  it('honours a valid initialVersion on the first publish and refuses an invalid one', async () => {
    const d = deps();
    await seedPro(d);
    const bad = await handlePublish(publishReq({ bundle: BUNDLE, initialVersion: '2.0' }), d);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_initial_version' });

    const good = await handlePublish(publishReq({ bundle: BUNDLE, initialVersion: '2.1.0' }), d);
    expect(good.status).toBe(201);
    expect(((await good.json()) as { version: string }).version).toBe('2.1.0');
  });

  it('a second publish computes the minimum bump from the stored bundle and applies it', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ libraryId, version: '1.1.0', bump: 'minor', minimumBump: 'minor' });
    expect(res.headers.get('X-Library-Version')).toBe('1.1.0');
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    expect(log.records.map((r) => r.version)).toEqual(['1.1.0', '1.0.0']);
    expect(log.records[0].changes).toEqual([expect.objectContaining({ entity: 'component', kind: 'added', component: 'Card' })]);
    expect(log.records[0].counts).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it('a content change with no property changes is a patch', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_DESCRIBED }), d);
    expect(await res.json()).toMatchObject({ version: '1.0.1', bump: 'patch', minimumBump: 'patch' });
  });

  it('lets the publisher raise the bump with a note, and refuses to lower it', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const low = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD, bump: 'patch' }), d);
    expect(low.status).toBe(400);
    expect(await low.json()).toEqual({ error: 'bump_below_minimum', minimumBump: 'minor', proposedVersion: '1.1.0' });
    expect(await d.libraryStore.get(versionBundleKey(libraryId, '1.0.1'))).toBeNull();

    const high = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD, bump: 'major', note: 'Card is new API.' }), d);
    expect(await high.json()).toMatchObject({ version: '2.0.0', bump: 'major', minimumBump: 'minor' });
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    expect(log.records[0].note).toBe('Card is new API.');
  });

  it('refuses an invalid bump word and an over-long note without writing', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const badBump = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD, bump: 'huge' }), d);
    expect(badBump.status).toBe(400);
    expect(await badBump.json()).toEqual({ error: 'invalid_bump' });
    const badNote = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD, note: 'x'.repeat(501) }), d);
    expect(badNote.status).toBe(400);
    expect(await badNote.json()).toEqual({ error: 'invalid_note' });
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    expect(log.records).toHaveLength(1);
  });

  it('an unchanged republish assigns no version and keeps the log as it was', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const res = await handlePublish(publishReq({ libraryId, bundle: bundleAt('2026-07-02T00:00:00.000Z') }), d);
    expect(await res.json()).toMatchObject({ libraryId, unchanged: true });
    expect(res.headers.get('X-Library-Version')).toBe('1.0.0');
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    expect(log.records).toHaveLength(1);
  });

  it('a removed component is a major bump', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_EMPTY }), d);
    expect(await res.json()).toMatchObject({ version: '2.0.0', bump: 'major', minimumBump: 'major' });
  });

  it('a library published before versioning reads its first versioned publish as initial', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    // Imitate a pre-versioning library: no log, no version on meta.
    await d.libraryStore.delete(versionsKey(libraryId));
    const metaRaw = (await d.libraryStore.get(`lib:${libraryId}:meta`))!;
    const meta = JSON.parse(metaRaw) as LibraryMeta;
    delete meta.version;
    await d.libraryStore.put(`lib:${libraryId}:meta`, JSON.stringify(meta));

    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }), d);
    expect(await res.json()).toMatchObject({ version: '1.0.0', bump: 'initial', minimumBump: null });
  });

  it('reads the current version from the log, not the meta', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    // A failure between the log write and the meta write leaves the meta behind.
    const metaRaw = (await d.libraryStore.get(`lib:${libraryId}:meta`))!;
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    log.records.unshift({ ...log.records[0], version: '1.3.0', contentHash: 'stale' });
    await d.libraryStore.put(versionsKey(libraryId), JSON.stringify(log));
    await d.libraryStore.put(`lib:${libraryId}:meta`, metaRaw);

    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }), d);
    expect(await res.json()).toMatchObject({ version: '1.4.0' });
  });

  it('writes bundles, then the log, then the meta', async () => {
    const order: string[] = [];
    const recording = new MemKV();
    const put = recording.put.bind(recording);
    recording.put = async (k: string, v: string) => { order.push(k); await put(k, v); };
    const d = deps({ libraryStore: recording });
    await seedPro(d);
    const created = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    const { libraryId } = await created.json() as { libraryId: string };
    order.length = 0;
    await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }), d);
    const relevant = order.filter((k) => k.startsWith(`lib:${libraryId}:`));
    expect(relevant).toEqual([
      `lib:${libraryId}:bundle`,
      versionBundleKey(libraryId, '1.1.0'),
      versionsKey(libraryId),
      `lib:${libraryId}:meta`,
    ]);
  });

  it('keeps the last ten per-version bundles and deletes the eleventh', async () => {
    // The quota engine's reservation rate limiter caps attempts at 10/min
    // regardless of tier, so the clock must advance between publishes the
    // way the other multi-publish tests in this file already do.
    let t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t) });
    const { libraryId } = await publishedLibrary(d);
    for (let i = 1; i <= 10; i += 1) {
      t += 60_000;
      const res = await handlePublish(publishReq({ libraryId, bundle: { ...BUNDLE, fileName: `File ${i}` } }), d);
      expect(res.status).toBe(200);
    }
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    expect(log.records).toHaveLength(11);
    expect(log.records[0].version).toBe('1.0.10');
    expect(await d.libraryStore.get(versionBundleKey(libraryId, '1.0.0'))).toBeNull();
    expect(await d.libraryStore.get(versionBundleKey(libraryId, '1.0.1'))).not.toBeNull();
    expect(await d.libraryStore.get(versionBundleKey(libraryId, '1.0.10'))).not.toBeNull();
  });

  it('pull carries X-Library-Version, and omits it for a library without one', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    const res = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(res.headers.get('X-Library-Version')).toBe('1.0.0');

    const metaRaw = (await d.libraryStore.get(`lib:${libraryId}:meta`))!;
    const meta = JSON.parse(metaRaw) as LibraryMeta;
    delete meta.version;
    await d.libraryStore.put(`lib:${libraryId}:meta`, JSON.stringify(meta));
    const legacy = await handlePull(pullReq(libraryId, pullKey), d, libraryId);
    expect(legacy.headers.get('X-Library-Version')).toBeNull();
  });
});

describe('dry run', () => {
  it('describes the proposal for an existing library without writing or spending quota', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const before = await d.libraryStore.get(`lib:${libraryId}:meta`);
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD, dryRun: true }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      currentVersion: '1.0.0', unchanged: false, minimumBump: 'minor', proposedVersion: '1.1.0',
      counts: { major: 0, minor: 1, patch: 0 },
      changes: [expect.objectContaining({ entity: 'component', kind: 'added', component: 'Card', bump: 'minor' })],
      changesTruncated: false,
    });
    expect(await d.libraryStore.get(`lib:${libraryId}:meta`)).toBe(before);
    expect(await d.libraryStore.get(`lib:${libraryId}:bundle`)).toBe(JSON.stringify(BUNDLE));
    const log = JSON.parse((await d.libraryStore.get(versionsKey(libraryId)))!) as VersionLog;
    expect(log.records).toHaveLength(1);
  });

  it('reports unchanged content with null bump fields', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    const res = await handlePublish(publishReq({ libraryId, bundle: bundleAt('2026-07-02T00:00:00.000Z'), dryRun: true }), d);
    expect(await res.json()).toEqual({
      currentVersion: '1.0.0', unchanged: true, minimumBump: null, proposedVersion: null,
      counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
    });
  });

  it('describes a first publish when there is no library yet', async () => {
    const d = deps();
    await seedPro(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE, dryRun: true }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      currentVersion: null, unchanged: false, minimumBump: null, proposedVersion: '1.0.0',
      counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
    });
    expect((await d.libraryStore.list({ prefix: 'lib:' })).keys).toEqual([]);
  });

  it('previews and validates initialVersion on a first-publish dry run exactly as the publish would', async () => {
    const d = deps();
    await seedPro(d);
    const good = await handlePublish(publishReq({ bundle: BUNDLE, initialVersion: '2.1.0', dryRun: true }), d);
    expect(good.status).toBe(200);
    expect(((await good.json()) as { proposedVersion: string }).proposedVersion).toBe('2.1.0');
    expect((await d.libraryStore.list({ prefix: 'lib:' })).keys).toEqual([]);

    const bad = await handlePublish(publishReq({ bundle: BUNDLE, initialVersion: '2.0', dryRun: true }), d);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_initial_version' });
  });

  it('authenticates and authorises like a publish', async () => {
    const d = deps();
    const anonymous = await handlePublish(publishReq({ bundle: BUNDLE, dryRun: true }, {}), d);
    expect(anonymous.status).toBe(401);
    const { deps: d2, libraryId } = await publishedLibrary();
    // A lapsed or unrecognised bearer would 401 before reaching ownership
    // (the same gate a real publish hits), so the stranger needs an active
    // license of their own to prove the ownership check itself is reached.
    await seedPro(d2, OTHER_UUID_KEY);
    const stranger = await handlePublish(publishReq({ libraryId, bundle: BUNDLE, dryRun: true }, bearer(OTHER_UUID_KEY)), d2);
    expect(stranger.status).toBe(403);
  });

  it('a dry run does not count against the publish quota', async () => {
    const d = deps();
    const lib = await freeLibrary(d);
    for (let i = 0; i < 5; i += 1) {
      await handlePublish(publishReq({ libraryId: lib.libraryId, bundle: BUNDLE_WITH_CARD, dryRun: true }, lib.headers), d);
    }
    const res = await handlePublish(publishReq({ libraryId: lib.libraryId, bundle: BUNDLE_WITH_CARD }, lib.headers), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Used')).toBe('2');
  });

  /**
   * A dry run happens every time the Publish screen opens, not just when the
   * publisher commits, so it must not spend the 20/min publish rate limit: 25
   * dry runs in a minute would otherwise leave no room for the real publish
   * that follows. The default deps() licenseLimiter is 20/min; a dry run now
   * spends the separate 60/min requestLimiter instead (see `libdry:` in
   * handlePublish).
   */
  it('does not share the publish rate limiter, so many dry runs never block the publish that follows', async () => {
    const d = deps();
    await seedPro(d);
    const req = (dryRun: boolean) => {
      const r = publishReq({ bundle: BUNDLE, dryRun });
      r.headers.set('CF-Connecting-IP', '9.9.9.9');
      return r;
    };
    for (let i = 0; i < 25; i += 1) {
      const res = await handlePublish(req(true), d);
      expect(res.status).toBe(200);
    }
    const published = await handlePublish(req(false), d);
    expect(published.status).toBe(201);
  });
});

describe('ifNoneMatchMatches', () => {
  it('handles exact, weak, listed and star tags, and nothing else', () => {
    expect(ifNoneMatchMatches('"a"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('W/"a"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('"b", W/"a"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('*', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('"b"', '"a"')).toBe(false);
    expect(ifNoneMatchMatches('a', '"a"')).toBe(false); // unquoted is not a tag
    expect(ifNoneMatchMatches(null, '"a"')).toBe(false);
  });
});

describe('GET /v1/libraries/:id/versions', () => {
  it('returns the log to a pull-key holder with an ETag, and 304 on a match', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    await handlePublish(publishReq({ libraryId, bundle: BUNDLE_WITH_CARD }), d);
    const res = await handleVersions(versionsReq(libraryId, pullKey), d, libraryId);
    expect(res.status).toBe(200);
    const stored = (await d.libraryStore.get(versionsKey(libraryId)))!;
    expect(res.headers.get('ETag')).toBe(`"${sha256(stored)}"`);
    const log = await res.json() as VersionLog;
    expect(log.records.map((r) => r.version)).toEqual(['1.1.0', '1.0.0']);

    const again = await handleVersions(versionsReq(libraryId, pullKey, res.headers.get('ETag')!), d, libraryId);
    expect(again.status).toBe(304);
    expect(again.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const weak = await handleVersions(versionsReq(libraryId, pullKey, `W/${res.headers.get('ETag')!}`), d, libraryId);
    expect(weak.status).toBe(304);
  });

  it('returns an empty log for a library that predates versioning', async () => {
    const { deps: d, libraryId, pullKey } = await publishedLibrary();
    await d.libraryStore.delete(versionsKey(libraryId));
    const res = await handleVersions(versionsReq(libraryId, pullKey), d, libraryId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: 1, records: [] });
  });

  it('rejects a bad key and an unknown library the way pull does', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    expect((await handleVersions(versionsReq(libraryId, newPullKey()), d, libraryId)).status).toBe(401);
    expect((await handleVersions(versionsReq(libraryId, 'nope'), d, libraryId)).status).toBe(401);
    expect((await handleVersions(versionsReq('lib_000000000000000000000000', newPullKey()), d, 'lib_000000000000000000000000')).status).toBe(404);
  });

  it('tells caches not to store its error answers either', async () => {
    const d = deps({ requestLimiter: new SlidingWindowLimiter(2, 60_000) });
    const { libraryId } = await publishedLibrary(d);
    const unknown = 'lib_' + '0'.repeat(24);
    const notFound = await handleVersions(versionsReq(unknown, newPullKey()), d, unknown);
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get('Cache-Control')).toBe('private, no-store');
    const badKey = await handleVersions(versionsReq(libraryId, 'nope'), d, libraryId);
    expect(badKey.status).toBe(401);
    expect(badKey.headers.get('Cache-Control')).toBe('private, no-store');
    const limited = await handleVersions(versionsReq(libraryId, newPullKey()), d, libraryId);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
