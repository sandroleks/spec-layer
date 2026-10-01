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

/**
 * Per-isolate sliding-window limiter. Best-effort: state resets when the
 * isolate recycles and is not shared across colos, enough to blunt naive
 * enumeration; a Cloudflare WAF rate rule is the real backstop (README).
 */
export class SlidingWindowLimiter {
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
