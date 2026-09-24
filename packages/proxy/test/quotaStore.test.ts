import { describe, it, expect } from 'vitest';
import { QuotaStore, ENGINE_KEY, responseKey, type DoStorageLike } from '../src/quotaStore';
import { QUOTA_PROFILES, MAX_RETAINED_RESPONSES, RESPONSE_TTL_MS } from '../src/quota';

const T0 = Date.parse('2026-07-01T00:00:00Z');

class MemDoStorage implements DoStorageLike {
  map = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> { return this.map.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.map.set(key, value); }
  async delete(key: string): Promise<boolean> { return this.map.delete(key); }
}

const engineRecord = (storage: MemDoStorage) => JSON.parse(storage.map.get(ENGINE_KEY) as string) as { responses: Record<string, unknown> };

describe('QuotaStore', () => {
  it('keeps the body under its own key and the engine record body-free', async () => {
    const storage = new MemDoStorage();
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    expect((await store.reserve('free', 'k1', T0)).kind).toBe('proceed');
    const snap = await store.commit('free', 'k1', '{"id":"msg_1"}', T0);
    expect(snap.used).toBe(1);
    expect(storage.map.get(responseKey('k1'))).toBe('{"id":"msg_1"}');
    expect(storage.map.get(ENGINE_KEY)).not.toContain('msg_1');
    expect(engineRecord(storage).responses).toEqual({ k1: { at: T0 } });
  });

  it('replays the cached body on a retry and does not count it again', async () => {
    const storage = new MemDoStorage();
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    await store.reserve('free', 'k1', T0);
    await store.commit('free', 'k1', '{"id":"msg_1"}', T0);
    expect(await store.reserve('free', 'k1', T0 + 60_000)).toEqual({ kind: 'cached', body: '{"id":"msg_1"}' });
    expect((await store.snapshot('free', T0 + 60_000)).used).toBe(1);
  });

  it('migrates a pre-split engine blob once: bodies move to their keys, expired ones are dropped', async () => {
    const storage = new MemDoStorage();
    storage.map.set(ENGINE_KEY, JSON.stringify({
      firstSeen: T0 - 2 * RESPONSE_TTL_MS, boostUsed: 2, months: {}, reservations: {}, recent: [],
      responses: {
        fresh: { body: '{"id":"fresh"}', at: T0 - 1000 },
        stale: { body: '{"id":"stale"}', at: T0 - RESPONSE_TTL_MS - 1 },
      },
    }));
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    // A read is enough to migrate, and the counter survives it: still in the
    // boost window, so `used` is the stored boostUsed.
    expect((await store.snapshot('free', T0)).used).toBe(2);
    expect(storage.map.get(responseKey('fresh'))).toBe('{"id":"fresh"}');
    expect(storage.map.has(responseKey('stale'))).toBe(false);
    expect(storage.map.get(ENGINE_KEY)).not.toContain('"body"');
    expect(await store.reserve('free', 'fresh', T0)).toEqual({ kind: 'cached', body: '{"id":"fresh"}' });
  });

  it('migration keeps every counter and reservation, and running it again writes nothing', async () => {
    const month = new Date(T0).toISOString().slice(0, 7);
    const legacy = {
      firstSeen: T0 - 1000, boostUsed: 7, months: { [month]: 7 },
      reservations: { live: T0 - 500 }, recent: [T0 - 400, T0 - 300],
      responses: { a: { body: '{"id":"a"}', at: T0 - 2000 }, b: { body: '{"id":"b"}', at: T0 - 1500 } },
    };
    const storage = new MemDoStorage();
    storage.map.set(ENGINE_KEY, JSON.stringify(legacy));
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    await store.snapshot('free', T0);
    const migrated = JSON.parse(storage.map.get(ENGINE_KEY) as string) as Record<string, unknown>;
    expect(migrated).toEqual({
      ...legacy,
      responses: { a: { at: T0 - 2000 }, b: { at: T0 - 1500 } },
    });

    // A second read of the migrated record performs no write at all.
    const writes: string[] = [];
    const watched: DoStorageLike = {
      get: (key) => storage.get(key),
      put: async (key, value) => { writes.push(key); await storage.put(key, value); },
      delete: async (key) => { writes.push(`delete ${key}`); return storage.delete(key); },
    };
    expect((await new QuotaStore(watched, QUOTA_PROFILES.ai).snapshot('free', T0)).used).toBe(7);
    expect(writes).toEqual([]);
    expect(storage.map.get(responseKey('a'))).toBe('{"id":"a"}');
    expect(storage.map.get(responseKey('b'))).toBe('{"id":"b"}');
  });

  it('a migration cut off before the engine write leaves the legacy record intact and completes on the next read', async () => {
    const legacy = {
      firstSeen: T0 - 1000, boostUsed: 3, months: {}, reservations: {}, recent: [],
      responses: { a: { body: '{"id":"a"}', at: T0 - 2000 }, b: { body: '{"id":"b"}', at: T0 - 1500 } },
    };
    const storage = new MemDoStorage();
    storage.map.set(ENGINE_KEY, JSON.stringify(legacy));
    // The object dies after the first body write: every later write fails.
    let puts = 0;
    const dying: DoStorageLike = {
      get: (key) => storage.get(key),
      put: async (key, value) => {
        puts += 1;
        if (puts > 1) throw new Error('killed');
        await storage.put(key, value);
      },
      delete: (key) => storage.delete(key),
    };
    await expect(new QuotaStore(dying, QUOTA_PROFILES.ai).snapshot('free', T0)).rejects.toThrow('killed');
    expect(storage.map.get(ENGINE_KEY)).toBe(JSON.stringify(legacy)); // counters untouched

    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    expect((await store.snapshot('free', T0)).used).toBe(3); // not lost, not doubled
    expect(storage.map.get(ENGINE_KEY)).not.toContain('"body"');
    expect(await store.reserve('free', 'a', T0)).toEqual({ kind: 'cached', body: '{"id":"a"}' });
    expect(await store.reserve('free', 'b', T0)).toEqual({ kind: 'cached', body: '{"id":"b"}' });
    expect((await store.snapshot('free', T0)).used).toBe(3);
  });

  it('reserves afresh when the index remembers a body that is gone, instead of answering with nothing', async () => {
    const storage = new MemDoStorage();
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    await store.reserve('pro', 'k1', T0);
    await store.commit('pro', 'k1', '{}', T0);
    storage.map.delete(responseKey('k1'));
    expect((await store.reserve('pro', 'k1', T0 + 1000)).kind).toBe('proceed');
    expect(engineRecord(storage).responses).toEqual({});
  });

  it('deletes the body when its index entry expires', async () => {
    const storage = new MemDoStorage();
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    await store.reserve('pro', 'old', T0);
    await store.commit('pro', 'old', '{"big":"body"}', T0);
    await store.reserve('pro', 'new', T0 + RESPONSE_TTL_MS + 1);
    expect(storage.map.has(responseKey('old'))).toBe(false);
    expect(storage.map.get(ENGINE_KEY)).not.toContain('old');
  });

  it('retains at most MAX_RETAINED_RESPONSES bodies, dropping the oldest', async () => {
    const storage = new MemDoStorage();
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    for (let i = 0; i <= MAX_RETAINED_RESPONSES; i += 1) {
      const t = T0 + i * 60_000; // one a minute, under the per-minute rate limit
      await store.reserve('pro', `k${i}`, t);
      await store.commit('pro', `k${i}`, `{"n":${i}}`, t);
    }
    expect(storage.map.has(responseKey('k0'))).toBe(false);
    expect(storage.map.has(responseKey('k1'))).toBe(true);
    expect(storage.map.has(responseKey(`k${MAX_RETAINED_RESPONSES}`))).toBe(true);
    expect(Object.keys(engineRecord(storage).responses)).toHaveLength(MAX_RETAINED_RESPONSES);
  });

  it('release drops the reservation without writing a body', async () => {
    const storage = new MemDoStorage();
    const store = new QuotaStore(storage, QUOTA_PROFILES.ai);
    await store.reserve('free', 'k1', T0);
    await store.release('k1', T0 + 1);
    expect((await store.reserve('free', 'k1', T0 + 2)).kind).toBe('proceed');
    expect(storage.map.has(responseKey('k1'))).toBe(false);
  });
});
