import { describe, it, expect, vi } from 'vitest';
import { isLibraryId } from '../src/ui/proxy';
import { fetchVersionLog } from '../src/ui/history';
import { rotatePullKey } from '../src/ui/publish';
import type { ProxyAuth } from '../src/ui/proxy';

// The id is interpolated into the request path while the caller's key travels
// in the Authorization header, so an id that escapes the path would address a
// different host and hand it that key. Both callers refuse before fetching.

const VALID = 'lib_0123456789abcdef01234567';
const auth: ProxyAuth = { licenseKey: 'k', licenseInstanceId: null, figmaUserId: null };

describe('isLibraryId', () => {
  it('accepts exactly the shape the proxy issues', () => {
    expect(isLibraryId(VALID)).toBe(true);
  });

  it('rejects anything that could steer the request elsewhere', () => {
    for (const bad of [
      '',
      'lib_0123456789abcdef0123456',      // one short
      'lib_0123456789abcdef012345678',    // one long
      'lib_0123456789ABCDEF01234567',     // uppercase hex
      'lib_0123456789abcdef01234567/..',
      '../../v1/quota',
      'https://evil.example/lib_0123456789abcdef01234567',
      'lib_0123456789abcdef01234567?x=1',
      'lib_0123456789abcdef01234567#f',
    ]) {
      expect(isLibraryId(bad), bad).toBe(false);
    }
  });
});

describe('the guard on each caller', () => {
  it('fetchVersionLog refuses a bad id without making a request', async () => {
    const fetcher = vi.fn();
    const res = await fetchVersionLog({
      libraryId: 'https://evil.example/x', pullKey: 'p', etag: null,
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(res.kind).toBe('error');
  });

  it('rotatePullKey refuses a bad id without making a request', async () => {
    const fetcher = vi.fn();
    const res = await rotatePullKey(
      '../../v1/quota', auth, fetcher as unknown as typeof fetch, 'p',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(res.kind).toBe('error');
  });

  it('still reaches the fetcher for a valid id', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ v: 1, records: [] }), { status: 200 }),
    );
    const res = await fetchVersionLog({
      libraryId: VALID, pullKey: 'p', etag: null,
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(res.kind).toBe('ok');
  });
});
