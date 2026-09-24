import type { QuotaClient } from '../src/handlers';
import { QUOTA_PROFILES, quotaObjectName, type QuotaProfile } from '../src/quota';
import { QuotaStore, type DoStorageLike } from '../src/quotaStore';

/** The storage a Durable Object hands QuotaStore, in memory. */
export class MemDoStorage implements DoStorageLike {
  map = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> { return this.map.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.map.set(key, value); }
  async delete(key: string): Promise<boolean> { return this.map.delete(key); }
}

/** In-memory QuotaClient over the real store: the same code path the DO runs in prod, minus the RPC hop. */
export function memQuota(now: () => number) {
  const stores = new Map<string, QuotaStore>();
  return (id: string, profile: QuotaProfile = 'ai'): QuotaClient => {
    const key = quotaObjectName(id, profile);
    const store = stores.get(key) ?? new QuotaStore(new MemDoStorage(), QUOTA_PROFILES[profile]);
    stores.set(key, store);
    return {
      reserve: (tier, cacheKey, opts) => store.reserve(tier, cacheKey, now(), opts),
      commit: (tier, cacheKey, body) => store.commit(tier, cacheKey, body, now()),
      release: (cacheKey) => store.release(cacheKey, now()),
      snapshot: (tier) => store.snapshot(tier, now()),
    };
  };
}
