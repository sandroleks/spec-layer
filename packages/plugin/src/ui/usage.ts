/**
 * Usage events from the plugin UI to the proxy's `/v1/events`, behind the
 * Settings switch. The catalogue of events lives in the extractor
 * (`usageEvents.ts`), shared with the proxy, which drops anything outside it.
 *
 * Fire and forget: `track` never throws, nothing awaits a send, and a send
 * that fails is not reported, because the UI's error reporting would turn it
 * into the "Something went wrong" toast. Events queue until the main thread
 * has said whether the switch is on and under which id, then go in small
 * batches a moment apart, and whatever is still queued goes with `keepalive`
 * when the iframe is hidden or unloaded. An unstamped build (a test, the
 * harness) sends nothing at all.
 */

import {
  MAX_USAGE_BATCH, ProseProxyError, USAGE_EVENTS_PATH,
  type UsageBatch, type UsageEvent, type UsageEventName, type UsageFields,
} from '@spec-layer/extractor';
import {
  CHECKOUT_URL, DOCS_URL, MANAGE_SUB_URL, PROXY_URL, SITE_URL, clientHeaders, isNetworkFailure,
} from './proxy';

/** How long the first queued event waits for company before a batch goes. */
export const USAGE_FLUSH_DELAY_MS = 1500;

/** Events held while the switch is still unknown; beyond this the newest are dropped. */
export const MAX_USAGE_QUEUE = 200;

export interface UsageTrackerDeps {
  /** `window.fetch`, bound. The answer is never read. */
  fetcher: (url: string, init: RequestInit) => Promise<unknown>;
  /** The stamped build, or null, which keeps every event in. */
  build: string | null;
  /** The plan as the plugin last saw it, stamped on each batch. */
  tier(): 'free' | 'pro' | null;
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

export interface UsageTracker {
  track(name: UsageEventName, fields?: UsageFields): void;
  /** What the main thread reported: the switch, and the id when it is on. */
  configure(enabled: boolean, installId: string | null): void;
  /** Send what is queued now, `keepalive`, for a page about to go. */
  flush(): void;
  /** Queued and not yet sent; for tests. */
  pending(): number;
}

export function createUsageTracker(deps: UsageTrackerDeps): UsageTracker {
  let enabled: boolean | null = null;
  let installId: string | null = null;
  let queue: UsageEvent[] = [];
  let timer: unknown = null;

  const ready = (): boolean => enabled === true && installId !== null && deps.build !== null;

  const cancelTimer = (): void => {
    if (timer === null) return;
    deps.cancel(timer);
    timer = null;
  };

  const flush = (): void => {
    cancelTimer();
    if (!ready() || queue.length === 0) return;
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_USAGE_BATCH);
      const tier = deps.tier();
      const batch: UsageBatch = { install: installId!, ...(tier ? { tier } : {}), events };
      try {
        void Promise.resolve(deps.fetcher(`${PROXY_URL}${USAGE_EVENTS_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...clientHeaders(deps.build) },
          body: JSON.stringify(batch),
          // Lets the request outlive the iframe, so the last events of a
          // session are not lost when the plugin closes.
          keepalive: true,
        })).catch(() => { /* never reported: see the module comment */ });
      } catch {
        // A fetch that throws before returning a promise is the same silence.
      }
    }
  };

  const schedule = (): void => {
    if (timer !== null || !ready()) return;
    timer = deps.schedule(() => {
      timer = null;
      flush();
    }, USAGE_FLUSH_DELAY_MS);
  };

  return {
    track(name, fields = {}) {
      try {
        if (deps.build === null || enabled === false) return;
        if (queue.length >= MAX_USAGE_QUEUE) return;
        queue.push({ name, ...fields });
        if (queue.length >= MAX_USAGE_BATCH) flush();
        else schedule();
      } catch {
        // Counting must never break the action being counted.
      }
    },
    configure(nextEnabled, nextInstallId) {
      enabled = nextEnabled;
      installId = nextEnabled ? nextInstallId : null;
      if (!nextEnabled) {
        queue = [];
        cancelTimer();
        return;
      }
      if (queue.length > 0) schedule();
    },
    flush,
    pending: () => queue.length,
  };
}

// ---------------------------------------------------------------------------
// The one tracker the UI installs, reachable from modules that have no
// handle on it (actions.ts, publish.ts), the way the publish host is.
// ---------------------------------------------------------------------------

let active: UsageTracker | null = null;

export function setUsageTracker(tracker: UsageTracker | null): void {
  active = tracker;
}

/** Count an event on the installed tracker; nothing happens before one is installed. */
export function trackUsage(name: UsageEventName, fields: UsageFields = {}): void {
  active?.track(name, fields);
}

/** `inst_` and 32 hex digits from the platform's random bytes. */
export function mintInstallId(
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => { crypto.getRandomValues(bytes); },
): string {
  const bytes = new Uint8Array(16);
  fill(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `inst_${hex}`;
}

/** An AI failure as an outcome token: the proxy's code, `unreachable`, or `failed`. */
export function failureOutcome(err: unknown): string {
  if (err instanceof ProseProxyError) return err.code;
  return isNetworkFailure(err) ? 'unreachable' : 'failed';
}

/** Which product link an outbound href is, for `external_link`; the URL itself is never sent. */
export function externalLinkKind(href: string): 'docs' | 'site' | 'checkout' | 'manage' | 'support' | 'other' {
  if (href.startsWith(DOCS_URL)) return 'docs';
  if (href === CHECKOUT_URL) return 'checkout';
  if (href === MANAGE_SUB_URL) return 'manage';
  if (href.startsWith('mailto:')) return 'support';
  if (href.startsWith(SITE_URL)) return 'site';
  return 'other';
}

/** The `external_link` kind for a License screen action (`licenseExternalUrl`). */
export function licenseLinkKind(action: string): 'checkout' | 'manage' | 'other' {
  if (action === 'upgrade' || action === 'renew') return 'checkout';
  if (action === 'manage') return 'manage';
  return 'other';
}
