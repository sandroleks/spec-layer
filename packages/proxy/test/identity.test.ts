import { describe, it, expect } from 'vitest';
import { hashFigmaId, identityFromHeaders } from '../src/identity';

describe('identity', () => {
  it('hashes a figma id with the salt (stable, salt-sensitive)', () => {
    const a = hashFigmaId('user-123', 'salt-A');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFigmaId('user-123', 'salt-A')).toBe(a);
    expect(hashFigmaId('user-123', 'salt-B')).not.toBe(a);
  });

  it('prefers the license header when both are present', () => {
    const h = new Headers({ Authorization: 'Bearer key-1', 'X-Figma-User': 'u1' });
    expect(identityFromHeaders(h, 's')).toEqual({ kind: 'license', key: 'key-1' });
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
