import { describe, it, expect, vi } from 'vitest';
import type { ProxyQuota } from '@spec-layer/extractor';
import {
  authHeaders, fetchQuota, activateLicense, deactivateLicense, PROXY_URL,
  effectiveAuth, generationErrorCopy, STOREFRONT_URL, isQuotaExhausted,
} from '../src/ui/proxy';

describe('authHeaders', () => {
  it('prefers the license key', () => {
    expect(authHeaders({ licenseKey: 'LK', licenseInstanceId: null, figmaUserId: 'u1' })).toEqual({ Authorization: 'Bearer LK' });
  });
  it('falls back to the figma user id', () => {
    expect(authHeaders({ licenseKey: null, licenseInstanceId: null, figmaUserId: 'u1' })).toEqual({ 'X-Figma-User': 'u1' });
  });
  it('returns null with no identity', () => {
    expect(authHeaders({ licenseKey: null, licenseInstanceId: null, figmaUserId: null })).toBeNull();
  });
});

describe('instance-aware auth', () => {
  it('sends key:instanceId in the bearer when an instance is known', () => {
    expect(authHeaders({ licenseKey: 'LK', licenseInstanceId: 'i1', figmaUserId: 'u1' }))
      .toEqual({ Authorization: 'Bearer LK:i1' });
  });
  it('falls back to the bare key without an instance', () => {
    expect(authHeaders({ licenseKey: 'LK', licenseInstanceId: null, figmaUserId: 'u1' }))
      .toEqual({ Authorization: 'Bearer LK' });
  });
});

describe('fetchQuota', () => {
  it('GETs /v1/quota with auth and returns the snapshot', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '2026-08-10T00:00:00.000Z' }),
      { status: 200 },
    ));
    const q = await fetchQuota({ licenseKey: null, licenseInstanceId: null, figmaUserId: 'u1' }, fetcher as unknown as typeof fetch);
    expect(q).toEqual({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '2026-08-10T00:00:00.000Z' });
    expect(fetcher).toHaveBeenCalledWith(`${PROXY_URL}/v1/quota`, { headers: { 'X-Figma-User': 'u1' } });
  });
  it('returns null with no identity (no network call)', async () => {
    const fetcher = vi.fn();
    expect(await fetchQuota({ licenseKey: null, licenseInstanceId: null, figmaUserId: null }, fetcher as unknown as typeof fetch)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns null on network failure (meter simply hides)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchQuota({ licenseKey: null, licenseInstanceId: null, figmaUserId: 'u1' }, fetcher as unknown as typeof fetch)).toBeNull();
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

describe('activateLicense error handling', () => {
  it('throws on a non-ok proxy response instead of returning a bogus verdict', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'ls_unreachable' }), { status: 502 }));
    await expect(activateLicense('LK', null, fetcher as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('deactivateLicense', () => {
  it('POSTs to /v1/license/deactivate and reports the outcome', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ deactivated: true }), { status: 200 }));
    expect(await deactivateLicense('LK', 'i1', fetcher as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PROXY_URL}/v1/license/deactivate`);
    expect(JSON.parse(String(init.body))).toEqual({ key: 'LK', instanceId: 'i1' });
  });
  it('returns false on any failure (best-effort)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    expect(await deactivateLicense('LK', 'i1', fetcher as unknown as typeof fetch)).toBe(false);
  });
});

describe('effectiveAuth', () => {
  it('uses the key when active', () => {
    expect(effectiveAuth('LK', 'i1', 'u1', true)).toEqual({ licenseKey: 'LK', licenseInstanceId: 'i1', figmaUserId: 'u1' });
  });
  it('uses the key when standing is still unknown (so the probe can run)', () => {
    expect(effectiveAuth('LK', 'i1', 'u1', null)).toEqual({ licenseKey: 'LK', licenseInstanceId: 'i1', figmaUserId: 'u1' });
  });
  it('drops the inactive key back to the free identity', () => {
    expect(effectiveAuth('LK', 'i1', 'u1', false)).toEqual({ licenseKey: null, licenseInstanceId: null, figmaUserId: 'u1' });
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

describe('isQuotaExhausted', () => {
  const q = (over: Partial<ProxyQuota>): ProxyQuota =>
    ({ tier: 'free', used: 0, limit: 20, remaining: 20, resetsAt: '', ...over });

  it('is false for a null quota (offline / unknown)', () => {
    expect(isQuotaExhausted(null)).toBe(false);
  });
  it('is false for pro regardless of counts', () => {
    expect(isQuotaExhausted({ tier: 'pro', used: 999, limit: null, remaining: null, resetsAt: '' })).toBe(false);
  });
  it('is false when free generations remain', () => {
    expect(isQuotaExhausted(q({ remaining: 1 }))).toBe(false);
  });
  it('is true when the free allowance is used up', () => {
    expect(isQuotaExhausted(q({ used: 20, remaining: 0 }))).toBe(true);
  });
  it('falls back to used/limit when remaining is null', () => {
    expect(isQuotaExhausted(q({ used: 20, limit: 20, remaining: null }))).toBe(true);
    expect(isQuotaExhausted(q({ used: 5, limit: 20, remaining: null }))).toBe(false);
  });
});
