/** Distinct keys one surface may hold before the limiter fails closed for new ones. */
export const MAX_KEYS_PER_SURFACE = 10_000;
/**
 * One surface's worth of keys per prefix sharing the map: `requestLimiter` has
 * five (prose:, quota:, libreq:, libdry:, libpull:), `licenseLimiter` three
 * (bare IP on license routes, libpub:, librot:). The map is still shared, so
 * enough distinct addresses on one surface in one window can fill it.
 */
export const REQUEST_LIMITER_MAX_KEYS = 5 * MAX_KEYS_PER_SURFACE;
export const LICENSE_LIMITER_MAX_KEYS = 3 * MAX_KEYS_PER_SURFACE;

/** What a handler asks before doing work for a caller: may `key` go ahead now? */
export interface RateLimiter {
  allow(key: string, now: number): boolean | Promise<boolean>;
}

/**
 * Per-isolate sliding-window limiter. Best-effort: state resets when the
 * isolate recycles and is not shared across isolates or colos. In production
 * it is the first layer of a LayeredLimiter, in front of the Workers Rate
 * Limiting binding; the WAF rule on /v1/license/ sits in front of both
 * (README).
 */
export class SlidingWindowLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    private limit: number,
    private windowMs: number,
    private maxKeys = MAX_KEYS_PER_SURFACE,
  ) {}

  private prune(now: number): void {
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((t) => now - t < this.windowMs);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }

  allow(key: string, now: number): boolean {
    this.calls += 1;
    if (this.calls % 256 === 0 || (!this.hits.has(key) && this.hits.size >= this.maxKeys)) {
      this.prune(now);
    }
    // Attacker-controlled keys must not grow isolate memory without bound.
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) return false;

    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** The slice of the Workers Rate Limiting binding this uses. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The isolate's own window first, then the Rate Limiting binding, whose
 * counters are shared by every isolate in a Cloudflare location. The first
 * layer refuses a burst from one isolate without a round trip and keeps
 * memory bounded; the second is the limit that holds when traffic spreads
 * across isolates, which the first alone never could.
 *
 * A binding that throws lets the request through on the first layer's
 * answer and is logged: an outage of the limiter must not take every route
 * down with it, and the first layer still caps each isolate.
 */
export class LayeredLimiter implements RateLimiter {
  constructor(
    private local: SlidingWindowLimiter,
    private shared: RateLimitBinding | undefined,
    private onError: (err: unknown) => void = () => {},
  ) {}

  async allow(key: string, now: number): Promise<boolean> {
    if (!this.local.allow(key, now)) return false;
    if (!this.shared) return true;
    try {
      return (await this.shared.limit({ key })).success;
    } catch (err) {
      this.onError(err);
      return true;
    }
  }
}
