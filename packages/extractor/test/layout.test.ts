import { describe, it, expect } from 'vitest';
import { extractLayout } from '../src/layout';
import { extractTokens } from '../src/tokens';
import button from './fixtures/button.json';
import type { SerializedNode, LayoutInfo } from '../src/tree';

/** A standalone COMPONENT carrying only the layout fields under test — no
 *  helper for this already existed in this file. */
function nodeWithLayout(layout: LayoutInfo): SerializedNode {
  return { id: '1', name: 'container', type: 'COMPONENT', visible: true, layout };
}

describe('extractLayout', () => {
  it('summarizes layout values per part from the default variant', () => {
    expect(extractLayout(button as SerializedNode)).toEqual([
      { part: 'container', path: 'Container/container',
        summary: 'horizontal, padding 10/24/10/24, gap 8', values: { gap: 8 } },
    ]);
  });

  it('returns an empty list when no layout data exists', () => {
    const bare: SerializedNode = { id: '1', name: 'X', type: 'COMPONENT', visible: true };
    expect(extractLayout(bare)).toEqual([]);
  });

  it('carries the numbers it renders into the sentence', () => {
    const out = extractLayout(nodeWithLayout({ mode: 'HORIZONTAL', itemSpacing: 8, cornerRadius: 4 }));
    expect(out[0].summary).toContain('radius 4');
    expect(out[0].values).toEqual({ radius: 4, gap: 8 });
  });

  it('omits a value the node does not declare', () => {
    const out = extractLayout(nodeWithLayout({ mode: 'HORIZONTAL', itemSpacing: 8 }));
    expect(out[0].values).toEqual({ gap: 8 });
  });

  // --- `path` must be the SAME identity a TokenRule carries ----------------

  it('builds every path in the vocabulary extractTokens uses', () => {
    // The whole point of the field is that validate.ts can join a layout entry
    // to the token bound on the same node. Building it in a vocabulary of its
    // own would make that join match nothing and quietly kill the rule in
    // production, so this asserts the identity against the real producer of
    // the other side rather than against a hand-written literal.
    const root = button as SerializedNode;
    const layoutPaths = extractLayout(root).map((l) => l.path);
    const tokenPaths = new Set(extractTokens(root).map((t) => t.path));
    expect(layoutPaths.length).toBeGreaterThan(0);
    for (const path of layoutPaths) expect([...tokenPaths]).toContain(path);
  });

  it('names a standalone component root after the component, not "Container"', () => {
    // Only a COMPONENT_SET root collapses to "Container" in this vocabulary,
    // and the check has to happen before defaultVariant unwraps the set: after
    // unwrapping, both cases are a COMPONENT.
    const out = extractLayout(nodeWithLayout({ mode: 'HORIZONTAL', itemSpacing: 8 }));
    expect(out[0].path).toBe('container');
  });

  it('keeps listing a hidden node, the visibility behaviour the prose prompt already had', () => {
    const root: SerializedNode = {
      id: '1', name: 'Card', type: 'COMPONENT', visible: true,
      children: [{
        id: '2', name: 'ghost', type: 'FRAME', visible: false,
        layout: { mode: 'VERTICAL', itemSpacing: 4 },
      }],
    };
    expect(extractLayout(root)).toEqual([
      { part: 'ghost', path: 'Card/ghost', summary: 'vertical, gap 4', values: { gap: 4 } },
    ]);
  });

  it('disambiguates duplicate siblings in path while part keeps the raw layer name', () => {
    // The asymmetry is deliberate. `part` is hashed by specContentHash, so
    // recomputing it through walkParts would move the content_hash of every
    // committed doc for a change that alters no rendered output. `path` is the
    // new identity and carries the disambiguation.
    const row = (id: string): SerializedNode => ({
      id, name: 'row#', type: 'FRAME', visible: true,
      layout: { mode: 'VERTICAL', itemSpacing: 4 },
    });
    const root: SerializedNode = {
      id: '1', name: 'Card', type: 'COMPONENT', visible: true,
      children: [row('2'), row('3')],
    };
    expect(extractLayout(root)).toEqual([
      { part: 'row#', path: 'Card/row', summary: 'vertical, gap 4', values: { gap: 4 } },
      { part: 'row#', path: 'Card/row (2)', summary: 'vertical, gap 4', values: { gap: 4 } },
    ]);
  });
});
