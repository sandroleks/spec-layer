export const BOOST_LIMIT = 20;
export const BOOST_WINDOW_MS = 30 * 864e5;
export const MONTHLY_LIMIT = 10;
export const PRO_SOFT_THRESHOLD = 1000;
export const RATE_LIMIT_PER_MIN = 10;
export const RESERVATION_TTL_MS = 120_000;
export const RESPONSE_TTL_MS = 24 * 3600_000;
/**
 * How many committed responses one identity keeps for replay. Each body has
 * its own storage key (`resp:<cacheKey>`, see quotaStore.ts); this bounds the
 * index inside the engine record and the storage the identity holds. The
 * oldest fall out first, before their 24 h would have expired them.
 */
export const MAX_RETAINED_RESPONSES = 500;

export const PUBLISH_MONTHLY_LIMIT = 10;

export interface QuotaLimits {
  /** null disables the first-sight boost window. */
  boostLimit: number | null;
  boostWindowMs: number;
  monthlyLimit: number;
}

export type QuotaProfile = 'ai' | 'publish';

/**
 * Two things the engine counts, with different shapes. AI writing has a boost
 * because a new user tries many components at once. Publishing is a whole-file
 * action a few times a week, so a flat monthly number is the honest one.
 */
export const QUOTA_PROFILES: Record<QuotaProfile, QuotaLimits> = {
  ai: { boostLimit: BOOST_LIMIT, boostWindowMs: BOOST_WINDOW_MS, monthlyLimit: MONTHLY_LIMIT },
  publish: { boostLimit: null, boostWindowMs: 0, monthlyLimit: PUBLISH_MONTHLY_LIMIT },
};

/**
 * One Durable Object per identity and profile. The AI profile keeps the bare
 * identity as its name so every existing object's state stays reachable; other
 * profiles are prefixed so their counts never share storage with it.
 */
export function quotaObjectName(identityId: string, profile: QuotaProfile): string {
  return profile === 'ai' ? identityId : `${profile}:${identityId}`;
}

export type Tier = 'free' | 'pro';

export interface QuotaSnapshot {
  tier: Tier;
  used: number;
  limit: number | null;     // null = unlimited (pro)
  remaining: number | null;
  resetsAt: string;
}

export function quotaHeaders(s: QuotaSnapshot): Record<string, string> {
  return {
    'X-Tier': s.tier,
    'X-Quota-Used': String(s.used),
    'X-Quota-Limit': s.limit === null ? 'unlimited' : String(s.limit),
    'X-Quota-Remaining': s.remaining === null ? 'unlimited' : String(s.remaining),
    'X-Quota-Resets-At': s.resetsAt,
  };
}

/** What the engine alone can say. A cached answer's body lives outside the counter; the store fills it in. */
export type EngineReserveResult =
  | { kind: 'proceed'; flagged?: boolean }
  | { kind: 'cached' }
  | { kind: 'pending' }
  | { kind: 'exhausted'; resetsAt: string }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'library_limit'; limit: number; owned: number };

/** What a QuotaClient answers: the engine's verdict with the cached body attached. */
export type ReserveResult = Exclude<EngineReserveResult, { kind: 'cached' }> | { kind: 'cached'; body: string };

export interface ReserveOptions {
  /**
   * A name several cache keys answer to. While a live reservation holds it
   * under another key, this reserve is `pending`: two changed publishes to
   * one library cannot both proceed. Publish passes `publish:<libraryId>`.
   */
  lock?: string;
  /**
   * This reservation creates a library. Refused with `library_limit` once
   * the object's committed creates or the caller's listing (whichever knows
   * more), plus the creates still in flight, reach `limit`. The listing
   * covers libraries that predate this counter; the counter covers what an
   * eventually consistent listing has not caught up with.
   */
  create?: { limit: number; listed: number };
}

interface ResponseEntry { at: number }
/** A response entry as a blob written before the split stored it: body inline. */
interface LegacyResponseEntry extends ResponseEntry { body?: string }
export interface LegacyBody { cacheKey: string; body: string; at: number }

interface State {
  firstSeen: number | null;
  boostUsed: number;
  months: Record<string, number>;              // 'YYYY-MM' -> committed count
  reservations: Record<string, number>;        // cacheKey -> reservedAt
  responses: Record<string, ResponseEntry>;    // cacheKey -> committed at; the body is under its own storage key
  recent: number[];                            // request timestamps (rate limit)
  locks: Record<string, { cacheKey: string; at: number }>;   // lock name -> the reservation holding it
  pendingCreates: Record<string, number>;      // cacheKey -> reservedAt, for create reservations only
  libraries: number;                           // creates committed through this object
}

const fresh = (): State => ({
  firstSeen: null, boostUsed: 0, months: {}, reservations: {}, responses: {}, recent: [],
  locks: {}, pendingCreates: {}, libraries: 0,
});

const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);

function nextMonthStart(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

export class QuotaEngine {
  private s: State;
  private legacy: LegacyBody[] = [];
  private evicted: string[] = [];

  constructor(json?: string, private limits: QuotaLimits = QUOTA_PROFILES.ai) {
    this.s = json ? { ...fresh(), ...(JSON.parse(json) as State) } : fresh();
    // A blob written before the split carries each body inline. Lift them out
    // so the counter stays small; the store writes them under their own keys.
    for (const [cacheKey, entry] of Object.entries(this.s.responses as Record<string, LegacyResponseEntry>)) {
      if (typeof entry.body === 'string') {
        this.legacy.push({ cacheKey, body: entry.body, at: entry.at });
        this.s.responses[cacheKey] = { at: entry.at };
      }
    }
    if (this.legacy.length > 0) {
      // Hold the retention cap from the migration on, so it never writes more
      // than MAX_RETAINED_RESPONSES bodies. A lifted body the cap drops was
      // never written under its own key, so it is not handed on for deletion.
      this.capResponses();
      const dropped = new Set(this.legacy.map((l) => l.cacheKey).filter((k) => this.s.responses[k] === undefined));
      this.legacy = this.legacy.filter((l) => !dropped.has(l.cacheKey));
      this.evicted = this.evicted.filter((k) => !dropped.has(k));
    }
  }

  toJSON(): string { return JSON.stringify(this.s); }

  /** Inline bodies found in a pre-split blob, handed over once. */
  drainLegacyBodies(): LegacyBody[] {
    const out = this.legacy;
    this.legacy = [];
    return out;
  }

  /** Cache keys whose index entry was dropped since the last call; their bodies are the store's to delete. */
  takeEvicted(): string[] {
    const out = this.evicted;
    this.evicted = [];
    return out;
  }

  /** Drops one committed entry, reporting it through `takeEvicted` exactly once. */
  forgetResponse(cacheKey: string): void {
    if (this.s.responses[cacheKey] === undefined) return;
    delete this.s.responses[cacheKey];
    this.evicted.push(cacheKey);
  }

  private capResponses(): void {
    const keys = Object.keys(this.s.responses);
    if (keys.length <= MAX_RETAINED_RESPONSES) return;
    keys.sort((a, b) => this.s.responses[a].at - this.s.responses[b].at || (a < b ? -1 : a > b ? 1 : 0));
    for (const key of keys.slice(0, keys.length - MAX_RETAINED_RESPONSES)) this.forgetResponse(key);
  }

  // A never-seen identity is treated as starting its boost window "now" so
  // that a quota peek (GET /v1/quota before any generation) reports boost
  // limits rather than falling through to the monthly rules.
  private inBoost(now: number): boolean {
    if (this.limits.boostLimit === null) return false;
    const first = this.s.firstSeen ?? now;
    return now < first + this.limits.boostWindowMs;
  }

  private freeUsage(now: number): { used: number; limit: number; resetsAt: string } {
    const first = this.s.firstSeen ?? now;
    if (this.inBoost(now) && this.limits.boostLimit !== null) {
      return {
        used: this.s.boostUsed,
        limit: this.limits.boostLimit,
        resetsAt: new Date(first + this.limits.boostWindowMs).toISOString(),
      };
    }
    return {
      used: this.s.months[monthKey(now)] ?? 0,
      limit: this.limits.monthlyLimit,
      resetsAt: nextMonthStart(now),
    };
  }

  /** Drop expired responses and stale reservations so serialized state stays bounded. */
  private prune(now: number): void {
    for (const [k, v] of Object.entries(this.s.responses)) {
      if (now - v.at >= RESPONSE_TTL_MS) this.forgetResponse(k);
    }
    for (const [k, at] of Object.entries(this.s.reservations)) {
      if (now - at >= RESERVATION_TTL_MS) delete this.s.reservations[k];
    }
    for (const [name, held] of Object.entries(this.s.locks)) {
      if (now - held.at >= RESERVATION_TTL_MS) delete this.s.locks[name];
    }
    for (const [k, at] of Object.entries(this.s.pendingCreates)) {
      if (now - at >= RESERVATION_TTL_MS) delete this.s.pendingCreates[k];
    }
  }

  reserve(tier: Tier, cacheKey: string, now: number, opts: ReserveOptions = {}): EngineReserveResult {
    this.prune(now);
    if (this.s.firstSeen === null) this.s.firstSeen = now;
    // Idempotent retry: a committed generation within 24h is served from cache.
    const hit = this.s.responses[cacheKey];
    if (hit && now - hit.at < RESPONSE_TTL_MS) return { kind: 'cached' };
    if (hit) this.forgetResponse(cacheKey);
    // Sliding-window rate limit (attempts, not commits).
    this.s.recent = this.s.recent.filter((t) => now - t < 60_000);
    if (this.s.recent.length >= RATE_LIMIT_PER_MIN) {
      const retryAfterMs = 60_000 - (now - this.s.recent[0]);
      return { kind: 'rate_limited', retryAfterMs };
    }
    this.s.recent.push(now);
    // Concurrent window on the same component: live reservation wins.
    const heldAt = this.s.reservations[cacheKey];
    if (heldAt !== undefined && now - heldAt < RESERVATION_TTL_MS) return { kind: 'pending' };
    // Another writer holds this lock under a different key: it finishes first.
    if (opts.lock !== undefined) {
      const held = this.s.locks[opts.lock];
      if (held && held.cacheKey !== cacheKey && now - held.at < RESERVATION_TTL_MS) return { kind: 'pending' };
    }
    if (opts.create) {
      const owned = Math.max(opts.create.listed, this.s.libraries);
      const inFlight = Object.keys(this.s.pendingCreates).length;
      if (owned + inFlight >= opts.create.limit) return { kind: 'library_limit', limit: opts.create.limit, owned };
    }
    if (tier === 'free') {
      const { used, limit, resetsAt } = this.freeUsage(now);
      if (used >= limit) return { kind: 'exhausted', resetsAt };
    }
    this.s.reservations[cacheKey] = now;
    if (opts.lock !== undefined) this.s.locks[opts.lock] = { cacheKey, at: now };
    if (opts.create) this.s.pendingCreates[cacheKey] = now;
    if (tier === 'pro') {
      const used = this.s.months[monthKey(now)] ?? 0;
      return { kind: 'proceed', flagged: used >= PRO_SOFT_THRESHOLD };
    }
    return { kind: 'proceed' };
  }

  /** Frees every lock and create slot this reservation holds. `commit` counts the create; `release` only frees it. */
  private settle(cacheKey: string, committed: boolean): void {
    delete this.s.reservations[cacheKey];
    for (const [name, held] of Object.entries(this.s.locks)) {
      if (held.cacheKey === cacheKey) delete this.s.locks[name];
    }
    if (this.s.pendingCreates[cacheKey] !== undefined) {
      delete this.s.pendingCreates[cacheKey];
      if (committed) this.s.libraries += 1;
    }
  }

  commit(cacheKey: string, now: number): void {
    this.prune(now);
    this.settle(cacheKey, true);
    this.s.responses[cacheKey] = { at: now };
    // A stale entry for this same key, pruned just above, must not make the
    // store delete the body this commit is about to write.
    this.evicted = this.evicted.filter((k) => k !== cacheKey);
    this.capResponses();
    if (this.inBoost(now)) this.s.boostUsed += 1;
    const mk = monthKey(now);
    this.s.months[mk] = (this.s.months[mk] ?? 0) + 1;
  }

  release(cacheKey: string): void {
    this.settle(cacheKey, false);
  }

  snapshot(tier: Tier, now: number): QuotaSnapshot {
    if (tier === 'pro') {
      const used = this.s.months[monthKey(now)] ?? 0;
      return { tier, used, limit: null, remaining: null, resetsAt: nextMonthStart(now) };
    }
    const { used, limit, resetsAt } = this.freeUsage(now);
    return { tier, used, limit, remaining: Math.max(0, limit - used), resetsAt };
  }
}
