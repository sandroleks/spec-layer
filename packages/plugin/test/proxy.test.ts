import { describe, it, expect, vi } from 'vitest';
import {
  authHeaders, fetchQuota, activateLicense, quotaMeterText, upsellText, PROXY_URL,
} from '../src/ui/proxy';

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
  it('POSTs the key and returns the result', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ valid: true, status: 'active', instanceId: 'i1' }), { status: 200 },
    ));
    const out = await activateLicense('LK-1', fetcher as unknown as typeof fetch);
    expect(out).toEqual({ valid: true, status: 'active', instanceId: 'i1' });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PROXY_URL}/v1/license/activate`);
    expect(JSON.parse(String(init.body))).toEqual({ key: 'LK-1', instanceName: 'Figma plugin' });
  });
});

describe('copy strings', () => {
  it('free meter text', () => {
    expect(quotaMeterText({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '' }))
      .toBe('17/20 AI generations left this month');
  });
  it('pro meter text', () => {
    expect(quotaMeterText({ tier: 'pro', used: 5, limit: null, remaining: null, resetsAt: '' }))
      .toBe('Pro — unlimited AI');
  });
  it('empty when quota unknown', () => {
    expect(quotaMeterText(null)).toBe('');
  });
  it('upsell text names the current month', () => {
    expect(upsellText(undefined, new Date('2026-07-15T00:00:00Z')))
      .toBe("You've used your free AI generations for July.");
  });
});
