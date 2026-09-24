import { DurableObject } from 'cloudflare:workers';
import { route, requestLog, type HandlerDeps, type QuotaClient } from './handlers';
import type { LibraryStore } from './license';
import { QUOTA_PROFILES, quotaObjectName, type CommitOptions, type QuotaProfile, type QuotaSnapshot, type ReleaseOptions, type ReserveOptions, type ReserveResult, type Tier } from './quota';
import { QuotaStore } from './quotaStore';
import { SlidingWindowLimiter, REQUEST_LIMITER_MAX_KEYS, LICENSE_LIMITER_MAX_KEYS } from './ratelimit';

const licenseLimiter = new SlidingWindowLimiter(20, 60_000, LICENSE_LIMITER_MAX_KEYS);
const requestLimiter = new SlidingWindowLimiter(60, 60_000, REQUEST_LIMITER_MAX_KEYS);

export interface Env {
  LICENSE_CACHE: KVNamespace;
  QUOTA: DurableObjectNamespace<QuotaDO>;
  ANTHROPIC_API_KEY: string;
  FIGMA_ID_SALT: string;
}

/**
 * One Durable Object per identity and profile: single-threaded execution
 * makes reserve/commit atomic without explicit locking. Every rule and the
 * storage layout live in QuotaStore, which the tests drive over an in-memory
 * storage; this class only binds `ctx.storage` and exposes the four
 * operations over RPC. The profile rides on each call because the object's
 * name, not its state, decides it. `now` comes from the Worker so the clock
 * is one place, as before.
 */
export class QuotaDO extends DurableObject<Env> {
  private store(profile: QuotaProfile): QuotaStore {
    return new QuotaStore(this.ctx.storage, QUOTA_PROFILES[profile]);
  }

  reserve(profile: QuotaProfile, tier: Tier, cacheKey: string, now: number, opts?: ReserveOptions): Promise<ReserveResult> {
    return this.store(profile).reserve(tier, cacheKey, now, opts);
  }

  commit(profile: QuotaProfile, tier: Tier, cacheKey: string, body: string, now: number, opts?: CommitOptions): Promise<QuotaSnapshot> {
    return this.store(profile).commit(tier, cacheKey, body, now, opts);
  }

  release(profile: QuotaProfile, cacheKey: string, now: number, opts?: ReleaseOptions): Promise<void> {
    return this.store(profile).release(cacheKey, now, opts);
  }

  snapshot(profile: QuotaProfile, tier: Tier, now: number): Promise<QuotaSnapshot> {
    return this.store(profile).snapshot(tier, now);
  }
}

function doQuotaClient(ns: DurableObjectNamespace<QuotaDO>, identityId: string, profile: QuotaProfile = 'ai'): QuotaClient {
  const stub = ns.get(ns.idFromName(quotaObjectName(identityId, profile)));
  return {
    reserve: async (tier, cacheKey, opts) => await stub.reserve(profile, tier, cacheKey, Date.now(), opts),
    commit: async (tier, cacheKey, body, opts) => await stub.commit(profile, tier, cacheKey, body, Date.now(), opts),
    release: async (cacheKey, opts) => { await stub.release(profile, cacheKey, Date.now(), opts); },
    snapshot: async (tier) => await stub.snapshot(profile, tier, Date.now()),
  };
}

/** The KV namespace as a LibraryStore: KV already lists by prefix; the stream read is `get(key, 'stream')`. */
function kvLibraryStore(kv: KVNamespace): LibraryStore {
  return {
    get: (key) => kv.get(key),
    put: (key, value, opts) => kv.put(key, value, opts),
    delete: (key) => kv.delete(key),
    list: (opts) => kv.list(opts),
    getStream: (key) => kv.get(key, 'stream'),
  };
}

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const deps: HandlerDeps = {
      salt: env.FIGMA_ID_SALT,
      anthropicKey: env.ANTHROPIC_API_KEY,
      fetcher: fetch.bind(globalThis),
      licenseCache: env.LICENSE_CACHE,
      now: () => Date.now(),
      quotaFor: (id, profile) => doQuotaClient(env.QUOTA, id, profile),
      log: requestLog(req, (line) => console.log(line)),
      licenseLimiter,
      requestLimiter,
      // Same KV namespace as licenseCache today; a dedicated namespace later
      // is a one-line change once library volume warrants it.
      libraryStore: kvLibraryStore(env.LICENSE_CACHE),
    };
    return route(req, deps);
  },
};

export default worker;
