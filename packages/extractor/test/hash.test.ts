import { describe, it, expect } from 'vitest';
import { sha256 } from 'js-sha256';
import { contentHash, specHashProjection, extract } from '../src/index';
import type { SerializedNode } from '../src/index';

describe('contentHash', () => {
  it('orders keys by code unit, not by locale', () => {
    // 'B' (66) sorts before 'a' (97) by code unit; a locale sort puts 'a' first.
    expect(contentHash({ a: 1, B: 2 })).toBe(sha256('{"B":2,"a":1}'));
  });
});

describe('specHashProjection', () => {
  const node = {
    id: '1:1', name: 'Button', type: 'COMPONENT', visible: true,
    description: 'Primary action.', documentationLinks: ['https://example.com/button'],
    children: [{ id: '1:2', name: 'Label', type: 'TEXT', visible: true }],
  } as unknown as SerializedNode;

  it('includes the description and documentation links because both are rendered', () => {
    const projection = specHashProjection(extract(node, { figmaFile: 'F' }));
    expect(projection.description).toBe('Primary action.');
    expect(projection.documentationLinks).toEqual(['https://example.com/button']);
  });

  it('moves the hash when the description changes', () => {
    const a = contentHash(specHashProjection(extract(node, { figmaFile: 'F' })));
    const b = contentHash(specHashProjection(extract({ ...node, description: 'Edited.' }, { figmaFile: 'F' })));
    expect(a).not.toBe(b);
  });
});
