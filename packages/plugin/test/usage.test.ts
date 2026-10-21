import { describe, it, expect, vi } from 'vitest';
import { INSTALL_ID_RE, MAX_USAGE_BATCH, ProseProxyError } from '@spec-layer/extractor';
import {
  MAX_USAGE_QUEUE, USAGE_FLUSH_DELAY_MS, createUsageTracker, externalLinkKind, failureOutcome, licenseLinkKind,
  mintInstallId, setUsageTracker, trackUsage, type UsageTrackerDeps,
} from '../src/ui/usage';
import { CHECKOUT_URL, DOCS_URL, MANAGE_SUB_URL, PROXY_URL, SITE_URL, SUPPORT_MAILTO } from '../src/ui/proxy';

const INSTALL = `inst_${'0123456789abcdef'.repeat(2)}`;

/** A tracker over a fake clock: `run()` fires the pending flush timer. */
function setup(overrides: Partial<UsageTrackerDeps> = {}) {
  const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
  let pending: (() => void) | null = null;
  const deps: UsageTrackerDeps = {
    fetcher,
    build: '7.1.0',
    tier: () => 'free',
    schedule: (callback) => { pending = callback; return 1; },
    cancel: () => { pending = null; },
    ...overrides,
  };
  const tracker = createUsageTracker(deps);
  const run = () => { const callback = pending; pending = null; callback?.(); };
  const sent = (n = 0) => {
    const [url, init] = fetcher.mock.calls[n] as unknown as [string, RequestInit];
    return { url, init, body: JSON.parse(String(init.body)) as { install: string; tier?: string; events: unknown[] } };
  };
  return { tracker, fetcher, run, sent, hasTimer: () => pending !== null };
}

describe('createUsageTracker', () => {
  it('holds events until main reports the switch, then sends them in one batch', () => {
    const { tracker, fetcher, run, sent, hasTimer } = setup();
    tracker.track('plugin_opened');
    tracker.track('doc_build', { kind: 'create', detail: 'ai', outcome: 'ok', count: 4, count2: 1 });
    expect(tracker.pending()).toBe(2);
    expect(hasTimer()).toBe(false);
    tracker.configure(true, INSTALL);
    expect(hasTimer()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    run();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const { url, init, body } = sent();
    expect(url).toBe(`${PROXY_URL}/v1/events`);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'X-Plugin-Version': '7.1.0' });
    expect(body).toEqual({
      install: INSTALL, tier: 'free',
      events: [{ name: 'plugin_opened' }, { name: 'doc_build', kind: 'create', detail: 'ai', outcome: 'ok', count: 4, count2: 1 }],
    });
    expect(tracker.pending()).toBe(0);
  });

  it('waits a moment for company, then sends, and leaves the tier out when unknown', () => {
    const { tracker, fetcher, run, sent } = setup({ tier: () => null });
    tracker.configure(true, INSTALL);
    tracker.track('plugin_opened');
    tracker.track('external_link', { kind: 'docs' });
    expect(fetcher).not.toHaveBeenCalled();
    run();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sent().body.events).toHaveLength(2);
    expect('tier' in sent().body).toBe(false);
    expect(USAGE_FLUSH_DELAY_MS).toBeGreaterThan(0);
  });

  it('drops everything when the switch is off, queued events included', () => {
    const { tracker, fetcher, run } = setup();
    tracker.track('plugin_opened');
    tracker.configure(false, null);
    expect(tracker.pending()).toBe(0);
    tracker.track('plugin_opened');
    expect(tracker.pending()).toBe(0);
    run();
    tracker.flush();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends nothing from an unstamped build, whatever the switch says', () => {
    const { tracker, fetcher, run } = setup({ build: null });
    tracker.configure(true, INSTALL);
    tracker.track('plugin_opened');
    expect(tracker.pending()).toBe(0);
    run();
    tracker.flush();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a full batch at once and the rest on the next flush, never more than the cap', () => {
    const { tracker, fetcher, sent } = setup();
    tracker.configure(true, INSTALL);
    for (let i = 0; i < MAX_USAGE_BATCH + 3; i++) tracker.track('plugin_opened');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sent().body.events).toHaveLength(MAX_USAGE_BATCH);
    expect(tracker.pending()).toBe(3);
    tracker.flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sent(1).body.events).toHaveLength(3);
  });

  it('caps what it holds before the switch is known', () => {
    const { tracker } = setup();
    for (let i = 0; i < MAX_USAGE_QUEUE + 10; i++) tracker.track('plugin_opened');
    expect(tracker.pending()).toBe(MAX_USAGE_QUEUE);
  });

  it('never throws and never reports a send that fails', async () => {
    const rejecting = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { tracker } = setup({ fetcher: rejecting });
    tracker.configure(true, INSTALL);
    expect(() => { tracker.track('plugin_opened'); tracker.flush(); }).not.toThrow();
    await Promise.resolve();
    const throwing = vi.fn(() => { throw new Error('no network stack'); }) as unknown as UsageTrackerDeps['fetcher'];
    const second = setup({ fetcher: throwing });
    second.tracker.configure(true, INSTALL);
    expect(() => { second.tracker.track('plugin_opened'); second.tracker.flush(); }).not.toThrow();
    expect(second.tracker.pending()).toBe(0);
  });

  it('forgets the id when turned off, and takes the new one when turned on again', () => {
    const { tracker, sent } = setup();
    tracker.configure(true, INSTALL);
    tracker.configure(false, null);
    const next = `inst_${'f'.repeat(32)}`;
    tracker.configure(true, next);
    tracker.track('plugin_opened');
    tracker.flush();
    expect(sent().body.install).toBe(next);
  });
});

describe('trackUsage', () => {
  it('counts on the installed tracker, and nothing before one is installed', () => {
    setUsageTracker(null);
    expect(() => trackUsage('plugin_opened')).not.toThrow();
    const { tracker } = setup();
    setUsageTracker(tracker);
    trackUsage('copy_for_ai', { kind: 'foundation', detail: 'dtcg', bytes: 10 });
    expect(tracker.pending()).toBe(1);
    setUsageTracker(null);
  });
});

describe('mintInstallId', () => {
  it('is the shape the proxy accepts, from random bytes', () => {
    expect(mintInstallId((bytes) => bytes.fill(0xab))).toBe(`inst_${'ab'.repeat(16)}`);
    const id = mintInstallId();
    expect(id).toMatch(INSTALL_ID_RE);
    expect(mintInstallId()).not.toBe(id);
  });
});

describe('failureOutcome', () => {
  it('names the proxy code, an unreachable proxy, or a plain failure', () => {
    expect(failureOutcome(new ProseProxyError('quota_exhausted'))).toBe('quota_exhausted');
    expect(failureOutcome(new TypeError('Failed to fetch'))).toBe('unreachable');
    expect(failureOutcome(new Error('bad'))).toBe('failed');
  });
});

describe('link kinds', () => {
  it('names each product link without carrying its address', () => {
    expect(externalLinkKind(DOCS_URL)).toBe('docs');
    expect(externalLinkKind(`${DOCS_URL}quickstart/#publish-pull`)).toBe('docs');
    expect(externalLinkKind(SITE_URL)).toBe('site');
    expect(externalLinkKind(CHECKOUT_URL)).toBe('checkout');
    expect(externalLinkKind(MANAGE_SUB_URL)).toBe('manage');
    expect(externalLinkKind(SUPPORT_MAILTO)).toBe('support');
    expect(externalLinkKind('https://www.linkedin.com/in/someone/')).toBe('other');
    expect(licenseLinkKind('upgrade')).toBe('checkout');
    expect(licenseLinkKind('renew')).toBe('checkout');
    expect(licenseLinkKind('manage')).toBe('manage');
    expect(licenseLinkKind('support')).toBe('other');
  });
});
