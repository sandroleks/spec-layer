import { describe, it, expect } from 'vitest';
import { parseVariantName, cleanPartName, cleanPropName, walkParts, joinPath } from '../src/naming';

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

describe('joinPath', () => {
  it('joins segments with a slash', () => {
    expect(joinPath('Container', 'Label')).toBe('Container/Label');
  });
  it('escapes a literal slash so the path stays unambiguous', () => {
    // A layer really can be called "icon/left". Unescaped, its path is
    // indistinguishable from a layer "left" nested inside a layer "icon".
    expect(joinPath('Container', 'icon/left')).toBe('Container/icon\\/left');
  });
  it('returns the segment unchanged when there is no parent', () => {
    expect(joinPath('', 'Container')).toBe('Container');
  });
});

describe('walkParts paths', () => {
  const node = (name: string, children: unknown[] = []) =>
    ({ id: name, name, type: 'FRAME', visible: true, children } as never);

  it('hands each node its full path', () => {
    const seen: string[] = [];
    walkParts(
      node('Container', [node('iconLeft'), node('ButtonLabel', [node('Label')])]),
      'Container',
      (_n, _part, path) => seen.push(path),
    );
    expect(seen).toEqual([
      'Container', 'Container/iconLeft', 'Container/ButtonLabel', 'Container/ButtonLabel/Label',
    ]);
  });

  it('disambiguates same-named siblings inside the path', () => {
    const seen: string[] = [];
    walkParts(node('Container', [node('icon'), node('icon')]), 'Container',
      (_n, _part, path) => seen.push(path));
    expect(seen).toEqual(['Container', 'Container/icon', 'Container/icon (2)']);
  });

  it('distinguishes the same leaf name in two subtrees', () => {
    const seen: string[] = [];
    walkParts(
      node('Root', [node('header', [node('label')]), node('footer', [node('label')])]),
      'Root',
      (_n, _part, path) => seen.push(path),
    );
    expect(seen).toContain('Root/header/label');
    expect(seen).toContain('Root/footer/label');
  });
});
