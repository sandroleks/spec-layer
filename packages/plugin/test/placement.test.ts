import { describe, it, expect } from 'vitest';
import {
  GAP, HOST_PAD, inflate, intersects, contains, unionBoxes,
  placeDoc, placeFrom, isClear, growthClear, rightOfAll, type Box, type Size,
} from '../src/placement';

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const at = (p: { x: number; y: number }, s: Size): Box => ({ x: p.x, y: p.y, width: s.width, height: s.height });

/** mulberry32: a seeded generator, so the property test is the same run every time. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rect helpers', () => {
  it('treats touching edges as clear, so a rect exactly GAP away is allowed', () => {
    expect(intersects(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
    expect(intersects(box(0, 0, 10, 10), box(9, 0, 10, 10))).toBe(true);
  });

  it('inflates on every side and deflates with a negative amount', () => {
    expect(inflate(box(10, 10, 20, 20), 5)).toEqual(box(5, 5, 30, 30));
    expect(inflate(box(0, 0, 200, 100), -HOST_PAD)).toEqual(box(64, 64, 72, -28));
  });

  it('contains an inner rect touching the edges', () => {
    expect(contains(box(0, 0, 100, 100), box(0, 0, 100, 100))).toBe(true);
    expect(contains(box(0, 0, 100, 100), box(1, 0, 100, 100))).toBe(false);
  });

  it('unions boxes, and has no union for none', () => {
    expect(unionBoxes([])).toBeNull();
    expect(unionBoxes([box(0, 0, 10, 10), box(20, -5, 10, 10)])).toEqual(box(0, -5, 30, 15));
  });
});

describe('placeDoc on a page', () => {
  it('goes right of the anchor, top-aligned, on an empty page', () => {
    expect(placeDoc({ anchor: box(0, 0, 200, 100), size: { width: 300, height: 200 }, obstacles: [], bounds: null }))
      .toEqual({ x: 280, y: 0, grow: null });
  });

  it('prefers right over below on a tie in distance', () => {
    // Right and below are both exactly GAP away on an empty page.
    const p = placeDoc({ anchor: box(0, 0, 100, 100), size: { width: 50, height: 50 }, obstacles: [], bounds: null });
    expect(p).toEqual({ x: 100 + GAP, y: 0, grow: null });
  });

  it('goes below when a neighbour on the right pushes the right spot further away', () => {
    const p = placeDoc({
      anchor: box(0, 0, 200, 100), size: { width: 500, height: 300 },
      obstacles: [box(300, 0, 100, 100)], bounds: null,
    });
    expect(p).toEqual({ x: 0, y: 180, grow: null });
  });

  it('slides right past an anchor boxed in on all four sides', () => {
    const p = placeDoc({
      anchor: box(0, 0, 100, 100), size: { width: 100, height: 100 },
      obstacles: [box(180, 0, 100, 100), box(0, 180, 100, 100), box(-180, 0, 100, 100), box(0, -180, 100, 100)],
      bounds: null,
    });
    expect(p).toEqual({ x: 360, y: 0, grow: null });
  });

  it('never lands within GAP of five adjacent anchors or of the docs placed before it', () => {
    const anchors = [0, 250, 500, 750, 1000].map((x) => box(x, 0, 200, 100));
    const size = { width: 300, height: 200 };
    const placed: Box[] = [];
    for (const anchor of anchors) {
      const p = placeDoc({ anchor, size, obstacles: [...anchors, ...placed], bounds: null });
      placed.push(at(p, size));
    }
    for (const [i, doc] of placed.entries()) {
      for (const a of anchors) expect(intersects(doc, inflate(a, GAP))).toBe(false);
      for (const other of placed.slice(i + 1)) expect(intersects(doc, inflate(other, GAP))).toBe(false);
    }
  });
});

describe('placeDoc inside a Section', () => {
  it('fits inside a Section with room and does not grow it', () => {
    const p = placeDoc({
      anchor: box(64, 64, 200, 100), size: { width: 300, height: 200 },
      obstacles: [], bounds: box(0, 0, 1000, 1000),
    });
    expect(p).toEqual({ x: 344, y: 64, grow: null });
  });

  it('grows a full Section right and down only', () => {
    const p = placeDoc({
      anchor: box(64, 64, 400, 200), size: { width: 500, height: 300 },
      obstacles: [], bounds: box(0, 0, 600, 400),
    });
    expect(p).toEqual({ x: 544, y: 64, grow: { width: 1108, height: 428 } });
  });

  it('never grows up: an anchor near the top edge still places the doc HOST_PAD down', () => {
    const p = placeDoc({
      anchor: box(64, 10, 400, 200), size: { width: 500, height: 300 },
      obstacles: [], bounds: box(0, 0, 600, 400),
    });
    expect(p.y).toBe(HOST_PAD);
    expect(p.grow).toEqual({ width: 1108, height: 428 });
  });

  it('chooses left when it fits and right would need growth', () => {
    const p = placeDoc({
      anchor: box(1200, 64, 200, 100), size: { width: 300, height: 200 },
      obstacles: [box(1480, 0, 500, 600)], bounds: box(0, 0, 2000, 600),
    });
    expect(p).toEqual({ x: 820, y: 64, grow: null });
  });

  it('skips left when it does not fit, rather than growing left', () => {
    const p = placeDoc({
      anchor: box(64, 64, 300, 100), size: { width: 400, height: 200 },
      obstacles: [], bounds: box(0, 0, 700, 400),
    });
    expect(p).toEqual({ x: 444, y: 64, grow: { width: 908, height: 400 } });
  });
});

describe('placeDoc properties', () => {
  it('never lands within GAP of an obstacle, and stays in the content area of the Section it fits or grows', () => {
    const rnd = seeded(20261021);
    const r = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
    for (let trial = 0; trial < 300; trial++) {
      const obstacles = Array.from({ length: r(0, 8) }, () => box(r(0, 1500), r(0, 1500), r(10, 400), r(10, 400)));
      const anchor = box(r(0, 1500), r(0, 1500), r(10, 400), r(10, 400));
      const size = { width: r(50, 600), height: r(50, 600) };
      const withBounds = trial % 2 === 0;
      const bounds = withBounds ? box(0, 0, 2000, 2000) : null;
      const p = placeDoc({ anchor, size, obstacles, bounds });
      const doc = at(p, size);
      for (const o of [anchor, ...obstacles]) expect(intersects(doc, inflate(o, GAP))).toBe(false);
      if (bounds) {
        const area = p.grow ? box(0, 0, p.grow.width, p.grow.height) : bounds;
        expect(contains(inflate(area, -HOST_PAD), doc)).toBe(true);
      } else {
        expect(p.grow).toBeNull();
      }
    }
  });
});

describe('placeFrom', () => {
  it('keeps the old origin when it is clear', () => {
    expect(placeFrom({ x: 10, y: 20 }, { width: 100, height: 100 }, [], null)).toEqual({ x: 10, y: 20, grow: null });
  });

  it('slides down when that moves the doc less than sliding right', () => {
    expect(placeFrom({ x: 0, y: 0 }, { width: 400, height: 100 }, [box(300, 0, 100, 100)], null))
      .toEqual({ x: 0, y: 180, grow: null });
  });

  it('grows a Section right or down from the old origin, never up', () => {
    const p = placeFrom({ x: 100, y: 10 }, { width: 500, height: 100 }, [], box(0, 0, 400, 400));
    expect(p).toEqual({ x: 100, y: HOST_PAD, grow: { width: 664, height: 400 } });
  });
});

describe('isClear', () => {
  it('uses no GAP: a rect touching a neighbour is clear, an overlapping one is not', () => {
    expect(isClear(box(0, 0, 100, 100), [box(100, 0, 50, 50)], null)).toBe(true);
    expect(isClear(box(0, 0, 101, 100), [box(100, 0, 50, 50)], null)).toBe(false);
  });

  it('requires the rect inside the area when one is given', () => {
    expect(isClear(box(0, 0, 100, 100), [], box(0, 0, 100, 100))).toBe(true);
    expect(isClear(box(0, 0, 101, 100), [], box(0, 0, 100, 100))).toBe(false);
  });
});

describe('growthClear', () => {
  const host = box(1000, 1000, 600, 400);

  it('is clear when nothing sits in the added strips', () => {
    expect(growthClear(host, { width: 1100, height: 500 }, [box(0, 0, 100, 100)], null)).toBe(true);
  });

  it('is blocked by a sibling within GAP of the new right strip', () => {
    expect(growthClear(host, { width: 1100, height: 400 }, [box(1700, 1000, 100, 100)], null)).toBe(false);
  });

  it('is blocked by a sibling within GAP of the new bottom strip', () => {
    expect(growthClear(host, { width: 600, height: 600 }, [box(1000, 1450, 100, 100)], null)).toBe(false);
  });

  it('ignores a sibling already close on the left, which growth moves away from', () => {
    expect(growthClear(host, { width: 1100, height: 400 }, [box(900, 1000, 60, 100)], null)).toBe(true);
  });

  it('is blocked when the grown host would leave its parent Section', () => {
    expect(growthClear(host, { width: 1100, height: 400 }, [], box(0, 0, 2000, 2000))).toBe(false);
    expect(growthClear(host, { width: 1000, height: 400 }, [], box(0, 0, 2000, 2000))).toBe(true);
  });
});

describe('rightOfAll', () => {
  it('is the origin on an empty page', () => {
    expect(rightOfAll([])).toEqual({ x: 0, y: 0 });
  });

  it('is GAP right of the rightmost edge, level with the topmost', () => {
    expect(rightOfAll([box(0, 0, 100, 100), box(200, -50, 100, 100)])).toEqual({ x: 380, y: -50 });
  });
});
