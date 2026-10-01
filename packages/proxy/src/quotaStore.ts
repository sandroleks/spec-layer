import {
  QuotaEngine, RESPONSE_TTL_MS,
  type CommitOptions, type QuotaLimits, type QuotaSnapshot, type ReleaseOptions, type ReserveOptions, type ReserveResult, type Tier,
} from './quota';

/** The slice of DurableObjectStorage used; the DO passes `ctx.storage`, tests a Map. */
export interface DoStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/**
 * Storage layout, one Durable Object per identity and profile:
 *   engine            QuotaEngine JSON: counts, reservations, and a body-free
 *                     index of committed cache keys
 *   resp:<cacheKey>   the committed response body for that key
 * Bodies stay out of `engine` so a busy identity cannot push it past the
 * per-value limit and fail every quota op.
 */
export const ENGINE_KEY = 'engine';
export const responseKey = (cacheKey: string): string => `resp:${cacheKey}`;

export class QuotaStore {
  constructor(private readonly storage: DoStorageLike, private readonly limits: QuotaLimits) {}

  /**
   * Loads the counter, migrating an inline-body blob once: live bodies move to
   * their own keys, expired ones are dropped (the next prune forgets their
   * index entries), and the body-free record is written back.
   */
  private async load(now: number): Promise<QuotaEngine> {
    const stored = await this.storage.get<string>(ENGINE_KEY);
    const engine = new QuotaEngine(stored, this.limits);
    const legacy = engine.drainLegacyBodies();
    if (legacy.length > 0) {
      for (const entry of legacy) {
        if (now - entry.at < RESPONSE_TTL_MS) await this.storage.put(responseKey(entry.cacheKey), entry.body);
      }
      await this.save(engine);
    }
    return engine;
  }

  /** Deletes the bodies of entries evicted since the last save, then persists. */
  private async save(engine: QuotaEngine): Promise<void> {
    for (const cacheKey of engine.takeEvicted()) await this.storage.delete(responseKey(cacheKey));
    await this.storage.put(ENGINE_KEY, engine.toJSON());
  }

  async reserve(tier: Tier, cacheKey: string, now: number, opts?: ReserveOptions): Promise<ReserveResult> {
    const engine = await this.load(now);
    let out = engine.reserve(tier, cacheKey, now, opts);
    if (out.kind === 'cached') {
      const body = await this.storage.get<string>(responseKey(cacheKey));
      if (body !== undefined) {
        await this.save(engine);
        return { kind: 'cached', body };
      }
      // The index remembers a commit whose body is gone. Answering would be
      // a fabricated response, so forget it and reserve afresh (the retry
      // counts against the per-minute attempt limit).
      engine.forgetResponse(cacheKey);
      out = engine.reserve(tier, cacheKey, now, opts);
    }
    await this.save(engine);
    // Nothing should answer `cached` after `forgetResponse`; fail closed if it does.
    return out.kind === 'cached' ? { kind: 'pending' } : out;
  }

  /** Returns the snapshot in the same hop, so the handler needs no second call for headers. */
  async commit(tier: Tier, cacheKey: string, body: string, now: number, opts?: CommitOptions): Promise<QuotaSnapshot> {
    const engine = await this.load(now);
    engine.commit(cacheKey, now, opts);
    await this.storage.put(responseKey(cacheKey), body);
    await this.save(engine);
    return engine.snapshot(tier, now);
  }

  async release(cacheKey: string, now: number, opts?: ReleaseOptions): Promise<void> {
    const engine = await this.load(now);
    engine.release(cacheKey, now, opts);
    await this.save(engine);
  }

  async snapshot(tier: Tier, now: number): Promise<QuotaSnapshot> {
    const engine = await this.load(now);
    return engine.snapshot(tier, now);
  }
}
