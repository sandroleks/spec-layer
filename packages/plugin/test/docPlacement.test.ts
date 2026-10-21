import { describe, it, expect } from 'vitest';
import {
  hostAbove, boxIn, spotNear, spotBeside, spotInPlace, spotNearPrior,
  spotRightOfAll, firstSpot, applySpot, type DocSpot,
} from '../src/docPlacement';
import { DOC_LINK_KEY } from '../src/docLink';

/**
 * Just enough of a Figma node tree for placement: local x and y relative to
 * the parent (a page's children are absolute), an absoluteBoundingBox summed
 * up the chain, plugin data, appendChild and resizeWithoutConstraints.
 */
class Fake {
  parent: Fake | null = null;
  children: Fake[] = [];
  visible = true;
  locked = false;
  private data: Record<string, string> = {};
  constructor(
    public id: string, public type: string,
    public x = 0, public y = 0, public width = 0, public height = 0,
  ) {}
  get absoluteBoundingBox() {
    if (this.type === 'PAGE' || this.type === 'DOCUMENT') return null;
    let ax = this.x, ay = this.y;
    for (let p = this.parent; p && p.type !== 'PAGE'; p = p.parent) { ax += p.x; ay += p.y; }
    return { x: ax, y: ay, width: this.width, height: this.height };
  }
  getPluginData(key: string): string { return this.data[key] ?? ''; }
  setPluginData(key: string, value: string): void { this.data[key] = value; }
  appendChild(child: Fake): void {
    if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child);
    child.parent = this;
    this.children.push(child);
  }
  resizeWithoutConstraints(width: number, height: number): void { this.width = width; this.height = height; }
}

function page(): Fake {
  const doc = new Fake('doc', 'DOCUMENT');
  const p = new Fake('page', 'PAGE');
  doc.appendChild(p);
  return p;
}
function add(parent: Fake, child: Fake): Fake { parent.appendChild(child); return child; }
const node = <T>(f: Fake): T => f as unknown as T;
const none = new Set<string>();

describe('hostAbove', () => {
  it('hosts a component on a page in the page', () => {
    const p = page();
    const c = add(p, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: p, anchor: c });
  });

  it('hosts a component in a Section in that Section', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION'));
    const c = add(s, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: s, anchor: c });
  });

  it('anchors a component inside a frame on the frame', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION'));
    const f = add(s, new Fake('f', 'FRAME'));
    const c = add(f, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: s, anchor: f });
  });

  it('anchors a variant on the highest ancestor below the host', () => {
    const p = page();
    const f = add(p, new Fake('f', 'FRAME'));
    const set = add(f, new Fake('set', 'COMPONENT_SET'));
    const v = add(set, new Fake('v', 'COMPONENT'));
    expect(hostAbove(node(v))).toEqual({ host: p, anchor: f });
  });

  it('never nests in a Spec Layer doc Section', () => {
    const p = page();
    const doc = add(p, new Fake('doc1', 'SECTION'));
    doc.setPluginData(DOC_LINK_KEY, '{"v":1}');
    const c = add(doc, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: p, anchor: doc });
  });

  it('never nests in a locked Section, and anchors on it in the page', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION'));
    s.locked = true;
    const c = add(s, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: p, anchor: s });
  });

  it('never nests in a hidden Section, and anchors on it in the page', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION'));
    s.visible = false;
    const c = add(s, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: p, anchor: s });
  });

  it('never nests in an unlocked Section inside a locked one, which Figma locks too', () => {
    const p = page();
    const outer = add(p, new Fake('outer', 'SECTION'));
    outer.locked = true;
    const inner = add(outer, new Fake('inner', 'SECTION'));
    const c = add(inner, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: p, anchor: outer });
  });

  it('nests in the inner of two usable Sections', () => {
    const p = page();
    const outer = add(p, new Fake('outer', 'SECTION'));
    const inner = add(outer, new Fake('inner', 'SECTION'));
    const c = add(inner, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: inner, anchor: c });
  });

  it('nests in a usable Section above a locked one', () => {
    const p = page();
    const outer = add(p, new Fake('outer', 'SECTION'));
    const inner = add(outer, new Fake('inner', 'SECTION'));
    inner.locked = true;
    const c = add(inner, new Fake('c', 'COMPONENT'));
    expect(hostAbove(node(c))).toEqual({ host: outer, anchor: inner });
  });

  it('has no host for a detached node or a page', () => {
    expect(hostAbove(node(new Fake('c', 'COMPONENT')))).toBeNull();
    expect(hostAbove(node(page()))).toBeNull();
  });
});

describe('boxIn', () => {
  it('reads a nested node in its host Section space', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 4000, 2000, 2000, 1000));
    const c = add(s, new Fake('c', 'COMPONENT', 100, 100, 200, 100));
    expect(boxIn(node(s), node(c))).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    expect(boxIn(node(p), node(c))).toEqual({ x: 4100, y: 2100, width: 200, height: 100 });
  });
});

describe('spotBeside', () => {
  it('places a doc beside a component nested in a Section, in Section space', () => {
    // The old code read the component's local x and y and put the doc on the
    // page, so this doc landed near the page origin, thousands of px away.
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 4000, 2000, 2000, 1000));
    const c = add(s, new Fake('c', 'COMPONENT', 100, 100, 200, 100));
    expect(spotBeside(node(c), { width: 500, height: 300 }, none))
      .toEqual({ host: s, x: 380, y: 100, grow: null });
  });

  it('goes below a page-level component when a neighbour blocks the right side', () => {
    const p = page();
    const c = add(p, new Fake('c', 'COMPONENT', 0, 0, 200, 100));
    add(p, new Fake('n', 'FRAME', 300, 0, 100, 100));
    expect(spotBeside(node(c), { width: 500, height: 300 }, none))
      .toEqual({ host: p, x: 0, y: 180, grow: null });
  });

  it('ignores excluded nodes, such as the doc being placed', () => {
    const p = page();
    const c = add(p, new Fake('c', 'COMPONENT', 1000, 0, 200, 100));
    add(p, new Fake('new', 'SECTION', 1280, 0, 500, 300));
    expect(spotBeside(node(c), { width: 500, height: 300 }, new Set(['new'])))
      .toEqual({ host: p, x: 1280, y: 0, grow: null });
  });

  it('grows a full Section when its growth is clear', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 4000, 2000, 600, 400));
    const c = add(s, new Fake('c', 'COMPONENT', 64, 64, 400, 200));
    expect(spotBeside(node(c), { width: 500, height: 300 }, none))
      .toEqual({ host: s, x: 544, y: 64, grow: { width: 1108, height: 428 } });
  });

  it('goes up a level, beside the Section, when growing it would hit a neighbour', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 4000, 2000, 600, 400));
    const c = add(s, new Fake('c', 'COMPONENT', 64, 64, 400, 200));
    add(p, new Fake('b', 'SECTION', 4700, 2000, 300, 400));
    expect(spotBeside(node(c), { width: 500, height: 300 }, none))
      .toEqual({ host: p, x: 4000, y: 2480, grow: null });
  });

  it('stays inside by growing down when growing right would hit a neighbour', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 600, 400));
    const c = add(s, new Fake('c', 'COMPONENT', 64, 64, 400, 200));
    add(p, new Fake('b', 'SECTION', 700, 0, 300, 400));
    expect(spotBeside(node(c), { width: 300, height: 200 }, none))
      .toEqual({ host: s, x: 64, y: 344, grow: { width: 600, height: 608 } });
  });

  it('goes up a level when growing right and growing down are both blocked', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 600, 400));
    const c = add(s, new Fake('c', 'COMPONENT', 64, 64, 400, 200));
    const b = add(p, new Fake('b', 'SECTION', 700, 0, 300, 400));
    const below = add(p, new Fake('below', 'SECTION', 0, 500, 600, 300));
    const spot = spotBeside(node(c), { width: 300, height: 200 }, none);
    // Left of S is the nearest clear spot on the page.
    expect(spot).toEqual({ host: p, x: -380, y: 0, grow: null });
    const doc = add(p, new Fake('doc', 'SECTION', 0, 0, 300, 200));
    applySpot(node(doc), spot as DocSpot);
    expect([s.width, s.height, b.width, b.height, below.width, below.height])
      .toEqual([600, 400, 300, 400, 600, 300]);
  });

  it('grows a Section nested in a Section when its growth stays inside the outer one', () => {
    const p = page();
    const outer = add(p, new Fake('outer', 'SECTION', 0, 0, 3000, 3000));
    const s = add(outer, new Fake('s', 'SECTION', 64, 64, 600, 400));
    const c = add(s, new Fake('c', 'COMPONENT', 64, 64, 400, 200));
    expect(spotBeside(node(c), { width: 500, height: 300 }, none))
      .toEqual({ host: s, x: 544, y: 64, grow: { width: 1108, height: 428 } });
  });

  it('goes up to the outer Section, and grows it, when the inner would leave it', () => {
    const p = page();
    const outer = add(p, new Fake('outer', 'SECTION', 0, 0, 800, 600));
    const s = add(outer, new Fake('s', 'SECTION', 64, 64, 600, 400));
    const c = add(s, new Fake('c', 'COMPONENT', 64, 64, 400, 200));
    expect(spotBeside(node(c), { width: 500, height: 300 }, none))
      .toEqual({ host: outer, x: 744, y: 64, grow: { width: 1308, height: 600 } });
  });

  it('places beside a locked Section on the page, never inside it', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 2000, 2000));
    s.locked = true;
    const c = add(s, new Fake('c', 'COMPONENT', 64, 64, 400, 200));
    expect(spotBeside(node(c), { width: 500, height: 300 }, none))
      .toEqual({ host: p, x: 2080, y: 0, grow: null });
  });

  it('has no spot for a detached source', () => {
    expect(spotBeside(node(new Fake('c', 'COMPONENT')), { width: 10, height: 10 }, none)).toBeNull();
  });
});

describe('spotNear', () => {
  it('places beside a free anchor on a page', () => {
    const p = page();
    expect(spotNear(node(p), { x: 500, y: 500, width: 0, height: 0 }, { width: 100, height: 100 }, none))
      .toEqual({ host: p, x: 580, y: 500, grow: null });
  });

  it('fails, rather than seeing no obstacles, when the host Section has no bounds', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 2000, 2000));
    add(s, new Fake('n', 'FRAME', 344, 64, 100, 100));
    Object.defineProperty(s, 'absoluteBoundingBox', { get: () => null });
    expect(() => spotNear(node(s), { x: 64, y: 64, width: 200, height: 100 }, { width: 300, height: 200 }, none))
      .toThrow();
  });
});

describe('spotInPlace', () => {
  it('keeps the old spot when the rebuilt doc still overlaps nothing', () => {
    const p = page();
    const prior = add(p, new Fake('prior', 'SECTION', 0, 0, 400, 200));
    add(p, new Fake('n', 'FRAME', 600, 0, 100, 100));
    expect(spotInPlace(node(prior), { width: 500, height: 200 }, new Set(['prior'])))
      .toEqual({ host: p, x: 0, y: 0, grow: null });
  });

  it('keeps a doc placed by hand closer than GAP to a neighbour', () => {
    const p = page();
    const prior = add(p, new Fake('prior', 'SECTION', 0, 0, 400, 200));
    add(p, new Fake('n', 'FRAME', 440, 0, 100, 100));
    expect(spotInPlace(node(prior), { width: 400, height: 200 }, new Set(['prior']))).not.toBeNull();
  });

  it('gives up the old spot when the rebuilt doc grows into a neighbour', () => {
    const p = page();
    const prior = add(p, new Fake('prior', 'SECTION', 0, 0, 400, 200));
    add(p, new Fake('n', 'FRAME', 600, 0, 100, 100));
    expect(spotInPlace(node(prior), { width: 700, height: 200 }, new Set(['prior']))).toBeNull();
  });

  it('keeps the parent Section, and gives up the spot when the doc would leave it', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 1000, 1000));
    const prior = add(s, new Fake('prior', 'SECTION', 100, 100, 400, 200));
    expect(spotInPlace(node(prior), { width: 800, height: 200 }, new Set(['prior'])))
      .toEqual({ host: s, x: 100, y: 100, grow: null });
    expect(spotInPlace(node(prior), { width: 950, height: 200 }, new Set(['prior']))).toBeNull();
  });

  it('reads siblings in Section space, and gives up the spot when the doc would overlap one', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 4000, 2000, 2000, 1000));
    const prior = add(s, new Fake('prior', 'SECTION', 100, 100, 400, 200));
    add(s, new Fake('n', 'FRAME', 600, 100, 100, 100));
    expect(spotInPlace(node(prior), { width: 500, height: 200 }, new Set(['prior'])))
      .toEqual({ host: s, x: 100, y: 100, grow: null });
    expect(spotInPlace(node(prior), { width: 600, height: 200 }, new Set(['prior']))).toBeNull();
  });

  it('keeps a doc the user put in a locked Section there', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 1000, 1000));
    s.locked = true;
    const prior = add(s, new Fake('prior', 'SECTION', 100, 100, 400, 200));
    expect(spotInPlace(node(prior), { width: 400, height: 200 }, new Set(['prior'])))
      .toEqual({ host: s, x: 100, y: 100, grow: null });
  });

  it('has no spot for a detached doc', () => {
    expect(spotInPlace(node(new Fake('prior', 'SECTION')), { width: 1, height: 1 }, none)).toBeNull();
  });
});

describe('spotNearPrior', () => {
  it('slides the old origin down when that moves the doc least', () => {
    const p = page();
    const prior = add(p, new Fake('prior', 'SECTION', 0, 0, 300, 100));
    add(p, new Fake('n', 'FRAME', 300, 0, 100, 100));
    expect(spotNearPrior(node(prior), { width: 400, height: 100 }, new Set(['prior'])))
      .toEqual({ host: p, x: 0, y: 180, grow: null });
  });

  it('goes up a level, beside its Section, when that Section cannot grow', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 600, 400));
    const prior = add(s, new Fake('prior', 'SECTION', 64, 64, 400, 200));
    add(p, new Fake('b', 'SECTION', 700, 0, 300, 400));
    add(p, new Fake('below', 'SECTION', 0, 500, 600, 300));
    expect(spotNearPrior(node(prior), { width: 500, height: 300 }, new Set(['prior'])))
      .toEqual({ host: p, x: -580, y: 0, grow: null });
  });
});

describe('firstSpot and spotRightOfAll', () => {
  const spot = (host: Fake, x: number): DocSpot => ({ host: node(host), x, y: 0, grow: null });

  it('takes the first attempt that returns a spot, skipping nulls and throws', () => {
    const p = page();
    const picked = firstSpot(node(p), none, [
      () => null,
      () => { throw new Error('read failed'); },
      () => spot(p, 7),
      () => spot(p, 9),
    ]);
    expect(picked.x).toBe(7);
  });

  it('falls back to right of every child of the page', () => {
    const p = page();
    add(p, new Fake('a', 'FRAME', 0, 0, 100, 100));
    add(p, new Fake('b', 'FRAME', 200, -50, 100, 100));
    add(p, new Fake('new', 'SECTION', 5000, 5000, 100, 100));
    expect(firstSpot(node(p), new Set(['new']), [() => null]))
      .toEqual({ host: p, x: 380, y: -50, grow: null });
    expect(spotRightOfAll(node(p), new Set(['new']))).toEqual({ host: p, x: 380, y: -50, grow: null });
  });

  it('falls back to the origin when even the page cannot be read', () => {
    const p = page();
    Object.defineProperty(p, 'children', { get() { throw new Error('page not loaded'); } });
    expect(firstSpot(node(p), none, [])).toEqual({ host: p, x: 0, y: 0, grow: null });
  });
});

describe('applySpot', () => {
  it('appends to the host, sets the position, then grows the host', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 600, 400));
    const doc = add(p, new Fake('doc', 'SECTION', 0, 0, 500, 300));
    applySpot(node(doc), { host: node(s), x: 544, y: 64, grow: { width: 1108, height: 428 } });
    expect(doc.parent).toBe(s);
    expect([doc.x, doc.y]).toEqual([544, 64]);
    expect([s.width, s.height]).toEqual([1108, 428]);
  });

  it('leaves the doc placed when growing the host fails', () => {
    const p = page();
    const s = add(p, new Fake('s', 'SECTION', 0, 0, 600, 400));
    s.resizeWithoutConstraints = () => { throw new Error('locked'); };
    const doc = add(p, new Fake('doc', 'SECTION', 0, 0, 500, 300));
    applySpot(node(doc), { host: node(s), x: 544, y: 64, grow: { width: 1108, height: 428 } });
    expect(doc.parent).toBe(s);
    expect([doc.x, doc.y]).toEqual([544, 64]);
  });
});
