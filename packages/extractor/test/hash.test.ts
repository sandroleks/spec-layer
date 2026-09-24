import { describe, it, expect } from 'vitest';
import { sha256 } from 'js-sha256';
import { contentHash, canonicalEqual, specHashProjection, extract } from '../src/index';
import type { SerializedNode } from '../src/index';

describe('contentHash', () => {
  it('orders keys by code unit, not by locale', () => {
    // 'B' (66) sorts before 'a' (97) by code unit; a locale sort puts 'a' first.
    expect(contentHash({ a: 1, B: 2 })).toBe(sha256('{"B":2,"a":1}'));
  });

  it('writes an undefined array member as null, as JSON.stringify does', () => {
    // canonical() emitted `[,1]` for [undefined, 1]: an empty slot no parser
    // reads back, and a different hash from the [null, 1] JSON.stringify writes.
    expect(contentHash([undefined, 1])).toBe(sha256('[null,1]'));
    expect(contentHash([undefined, 1])).toBe(contentHash([null, 1]));
    expect(canonicalEqual([undefined], [null])).toBe(true);
  });
});

describe('specHashProjection', () => {
  const node = {
    id: '1:1', name: 'Button', type: 'COMPONENT', visible: true,
    description: 'Primary action.', documentationLinks: ['https://example.com/button'],
    children: [{ id: '1:2', name: 'Label', type: 'TEXT', visible: true }],
  } as unknown as SerializedNode;

  it('includes the description because the Overview and header render it', () => {
    const projection = specHashProjection(extract(node, { figmaFile: 'F' }));
    expect(projection.description).toBe('Primary action.');
  });

  it('moves the hash when the description changes', () => {
    const a = contentHash(specHashProjection(extract(node, { figmaFile: 'F' })));
    const b = contentHash(specHashProjection(extract({ ...node, description: 'Edited.' }, { figmaFile: 'F' })));
    expect(a).not.toBe(b);
  });

  it('leaves the Figma file name and documentation links out, because nothing on canvas draws them', () => {
    // The facts strip that printed the file name and the links was removed
    // on 2026-09-18. Hashed implies rendered: keeping either in the projection
    // would flag a rename or a new link as drift the Update cannot show.
    const named = specHashProjection(extract(node, { figmaFile: 'F', figmaFileName: 'Design System' }));
    expect('figmaFileName' in named).toBe(false);
    expect('documentationLinks' in named).toBe(false);
  });

  it('keeps the hash still across a file rename and a documentation link change', () => {
    const named = contentHash(specHashProjection(extract(node, { figmaFile: 'F', figmaFileName: 'Design System' })));
    const renamed = contentHash(specHashProjection(extract(node, { figmaFile: 'F', figmaFileName: 'Design System (2026)' })));
    const unnamed = contentHash(specHashProjection(extract(node, { figmaFile: 'F' })));
    const unlinked = contentHash(specHashProjection(extract({ ...node, documentationLinks: [] } as unknown as SerializedNode, { figmaFile: 'F' })));
    expect(renamed).toBe(named);
    expect(unnamed).toBe(named);
    expect(unlinked).toBe(named);
  });

});
