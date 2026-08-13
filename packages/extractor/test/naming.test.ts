import { describe, it, expect } from 'vitest';
import { parseVariantName, cleanPartName, cleanPropName } from '../src/naming';

describe('parseVariantName', () => {
  it('parses a well-formed combo', () => {
    expect(parseVariantName('Style=Filled, State=Enabled')).toEqual({ Style: 'Filled', State: 'Enabled' });
  });
  it('keeps "=" inside a value', () => {
    expect(parseVariantName('Label=a=b')).toEqual({ Label: 'a=b' });
  });
  it('returns null when a segment is not Axis=Value', () => {
    expect(parseVariantName('Filled')).toBeNull();
  });
});

describe('cleanPartName', () => {
  it('strips trailing prop-binding hashes', () => {
    expect(cleanPartName('icon-primary#')).toBe('icon-primary');
    expect(cleanPartName('icon ##  ')).toBe('icon');
  });
  it('leaves an interior hash alone', () => {
    expect(cleanPartName('icon#2')).toBe('icon#2');
  });
});

describe('cleanPropName', () => {
  it('drops the #nodeId:n suffix Figma appends to property names', () => {
    expect(cleanPropName('Label#123:4')).toBe('Label');
  });
  it('leaves a plain variant prop alone', () => {
    expect(cleanPropName('Size')).toBe('Size');
  });
  it('differs from cleanPartName, which only strips a TRAILING hash', () => {
    expect(cleanPropName('icon#2')).toBe('icon');
    expect(cleanPartName('icon#2')).toBe('icon#2');
  });
});
