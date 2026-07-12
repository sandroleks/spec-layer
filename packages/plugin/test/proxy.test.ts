import { describe, it, expect, vi } from 'vitest';
import type { ProxyQuota } from '@spec-layer/extractor';
import {
  authHeaders, fetchQuota, activateLicense, quotaMeterText, upsellText, PROXY_URL,
  effectiveAuth, resolveLicenseView, licenseStatusCopy, activationErrorCopy,
  generationErrorCopy, STOREFRONT_URL,
} from '../src/ui/proxy';

const proQuota: ProxyQuota = { tier: 'pro', used: 1, limit: null, remaining: null, resetsAt: '' };
const freeQuota: ProxyQuota = { tier: 'free', used: 2, limit: 10, remaining: 8, resetsAt: '' };

describe('authHeaders', () => {
  it('prefers the license key', () => {
    expect(authHeaders({ licenseKey: 'LK', figmaUserId: 'u1' })).toEqual({ Authorization: 'Bearer LK' });
  });
  it('falls back to the figma user id', () => {
    expect(authHeaders({ licenseKey: null, figmaUserId: 'u1' })).toEqual({ 'X-Figma-User': 'u1' });
  });
  it('returns null with no identity', () => {
    expect(authHeaders({ licenseKey: null, figmaUserId: null })).toBeNull();
  });
});

describe('fetchQuota', () => {
  it('GETs /v1/quota with auth and returns the snapshot', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '2026-08-10T00:00:00.000Z' }),
      { status: 200 },
    ));
    const q = await fetchQuota({ licenseKey: null, figmaUserId: 'u1' }, fetcher as unknown as typeof fetch);
    expect(q).toEqual({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '2026-08-10T00:00:00.000Z' });
    expect(fetcher).toHaveBeenCalledWith(`${PROXY_URL}/v1/quota`, { headers: { 'X-Figma-User': 'u1' } });
  });
  it('returns null with no identity (no network call)', async () => {
    const fetcher = vi.fn();
    expect(await fetchQuota({ licenseKey: null, figmaUserId: null }, fetcher as unknown as typeof fetch)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns null on network failure (meter simply hides)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchQuota({ licenseKey: null, figmaUserId: 'u1' }, fetcher as unknown as typeof fetch)).toBeNull();
  });
});

describe('activateLicense', () => {
  it('activates with an instance name when no instance id is stored yet', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ valid: true, status: 'active', instanceId: 'i1' }), { status: 200 },
    ));
    const out = await activateLicense('LK-1', null, fetcher as unknown as typeof fetch);
    expect(out).toEqual({ valid: true, status: 'active', instanceId: 'i1' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PROXY_URL}/v1/license/activate`);
    expect(JSON.parse(String(init.body))).toEqual({ key: 'LK-1', instanceName: 'Figma plugin' });
  });

  it('sends the stored instance id so the proxy revalidates instead of re-activating', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ valid: true, status: 'active', instanceId: 'i1' }), { status: 200 },
    ));
    await activateLicense('LK-1', 'i1', fetcher as unknown as typeof fetch);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ key: 'LK-1', instanceId: 'i1' });
  });
});

describe('effectiveAuth', () => {
  it('uses the key when active', () => {
    expect(effectiveAuth('LK', 'u1', true)).toEqual({ licenseKey: 'LK', figmaUserId: 'u1' });
  });
  it('uses the key when standing is still unknown (so the probe can run)', () => {
    expect(effectiveAuth('LK', 'u1', null)).toEqual({ licenseKey: 'LK', figmaUserId: 'u1' });
  });
  it('drops the inactive key back to the free identity', () => {
    expect(effectiveAuth('LK', 'u1', false)).toEqual({ licenseKey: null, figmaUserId: 'u1' });
  });
});

describe('resolveLicenseView', () => {
  it('none when no key is stored', () => {
    expect(resolveLicenseView(false, freeQuota)).toBe('none');
    expect(resolveLicenseView(false, null)).toBe('none');
  });
  it('pro when the live check says pro', () => {
    expect(resolveLicenseView(true, proQuota)).toBe('pro');
  });
  it('inactive on a definite free-tier response with a key stored', () => {
    expect(resolveLicenseView(true, freeQuota)).toBe('inactive');
  });
  it('unknown when the server is unreachable (null quota), never inactive', () => {
    expect(resolveLicenseView(true, null)).toBe('unknown');
  });
});

describe('licenseStatusCopy', () => {
  it('pro', () => expect(licenseStatusCopy('pro')).toBe('Pro plan active ✓'));
  it('none is empty', () => expect(licenseStatusCopy('none')).toBe(''));
  it('inactive invites a renewal', () => {
    expect(licenseStatusCopy('inactive')).toMatch(/isn't active right now/);
    expect(licenseStatusCopy('inactive')).toMatch(/Renew/);
  });
  it('unknown keeps the neutral saved copy (no false alarm)', () => {
    expect(licenseStatusCopy('unknown')).toBe('Your Pro key is saved.');
  });
});

describe('activationErrorCopy', () => {
  it('expired routes to the store, not support', () => {
    expect(activationErrorCopy('expired')).toMatch(/from the store/);
  });
  it('disabled routes to support', () => {
    expect(activationErrorCopy('disabled')).toMatch(/support/);
  });
  it('anything else reads as a wrong key', () => {
    expect(activationErrorCopy('invalid')).toMatch(/purchase email/);
    expect(activationErrorCopy('whatever')).toMatch(/purchase email/);
  });
  it('never leaks the raw status in parentheses (the old bug)', () => {
    for (const s of ['expired', 'disabled', 'invalid', 'inactive']) {
      expect(activationErrorCopy(s)).not.toContain(`(${s})`);
    }
  });
});

describe('generationErrorCopy', () => {
  it('rate_limited', () => expect(generationErrorCopy('rate_limited')).toMatch(/a minute/));
  it('generation_pending', () => expect(generationErrorCopy('generation_pending')).toMatch(/already generating/));
  it('other codes fall back to placeholders copy without leaking the code', () => {
    expect(generationErrorCopy('upstream')).toBe("AI didn't run this time, so placeholders were used.");
    expect(generationErrorCopy('bad_request')).not.toContain('bad_request');
  });
});

describe('STOREFRONT_URL', () => {
  it('points at the lemonsqueezy store front', () => {
    expect(STOREFRONT_URL).toMatch(/lemonsqueezy\.com/);
  });
});

describe('copy strings', () => {
  it('free meter text', () => {
    expect(quotaMeterText({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '' }))
      .toBe('17/20 AI generations left this month');
  });
  it('pro meter text', () => {
    expect(quotaMeterText({ tier: 'pro', used: 5, limit: null, remaining: null, resetsAt: '' }))
      .toBe('Pro plan active');
  });
  it('empty when quota unknown', () => {
    expect(quotaMeterText(null)).toBe('');
  });
  it('upsell text names the current month', () => {
    expect(upsellText(undefined, new Date('2026-07-15T00:00:00Z')))
      .toBe("You've used your free AI generations for July.");
  });
});
