import { describe, expect, it, vi } from 'vitest';
import { DriftPassResolvers, countSerializedNodes } from '../src/driftPass';
import type { NodeResolver } from '../src/serialize';
import type { SerializedNode } from '@spec-layer/extractor';

function base(): NodeResolver {
  return {
    variable: vi.fn(async (id: string) => ({ id, name: `var ${id}`, remote: false, collectionId: 'c1' })),
    style: vi.fn(async (id: string) => ({ id, name: `style ${id}`, remote: false, kind: 'paint-style' as const })),
    mainComponent: vi.fn(async () => ({ name: 'Main', key: 'k' })),
  };
}

describe('DriftPassResolvers', () => {
  it('shares one memo across requests of the same pass', async () => {
    const b = base();
    const passes = new DriftPassResolvers(b);
    await passes.forPass('p1').variable('a');
    await passes.forPass('p1').variable('a');
    expect(b.variable).toHaveBeenCalledTimes(1);
  });

  it('a new pass id starts a new memo', async () => {
    const b = base();
    const passes = new DriftPassResolvers(b);
    await passes.forPass('p1').variable('a');
    await passes.forPass('p2').variable('a');
    expect(b.variable).toHaveBeenCalledTimes(2);
  });

  it('reset drops the held memo', async () => {
    const b = base();
    const passes = new DriftPassResolvers(b);
    await passes.forPass('p1').variable('a');
    passes.reset();
    await passes.forPass('p1').variable('a');
    expect(b.variable).toHaveBeenCalledTimes(2);
  });
});

describe('countSerializedNodes', () => {
  it('counts the node and every descendant', () => {
    const leaf = (id: string): SerializedNode => ({ id, name: id, type: 'FRAME', visible: true });
    const tree: SerializedNode = {
      id: 'root', name: 'root', type: 'COMPONENT_SET', visible: true,
      children: [
        { ...leaf('a'), children: [leaf('a1'), leaf('a2')] },
        leaf('b'),
      ],
    };
    expect(countSerializedNodes(tree)).toBe(5);
    expect(countSerializedNodes(leaf('x'))).toBe(1);
  });
});
