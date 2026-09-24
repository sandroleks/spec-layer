import { describe, it, expect } from 'vitest';
import { resolveRegistrySections, pageOf } from '../src/registryNodes';

type Fake = { id: string; type: string; parent?: Fake | null; name?: string };
const section = (id: string): Fake => ({ id, type: 'SECTION', parent: null });
const asNode = (n: Fake): BaseNode => n as unknown as BaseNode;

/**
 * A lookup whose reads settle only when the test says so. `asked` records the
 * order the reads were issued in, which is how the test proves they were all
 * in flight before any of them resolved.
 */
function deferredLookup(nodes: Record<string, Fake | null | Error>) {
  const pending: Array<() => void> = [];
  const asked: string[] = [];
  const lookup = {
    getNodeByIdAsync: (id: string) => new Promise<BaseNode | null>((resolve, reject) => {
      asked.push(id);
      pending.push(() => {
        const n = nodes[id];
        if (n instanceof Error) reject(n);
        else resolve(n ? asNode(n) : null);
      });
    }),
  };
  return { lookup, asked, settle: () => pending.splice(0).forEach((f) => f()) };
}

describe('resolveRegistrySections', () => {
  it('issues every read before any settles and keeps registry order', async () => {
    const { lookup, asked, settle } = deferredLookup({ a: section('a'), b: section('b'), c: section('c') });
    const result = resolveRegistrySections(['c', 'a', 'b'], lookup);
    expect(asked).toEqual(['c', 'a', 'b']);
    settle();
    expect((await result).sections.map((r) => r.docId)).toEqual(['c', 'a', 'b']);
  });

  it('drops a null and a non-Section from `sections` without failing the rest, and reports a rejected read separately', async () => {
    const { lookup, settle } = deferredLookup({
      a: section('a'),
      gone: null,
      frame: { id: 'frame', type: 'FRAME' },
      bad: new Error('page not loaded'),
      z: section('z'),
    });
    const result = resolveRegistrySections(['a', 'gone', 'frame', 'bad', 'z'], lookup);
    settle();
    const { sections, rejected } = await result;
    expect(sections.map((r) => r.docId)).toEqual(['a', 'z']);
    // 'bad' rejected: it is evidence-free, unlike 'gone' and 'frame', which
    // resolved and are simply not Sections. It appears in `rejected`, not in
    // `sections`, and nowhere near 'gone' or 'frame'.
    expect(rejected).toEqual(['bad']);
  });

  it('resolves to an empty list for an empty registry without touching the lookup', async () => {
    const { lookup, asked } = deferredLookup({});
    expect(await resolveRegistrySections([], lookup)).toEqual({ sections: [], rejected: [] });
    expect(asked).toEqual([]);
  });
});

describe('pageOf', () => {
  it('walks up to the page and returns null when there is none', () => {
    const page: Fake = { id: 'p', type: 'PAGE', name: 'Docs' };
    const frame: Fake = { id: 'f', type: 'FRAME', parent: page };
    const text: Fake = { id: 't', type: 'TEXT', parent: frame };
    expect(pageOf(asNode(text))?.name).toBe('Docs');
    expect(pageOf(asNode({ id: 'loose', type: 'FRAME', parent: null }))).toBeNull();
  });
});
