/**
 * Where a doc Section goes on the canvas: the nearest clear spot beside its
 * anchor, in one host's coordinate space. Pure geometry with no Figma
 * globals; docPlacement.ts reads the canvas and applies the result.
 */

/** A rect in one host's coordinate space. Figma's global `Rect` has the same
 *  shape; the separate name keeps host space and absolute space apart. */
export interface Box { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

/** Clear space between a doc and anything beside it. */
export const GAP = 80;
/** Clear space between a doc and the edge of the Section that holds it. */
export const HOST_PAD = 64;

export interface PlaceInput {
  anchor: Box;
  size: Size;
  /** The host's other children. The anchor is blocked whether or not it is listed. */
  obstacles: readonly Box[];
  /** The host Section's own rect, (0, 0, width, height); null for a page. */
  bounds: Box | null;
}

export interface Placement {
  x: number;
  y: number;
  /** The host Section's new size when the doc does not fit inside it. A
   *  Section only grows right and down, so its origin never moves. */
  grow: Size | null;
}

type Direction = 'right' | 'below' | 'left' | 'above';
const DIRECTIONS: readonly Direction[] = ['right', 'below', 'left', 'above'];

interface Candidate { dir: Direction; box: Box }

export function inflate(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 };
}

/** Touching edges do not intersect, so a rect exactly GAP away is clear. */
export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Shortest edge-to-edge distance; 0 when the rects touch or overlap. */
function edgeDistance(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/** Where a candidate starts. Right and below may grow the host, so they start
 *  no higher and no further left than the content area: growth then only
 *  ever runs right and down. Left and above must fit as they are. */
function start(dir: Direction, anchor: Box, size: Size, content: Box | null): Box {
  const minX = content ? content.x : -Infinity;
  const minY = content ? content.y : -Infinity;
  switch (dir) {
    case 'right':
      return { x: Math.max(anchor.x + anchor.width + GAP, minX), y: Math.max(anchor.y, minY), ...size };
    case 'below':
      return { x: Math.max(anchor.x, minX), y: Math.max(anchor.y + anchor.height + GAP, minY), ...size };
    case 'left':
      return { x: anchor.x - GAP - size.width, y: anchor.y, ...size };
    case 'above':
      return { x: anchor.x, y: anchor.y - GAP - size.height, ...size };
  }
}

/** Jump past every blocked rect the candidate meets, in its direction. Each
 *  jump clears the rects it was hit by and moves strictly forward, so the
 *  loop ends after at most one jump per rect. */
function slide(dir: Direction, from: Box, blocked: readonly Box[]): Box {
  let b = from;
  for (;;) {
    const hits = blocked.filter((o) => intersects(b, o));
    if (hits.length === 0) return b;
    switch (dir) {
      case 'right': b = { ...b, x: Math.max(...hits.map((h) => h.x + h.width)) }; break;
      case 'below': b = { ...b, y: Math.max(...hits.map((h) => h.y + h.height)) }; break;
      case 'left': b = { ...b, x: Math.min(...hits.map((h) => h.x)) - b.width }; break;
      case 'above': b = { ...b, y: Math.min(...hits.map((h) => h.y)) - b.height }; break;
    }
  }
}

/** Every candidate worth trying, best first: one that fits beats one that
 *  needs growth; then the shortest distance wins; a tie keeps the earlier
 *  candidate. Left and above survive only when they fit, so right and below
 *  are always there and the list is never empty. */
function rank(
  candidates: readonly Candidate[], distance: (b: Box) => number,
  bounds: Box | null, content: Box | null,
): Placement[] {
  const scored: { box: Box; fits: boolean; distance: number; order: number }[] = [];
  for (const [order, { dir, box }] of candidates.entries()) {
    const fits = content === null || contains(content, box);
    if (!fits && (dir === 'left' || dir === 'above')) continue;
    scored.push({ box, fits, distance: distance(box), order });
  }
  scored.sort((a, b) => Number(b.fits) - Number(a.fits) || a.distance - b.distance || a.order - b.order);
  return scored.map(({ box, fits }) => ({
    x: box.x,
    y: box.y,
    grow: fits || bounds === null ? null : {
      width: Math.max(bounds.width, box.x + box.width + HOST_PAD),
      height: Math.max(bounds.height, box.y + box.height + HOST_PAD),
    },
  }));
}

/** Every clear spot beside `anchor`, nearest first; a tie in distance goes
 *  right, below, left, then above. */
export function rankDoc(input: PlaceInput): Placement[] {
  const { anchor, size, obstacles, bounds } = input;
  const blocked = [anchor, ...obstacles].map((b) => inflate(b, GAP));
  const content = bounds ? inflate(bounds, -HOST_PAD) : null;
  const candidates = DIRECTIONS.map((dir) => ({ dir, box: slide(dir, start(dir, anchor, size, content), blocked) }));
  return rank(candidates, (b) => edgeDistance(b, anchor), bounds, content);
}

/** The nearest clear spot beside `anchor`: rankDoc's first. */
export function placeDoc(input: PlaceInput): Placement {
  return rankDoc(input)[0];
}

/** A rebuilt doc that no longer fits where it was: its old origin, slid right
 *  or down past whatever is in the way, the one that moves it less first. */
export function rankFrom(
  origin: { x: number; y: number }, size: Size, obstacles: readonly Box[], bounds: Box | null,
): Placement[] {
  const blocked = obstacles.map((b) => inflate(b, GAP));
  const content = bounds ? inflate(bounds, -HOST_PAD) : null;
  const from: Box = {
    x: content ? Math.max(origin.x, content.x) : origin.x,
    y: content ? Math.max(origin.y, content.y) : origin.y,
    ...size,
  };
  const candidates: Candidate[] = [
    { dir: 'right', box: slide('right', from, blocked) },
    { dir: 'below', box: slide('below', from, blocked) },
  ];
  return rank(candidates, (b) => Math.hypot(b.x - origin.x, b.y - origin.y), bounds, content);
}

/** rankFrom's first: whichever slide moves the doc less. */
export function placeFrom(
  origin: { x: number; y: number }, size: Size, obstacles: readonly Box[], bounds: Box | null,
): Placement {
  return rankFrom(origin, size, obstacles, bounds)[0];
}

/** Whether `box` overlaps none of `obstacles` and, with `area`, lies inside it.
 *  No GAP: this is the in-place test for a rebuilt doc. */
export function isClear(box: Box, obstacles: readonly Box[], area: Box | null): boolean {
  return obstacles.every((o) => !intersects(box, o)) && (area === null || contains(area, box));
}

/** Whether a host Section can grow from `host` to `grown` (same origin, in its
 *  parent's space): the strips it adds stay GAP clear of its siblings, and it
 *  stays inside a parent Section. A sibling already close to the side that
 *  does not grow does not block it. */
export function growthClear(
  host: Box, grown: Size, siblings: readonly Box[], parentBounds: Box | null,
): boolean {
  const added: Box[] = [];
  if (grown.width > host.width) {
    added.push({ x: host.x + host.width, y: host.y, width: grown.width - host.width, height: grown.height });
  }
  if (grown.height > host.height) {
    added.push({ x: host.x, y: host.y + host.height, width: grown.width, height: grown.height - host.height });
  }
  const blocked = siblings.map((s) => inflate(s, GAP));
  const whole: Box = { x: host.x, y: host.y, ...grown };
  return added.every((a) => blocked.every((b) => !intersects(a, b)))
    && (parentBounds === null || contains(parentBounds, whole));
}

/** The last resort: GAP right of everything, level with the topmost. */
export function rightOfAll(obstacles: readonly Box[]): { x: number; y: number } {
  if (obstacles.length === 0) return { x: 0, y: 0 };
  let right = -Infinity, top = Infinity;
  for (const o of obstacles) {
    right = Math.max(right, o.x + o.width);
    top = Math.min(top, o.y);
  }
  return { x: right + GAP, y: top };
}
