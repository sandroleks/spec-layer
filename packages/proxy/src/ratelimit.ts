/**
 * Per-isolate sliding-window limiter. Best-effort: state resets when the
 * isolate recycles and is not shared across colos — good enough to blunt
 * naive enumeration; a Cloudflare WAF rate rule is the real backstop (README).
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}

  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
