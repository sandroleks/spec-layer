export const MONTHLY_LIMIT = 20;
export const PRO_SOFT_THRESHOLD = 1000;
export const RATE_LIMIT_PER_MIN = 10;
/** Longer than `UPSTREAM_TIMEOUT_MS` (handlers.ts), so a reservation never lapses mid-generation. */
export const RESERVATION_TTL_MS = 180_000;
export const RESPONSE_TTL_MS = 24 * 3600_000;
/**
 * How long a committed library head guards against stale reads: a racing read
 * (seconds) and KV lag (about a minute), with margin. Also bounds how long an
 * out-of-order head (a publish that outlived its lock) can refuse writers.
 */
export const HEAD_TTL_MS = 10 * 60_000;
/** Replayable responses per identity, bounding the index and `resp:` keys; oldest go first. */
export const MAX_RETAINED_RESPONSES = 500;

export const PUBLISH_MONTHLY_LIMIT = 10;

export interface QuotaLimits {
  monthlyLimit: number;
}

export type QuotaProfile = 'ai' | 'publish';

/** Each a flat count per UTC calendar month, kept apart so prose never spends a publish. */
export const QUOTA_PROFILES: Record<QuotaProfile, QuotaLimits> = {
  ai: { monthlyLimit: MONTHLY_LIMIT },
  publish: { monthlyLimit: PUBLISH_MONTHLY_LIMIT },
};

/** AI keeps the bare identity so existing objects stay reachable; other profiles are prefixed. */
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

/** The engine's verdict; a cached answer's body lives outside it, filled in by the store. */
export type EngineReserveResult =
  | { kind: 'proceed'; flagged?: boolean }
  | { kind: 'cached' }
  | { kind: 'pending' }
  | { kind: 'exhausted'; resetsAt: string }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'library_limit'; limit: number; owned: number };

export type ReserveResult = Exclude<EngineReserveResult, { kind: 'cached' }> | { kind: 'cached'; body: string };

export interface ReserveOptions {
  /**
   * A name several cache keys share; held live under another key, this
   * reserve is `pending`, so two publishes to one library cannot both proceed.
   * Publish passes `publish:<libraryId>`.
   */
  lock?: string;
  /**
   * With `lock`: the head the caller read, epoch ms. A newer recorded head
   * means a stale read, so `pending`. No recorded head (or past HEAD_TTL_MS)
   * accepts any base, as does a newer base (another identity wrote; this saw it).
   */
  base?: number;
  /**
   * `library_limit` once max(committed creates, listing) plus in-flight creates
   * reach `limit`: the listing knows older libraries, the counter what the
   * eventually consistent listing has not caught up with.
   */
  create?: { limit: number; listed: number };
}

export interface CommitOptions {
  /**
   * Counts one library, once per cache key. The marker counts, not the create
   * slot, which a write outliving `RESERVATION_TTL_MS` finds pruned.
   */
  create?: boolean;
  /**
   * The head this commit leaves under a lock, as epoch ms (the `publishedAt`
   * just written). Explicit, because a write that outlived its lock no longer holds it.
   */
  head?: { lock: string; at: number };
}

export interface ReleaseOptions {
  /**
   * A head to record while freeing, as `commit` would, counting nothing.
   * Publish passes it when its meta write landed and a later step threw;
   * without it a publish that read the older head could fork the version.
   */
  head?: { lock: string; at: number };
}

interface ResponseEntry { at: number }
/** A pre-split blob's entry, with the body inline. */
interface LegacyResponseEntry extends ResponseEntry { body?: string }
export interface LegacyBody { cacheKey: string; body: string; at: number }

interface State {
  months: Record<string, number>;              // 'YYYY-MM' -> committed count
  reservations: Record<string, number>;        // cacheKey -> reservedAt
  responses: Record<string, ResponseEntry>;    // cacheKey -> committed at; the body is under its own storage key
  recent: number[];                            // request timestamps (rate limit)
  locks: Record<string, { cacheKey: string; at: number }>;   // lock name -> the reservation holding it
  pendingCreates: Record<string, number>;      // cacheKey -> reservedAt, for create reservations only
  libraries: number;                           // creates committed through this object
  heads: Record<string, { at: number; recordedAt: number }>;  // lock name -> the head its last commit wrote
}

const fresh = (): State => ({
  months: {}, reservations: {}, responses: {}, recent: [],
  locks: {}, pendingCreates: {}, libraries: 0, heads: {},
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
    // Retired boost-window fields, dropped on load.
    const retired = this.s as State & { firstSeen?: unknown; boostUsed?: unknown };
    delete retired.firstSeen;
    delete retired.boostUsed;
    // Lift inline bodies out so the counter stays small; the store rewrites them.
    for (const [cacheKey, entry] of Object.entries(this.s.responses as Record<string, LegacyResponseEntry>)) {
      if (typeof entry.body === 'string') {
        this.legacy.push({ cacheKey, body: entry.body, at: entry.at });
        this.s.responses[cacheKey] = { at: entry.at };
      }
    }
    if (this.legacy.length > 0) {
      // Cap the migration too. A lifted body the cap drops was never written
      // under its own key, so it is not handed on for deletion.
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

  /** Keys dropped since the last call; the store deletes their bodies. */
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

  private freeUsage(now: number): { used: number; limit: number; resetsAt: string } {
    return {
      used: this.s.months[monthKey(now)] ?? 0,
      limit: this.limits.monthlyLimit,
      resetsAt: nextMonthStart(now),
    };
  }

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
    for (const [name, head] of Object.entries(this.s.heads)) {
      if (now - head.recordedAt >= HEAD_TTL_MS) delete this.s.heads[name];
    }
  }

  reserve(tier: Tier, cacheKey: string, now: number, opts: ReserveOptions = {}): EngineReserveResult {
    this.prune(now);
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
      // A writer committed after this caller read the head: its read is stale.
      const head = this.s.heads[opts.lock];
      if (opts.base !== undefined && head !== undefined && opts.base < head.at) return { kind: 'pending' };
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

  /** Frees the reservation and its locks and create slot; counting a create is `commit`'s. */
  private settle(cacheKey: string): void {
    delete this.s.reservations[cacheKey];
    for (const [name, held] of Object.entries(this.s.locks)) {
      if (held.cacheKey === cacheKey) delete this.s.locks[name];
    }
    delete this.s.pendingCreates[cacheKey];
  }

  commit(cacheKey: string, now: number, opts: CommitOptions = {}): void {
    // Read before the prune, so a replay of a commit older than the response
    // TTL still reads as already counted.
    const replayed = this.s.responses[cacheKey] !== undefined;
    this.prune(now);
    this.settle(cacheKey);
    if (opts.create === true && !replayed) this.s.libraries += 1;
    if (opts.head) this.s.heads[opts.head.lock] = { at: opts.head.at, recordedAt: now };
    this.s.responses[cacheKey] = { at: now };
    // A stale entry for this same key, pruned just above, must not make the
    // store delete the body this commit is about to write.
    this.evicted = this.evicted.filter((k) => k !== cacheKey);
    this.capResponses();
    const mk = monthKey(now);
    this.s.months[mk] = (this.s.months[mk] ?? 0) + 1;
  }

  release(cacheKey: string, now: number, opts: ReleaseOptions = {}): void {
    this.settle(cacheKey);
    if (opts.head) this.s.heads[opts.head.lock] = { at: opts.head.at, recordedAt: now };
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
