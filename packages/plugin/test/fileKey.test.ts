import { describe, it, expect } from 'vitest';
import { resolveFileKey } from '../src/fileKey';

describe('resolveFileKey', () => {
  it('reports an automatically detected file key', () => {
    expect(resolveFileKey('REALKEY', 'OVERRIDE')).toEqual({
      fileKey: 'REALKEY',
      source: 'figma',
    });
  });

  it('reports a manually supplied fallback key', () => {
    expect(resolveFileKey(undefined, 'OVERRIDE')).toEqual({
      fileKey: 'OVERRIDE',
      source: 'override',
    });
  });

  it('reports a missing source', () => {
    expect(resolveFileKey(undefined, null)).toEqual({
      fileKey: 'unknown',
      source: 'missing',
    });
  });
});
