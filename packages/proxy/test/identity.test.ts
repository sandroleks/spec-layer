import { describe, it, expect } from 'vitest';
import { hashFigmaId, identityFromHeaders, callerProofs } from '../src/identity';

describe('identity', () => {
  it('hashes a figma id with the salt (stable, salt-sensitive)', () => {
    const a = hashFigmaId('user-123', 'salt-A');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFigmaId('user-123', 'salt-A')).toBe(a);
    expect(hashFigmaId('user-123', 'salt-B')).not.toBe(a);
  });

  it('prefers the license header when both are present', () => {
    const h = new Headers({ Authorization: 'Bearer key-1', 'X-Figma-User': 'u1' });
    expect(identityFromHeaders(h, 's')).toEqual({ kind: 'license', key: 'key-1', instanceId: null });
  });

  it('splits key:instanceId bearers', () => {
    expect(identityFromHeaders(new Headers({ Authorization: 'Bearer KEY:inst-9' }), 's'))
      .toEqual({ kind: 'license', key: 'KEY', instanceId: 'inst-9' });
  });

  it('bare key bearers carry a null instanceId (legacy clients)', () => {
    expect(identityFromHeaders(new Headers({ Authorization: 'Bearer KEY' }), 's'))
      .toEqual({ kind: 'license', key: 'KEY', instanceId: null });
  });

  it('falls back to a hashed free identity', () => {
    const h = new Headers({ 'X-Figma-User': 'u1' });
    const id = identityFromHeaders(h, 's');
    expect(id).toEqual({ kind: 'free', id: hashFigmaId('u1', 's') });
  });

  it('returns null with no auth headers or empty values', () => {
    expect(identityFromHeaders(new Headers(), 's')).toBeNull();
    expect(identityFromHeaders(new Headers({ Authorization: 'Bearer ' }), 's')).toBeNull();
    expect(identityFromHeaders(new Headers({ 'X-Figma-User': '' }), 's')).toBeNull();
  });
});

describe('callerProofs', () => {
  it('returns both proofs when both headers are present', () => {
    const h = new Headers({ Authorization: 'Bearer KEY:inst-9', 'X-Figma-User': 'u1' });
    expect(callerProofs(h, 's')).toEqual({
      license: { key: 'KEY', instanceId: 'inst-9' },
      figmaHash: hashFigmaId('u1', 's'),
    });
  });

  it('returns only the license with a bare bearer', () => {
    expect(callerProofs(new Headers({ Authorization: 'Bearer KEY' }), 's'))
      .toEqual({ license: { key: 'KEY', instanceId: null }, figmaHash: null });
  });

  it('returns only the figma hash with no bearer', () => {
    expect(callerProofs(new Headers({ 'X-Figma-User': 'u1' }), 's'))
      .toEqual({ license: null, figmaHash: hashFigmaId('u1', 's') });
  });

  it('returns no proofs for empty headers', () => {
    expect(callerProofs(new Headers(), 's')).toEqual({ license: null, figmaHash: null });
    expect(callerProofs(new Headers({ Authorization: 'Bearer ', 'X-Figma-User': ' ' }), 's'))
      .toEqual({ license: null, figmaHash: null });
  });
});
