import { describe, it, expect } from 'vitest';
import { extractLayout } from '../src/layout';
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
      { part: 'container', summary: 'horizontal, padding 10/24/10/24, gap 8', values: { gap: 8 } },
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
});
