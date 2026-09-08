export const BOOST_LIMIT = 20;
export const BOOST_WINDOW_MS = 30 * 864e5;
export const MONTHLY_LIMIT = 10;
export const PRO_SOFT_THRESHOLD = 1000;
export const RATE_LIMIT_PER_MIN = 10;
export const RESERVATION_TTL_MS = 120_000;
export const RESPONSE_TTL_MS = 24 * 3600_000;

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

export type Tier = 'free' | 'pro';

export interface QuotaSnapshot {
  tier: Tier;
  used: number;
  limit: number | null;     // null = unlimited (pro)
  remaining: number | null;
  resetsAt: string;
}

export type ReserveResult =
  | { kind: 'proceed'; flagged?: boolean }
  | { kind: 'cached'; body: string }
  | { kind: 'pending' }
  | { kind: 'exhausted'; resetsAt: string }
  | { kind: 'rate_limited'; retryAfterMs: number };

interface State {
  firstSeen: number | null;
  boostUsed: number;
  months: Record<string, number>;              // 'YYYY-MM' -> committed count
  reservations: Record<string, number>;        // cacheKey -> reservedAt
  responses: Record<string, { body: string; at: number }>;
  recent: number[];                            // request timestamps (rate limit)
}

const fresh = (): State => ({
  firstSeen: null, boostUsed: 0, months: {}, reservations: {}, responses: {}, recent: [],
});

const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);

function nextMonthStart(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

export class QuotaEngine {
  private s: State;

  constructor(json?: string, private limits: QuotaLimits = QUOTA_PROFILES.ai) {
    this.s = json ? { ...fresh(), ...(JSON.parse(json) as State) } : fresh();
  }

  toJSON(): string { return JSON.stringify(this.s); }

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
      if (now - v.at >= RESPONSE_TTL_MS) delete this.s.responses[k];
    }
    for (const [k, at] of Object.entries(this.s.reservations)) {
      if (now - at >= RESERVATION_TTL_MS) delete this.s.reservations[k];
    }
  }

  reserve(tier: Tier, cacheKey: string, now: number): ReserveResult {
    this.prune(now);
    if (this.s.firstSeen === null) this.s.firstSeen = now;
    // Idempotent retry: a committed generation within 24h is served from cache.
    const hit = this.s.responses[cacheKey];
    if (hit && now - hit.at < RESPONSE_TTL_MS) return { kind: 'cached', body: hit.body };
    if (hit) delete this.s.responses[cacheKey];
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
    if (tier === 'free') {
      const { used, limit, resetsAt } = this.freeUsage(now);
      if (used >= limit) return { kind: 'exhausted', resetsAt };
    }
    this.s.reservations[cacheKey] = now;
    if (tier === 'pro') {
      const used = this.s.months[monthKey(now)] ?? 0;
      return { kind: 'proceed', flagged: used >= PRO_SOFT_THRESHOLD };
    }
    return { kind: 'proceed' };
  }

  commit(cacheKey: string, body: string, now: number): void {
    this.prune(now);
    delete this.s.reservations[cacheKey];
    this.s.responses[cacheKey] = { body, at: now };
    if (this.inBoost(now)) this.s.boostUsed += 1;
    const mk = monthKey(now);
    this.s.months[mk] = (this.s.months[mk] ?? 0) + 1;
  }

  release(cacheKey: string): void {
    delete this.s.reservations[cacheKey];
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
