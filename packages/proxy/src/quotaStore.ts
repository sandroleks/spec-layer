import {
  QuotaEngine, RESPONSE_TTL_MS,
  type QuotaLimits, type QuotaSnapshot, type ReserveResult, type Tier,
} from './quota';

/**
 * The slice of DurableObjectStorage the store uses. Structural, so the
 * Durable Object passes `ctx.storage` and tests pass a Map.
 */
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
 * Before this split the engine value carried every body inline and a busy
 * identity could push it past the per-value limit, failing every quota op.
 */
export const ENGINE_KEY = 'engine';
export const responseKey = (cacheKey: string): string => `resp:${cacheKey}`;

export class QuotaStore {
  constructor(private readonly storage: DoStorageLike, private readonly limits: QuotaLimits) {}

  /**
   * Loads the counter. A blob written before the split is migrated here,
   * once: each live body moves under its own key, expired ones are not
   * copied (the engine's next prune forgets their index entries), and the
   * body-free record is written back.
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

  /** Persists the counter after deleting the body of every entry the engine dropped since the last save. */
  private async save(engine: QuotaEngine): Promise<void> {
    for (const cacheKey of engine.takeEvicted()) await this.storage.delete(responseKey(cacheKey));
    await this.storage.put(ENGINE_KEY, engine.toJSON());
  }

  async reserve(tier: Tier, cacheKey: string, now: number): Promise<ReserveResult> {
    const engine = await this.load(now);
    let out = engine.reserve(tier, cacheKey, now);
    if (out.kind === 'cached') {
      const body = await this.storage.get<string>(responseKey(cacheKey));
      if (body !== undefined) {
        await this.save(engine);
        return { kind: 'cached', body };
      }
      // The index remembers a commit whose body is gone. Answering with
      // nothing would be a fabricated response, so forget the entry and
      // reserve afresh (this second attempt also counts against the
      // per-minute attempt limit, which is the honest reading of it).
      engine.forgetResponse(cacheKey);
      out = engine.reserve(tier, cacheKey, now);
    }
    await this.save(engine);
    // `forgetResponse` removed the only entry that could answer `cached` again; fail closed if it somehow does.
    return out.kind === 'cached' ? { kind: 'pending' } : out;
  }

  /** Commits and returns the snapshot in the same hop, so a handler answers its headers without a second call. */
  async commit(tier: Tier, cacheKey: string, body: string, now: number): Promise<QuotaSnapshot> {
    const engine = await this.load(now);
    engine.commit(cacheKey, now);
    await this.storage.put(responseKey(cacheKey), body);
    await this.save(engine);
    return engine.snapshot(tier, now);
  }

  async release(cacheKey: string, now: number): Promise<void> {
    const engine = await this.load(now);
    engine.release(cacheKey);
    await this.save(engine);
  }

  async snapshot(tier: Tier, now: number): Promise<QuotaSnapshot> {
    const engine = await this.load(now);
    return engine.snapshot(tier, now);
  }
}
